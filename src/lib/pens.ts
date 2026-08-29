// 多笔刷实现：圆珠笔 / 钢笔 / 铅笔 / 荧光笔
//
// 原理（Excalidraw 的 freedraw 渲染链路）：
// freedraw 元素最终会交给 perfect-freehand 生成轮廓，Excalidraw 内部有两种模式：
//   1) strokeOptions.variability === "variable"（默认）
//      size = strokeWidth * 4.25，thinning = 0.6，smoothing = 0.5
//      → 线宽会在 [0.4 * size, size] 之间随压力变化，用来做「钢笔 / 铅笔」这种有笔锋的笔
//   2) strokeOptions.variability === "constant"
//      size = strokeWidth * 1.4，sizeMapping 恒为 1
//      → 完全等宽的线条，用来做「圆珠笔 / 荧光笔」
// 再加上元素级的 strokeWidth / opacity / strokeOptions.streamline，
// 四支笔的手感差异就都出来了，不需要改动 Excalidraw 源码。

import type { ExcalidrawFreeDrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { Point } from "./shapeRecognition";

export type PenType = "ballpoint" | "fountain" | "pencil" | "highlighter";

export interface PenPreset {
  key: PenType;
  /** 菜单显示名 */
  name: string;
  /** 一句话说明 */
  desc: string;
  /** 写入元素的 strokeWidth（数值，不受 thin/medium/bold 三档限制） */
  strokeWidth: number;
  /** variable = 随压力变粗细；constant = 等宽 */
  variability: "variable" | "constant";
  /**
   * 是否让 Excalidraw 用移动速度自动模拟压力。
   * 这里统一关掉，改由我们自己按速度 / 噪声计算 pressures，可控性更高。
   */
  simulatePressure: boolean;
  /** 轨迹平滑系数 0~1，越大越顺滑 */
  streamline: number;
  /** 元素透明度 0~100 */
  opacity: number;
  /** 选中该笔时，若当前还是默认墨色则自动换成这个颜色 */
  suggestColor?: string;
}

export const PEN_PRESETS: Record<PenType, PenPreset> = {
  ballpoint: {
    key: "ballpoint",
    name: "圆珠笔",
    desc: "等宽细线，起收笔干净",
    strokeWidth: 2.2,
    variability: "constant",
    simulatePressure: false,
    streamline: 0.68,
    opacity: 100,
  },
  fountain: {
    key: "fountain",
    name: "钢笔",
    desc: "笔锋明显，快慢出粗细",
    strokeWidth: 2.8,
    variability: "variable",
    simulatePressure: false,
    streamline: 0.5,
    opacity: 100,
  },
  pencil: {
    key: "pencil",
    name: "铅笔",
    desc: "颗粒磨砂感，略透明",
    strokeWidth: 1.9,
    variability: "variable",
    simulatePressure: false,
    streamline: 0.24,
    opacity: 72,
  },
  highlighter: {
    key: "highlighter",
    name: "荧光笔",
    desc: "宽笔触半透明，可叠加",
    strokeWidth: 12,
    variability: "constant",
    simulatePressure: false,
    streamline: 0.5,
    opacity: 32,
    suggestColor: "#ffec27",
  },
};

export const PEN_ORDER: PenType[] = ["ballpoint", "fountain", "pencil", "highlighter"];

/** 默认墨色：用户没主动改过颜色时才允许自动换色 */
const DEFAULT_INK_COLORS = new Set([
  "#1e1e1e",
  "#000000",
  "#1f1f1f",
  "#343434",
  "transparent",
]);

export function isDefaultInk(color: string | undefined): boolean {
  return !color || DEFAULT_INK_COLORS.has(color.toLowerCase());
}

/** 确定性伪随机，保证同一笔重绘时颗粒感一致 */
function hashNoise(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 按笔的类型计算每个采样点的压力值（0~1，越大越粗）。
 * - 钢笔：纯速度驱动（越快越细），再做指数平滑 → 起笔重、行笔细
 * - 铅笔：速度 + 成簇噪声 → 线条粗细带随机颗粒感，像石墨蹭在纸面上
 * - 等宽笔：恒为 1（constant 模式下 sizeMapping 也会把它抹平）
 */
export function computePressures(points: Point[], pen: PenPreset): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (pen.variability === "constant" || n < 2) {
    return points.map(() => 1);
  }

  // 每一点的瞬时速度（相邻采样点距离的一半，单位：场景像素）
  const speeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    speeds.push(Math.hypot(next.x - prev.x, next.y - prev.y) / 2);
  }

  const pressures: number[] = new Array(n);
  const SPEED_FULL = 16; // 达到该速度视为「全速」，压力取到最小值

  if (pen.key === "pencil") {
    for (let i = 0; i < n; i++) {
      const speedNorm = Math.min(1, speeds[i] / SPEED_FULL);
      // 噪声成簇（每 3 个点换一次），避免逐点跳变成念珠状
      const noise = hashNoise(Math.floor(i / 3)) * 0.6 + hashNoise(i) * 0.4;
      const p = 0.66 + (noise - 0.5) * 0.34 - speedNorm * 0.26;
      pressures[i] = Math.min(0.98, Math.max(0.28, p));
    }
    return pressures;
  }

  // 钢笔 / 其它变宽笔：速度驱动 + 指数平滑
  let smooth = 0.85;
  for (let i = 0; i < n; i++) {
    const speedNorm = Math.min(1, speeds[i] / SPEED_FULL);
    const raw = 0.95 - speedNorm * 0.68; // 慢 ≈ 0.95，快 ≈ 0.27
    smooth = smooth * 0.62 + raw * 0.38;
    pressures[i] = Math.min(1, Math.max(0.2, smooth));
  }
  return pressures;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * 把采集到的轨迹点构造成 freedraw 元素。
 * points 会转成相对元素左上角的局部坐标，bbox 外扩半个笔宽作为 padding，
 * 保证选择框刚好包住笔触。
 */
export function buildFreedrawElement(
  points: Point[],
  appState: AppState,
  pen: PenPreset,
  id: string,
  strokeColor?: string,
): ExcalidrawFreeDrawElement {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // variable 模式实际笔宽 = strokeWidth * 4.25，constant = strokeWidth * 1.4
  const pad =
    pen.variability === "constant" ? pen.strokeWidth * 0.7 : pen.strokeWidth * 2.13;
  const x = minX - pad;
  const y = minY - pad;

  const localPoints = points.map(
    (p) => [p.x - x, p.y - y] as [number, number],
  );

  return {
    id,
    type: "freedraw",
    x,
    y,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    angle: 0,
    strokeColor: strokeColor ?? appState.currentItemStrokeColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: pen.strokeWidth,
    strokeStyle: "solid", // 笔刷不吃虚线，统一实线
    roughness: 0,
    opacity: pen.opacity,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: localPoints,
    pressures: computePressures(points, pen),
    simulatePressure: pen.simulatePressure,
    strokeOptions: {
      variability: pen.variability,
      streamline: pen.streamline,
    },
  } as unknown as ExcalidrawFreeDrawElement;
}

/** 绘制过程中的实时预览（每帧重建，所见即所得） */
export function randomPenId(): string {
  return `pen-${randomId()}`;
}

