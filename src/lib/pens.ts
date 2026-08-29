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

import type {
  ExcalidrawFreeDrawElement,
  ExcalidrawLineElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { union as polygonUnion } from "polygon-clipping";
import type { Polygon } from "polygon-clipping";
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

/** 荧光笔实际着墨宽度（与等宽 freedraw 的 size 因子保持一致） */
const HIGHLIGHTER_WIDTH_FACTOR = 1.4;

type Ring = [number, number][];

/** 鞋带公式：有向面积。正值 = 逆时针（nonzero 填充下作外环），负值 = 顺时针（作洞） */
function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** 强制环绕向：sign=+1 逆时针 / -1 顺时针 */
function oriented(ring: Ring, sign: 1 | -1): Ring {
  return signedArea(ring) * sign >= 0 ? ring : [...ring].reverse();
}

/** Douglas-Peucker 抽稀：大幅减少布尔并集的输入段数（600px 曲线 300 段 → 约 50 段） */
function dpSimplify(pts: Ring, eps: number): Ring {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = pts[first];
    const b = pts[last];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const p = pts[i];
      let d: number;
      if (len2 === 0) {
        d = Math.hypot(p[0] - a[0], p[1] - a[1]);
      } else {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
        d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 用最近点对把多个环桥接成一条折线（nonzero 填充下桥零面积，洞依旧挖空） */
function bridgeRings(rings: Ring[]): Ring {
  let acc = [...rings[0]];
  for (let k = 1; k < rings.length; k++) {
    const b = rings[k];
    let bi = 0;
    let bj = 0;
    let best = Infinity;
    for (let i = 0; i < acc.length; i++) {
      for (let j = 0; j < b.length; j++) {
        const d = (acc[i][0] - b[j][0]) ** 2 + (acc[i][1] - b[j][1]) ** 2;
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    acc = [
      ...acc.slice(0, bi + 1),
      ...b.slice(bj),
      ...b.slice(0, bj + 1),
      ...acc.slice(bi),
    ];
  }
  return acc;
}

/** 兜底轮廓：左右偏移链闭环（并集失败时使用，交叉处可能发白但不会崩） */
function legacyOutline(pts: Point[], width: number): Ring {
  const half = width / 2;
  const left: Ring = [];
  const right: Ring = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const c = pts[i];
    left.push([c.x - ty * half, c.y + tx * half]);
    right.push([c.x + ty * half, c.y - tx * half]);
  }
  return [...left, ...right.reverse()];
}

/** 点在中心线上的法线（前后点平均切向旋转 90°） */
function normAt(center: Ring, i: number): [number, number] {
  const prev = center[Math.max(0, i - 1)];
  const next = center[Math.min(center.length - 1, i + 1)];
  let tx = next[0] - prev[0];
  let ty = next[1] - prev[1];
  const len = Math.hypot(tx, ty) || 1;
  return [-ty / len, tx / len];
}

/**
 * 荧光笔专用：把轨迹转成「平头直边」的等宽色块元素。
 *
 * 为什么不用 freedraw：Excalidraw 0.18 的等宽 freedraw（constant 模式）
 * 底层用 LaserPointer 几何，端帽是写死的半圆弧，无法改成平头；
 * 渲染代码又打包在内部 bundle 里 patch 不到。
 * 所以荧光笔完全自绘：手写法线偏移生成平头轮廓，
 * 存成闭合 line 多边形（solid 填充 + 无边框），曲线也全程平头直边，
 * 预览与最终渲染同一构造，边画边所见即所得。
 */
export function buildHighlighterStrokeElement(
  points: Point[],
  appState: AppState,
  pen: PenPreset,
  id: string,
  strokeColor?: string,
): ExcalidrawLineElement | null {
  if (points.length === 0) return null;
  const w = pen.strokeWidth * HIGHLIGHTER_WIDTH_FACTOR;

  // 轻度平滑：加权三点移动平均，去掉指针采样的高频抖动
  const smooth: Point[] = points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const a = points[i - 1];
    const b = points[i + 1];
    return {
      x: (a.x + p.x * 2 + b.x) / 4,
      y: (a.y + p.y * 2 + b.y) / 4,
    };
  });

  let outline: Ring;
  if (smooth.length === 1) {
    // 点按：以着色点为中心的圆印迹
    const c = smooth[0];
    outline = [];
    for (let k = 0; k < 16; k++) {
      const t = (k / 16) * Math.PI * 2;
      outline.push([c.x + (Math.cos(t) * w) / 2, c.y + (Math.sin(t) * w) / 2]);
    }
  } else {
    // 中心线 → 抽稀 → 切成段四边形 → 布尔并集：
    // 交叉/重叠区域被合并成单一多边形，填充不再出现反向环绕导致的白斑
    const center = dpSimplify(
      smooth.map((p) => [p.x, p.y] as [number, number]),
      0.75,
    );
    const half = w / 2;
    const quads: Polygon[] = [];
    for (let i = 0; i < center.length - 1; i++) {
      const a = center[i];
      const b = center[i + 1];
      const na = normAt(center, i);
      const nb = normAt(center, i + 1);
      quads.push([
        [
          [a[0] + na[0] * half, a[1] + na[1] * half],
          [b[0] + nb[0] * half, b[1] + nb[1] * half],
          [b[0] - nb[0] * half, b[1] - nb[1] * half],
          [a[0] - na[0] * half, a[1] - na[1] * half],
          [a[0] + na[0] * half, a[1] + na[1] * half], // 显式闭合
        ],
      ]);
    }

    try {
      const multi = polygonUnion(quads[0], ...quads.slice(1));
      const rings: Ring[] = [];
      for (const poly of multi) {
        if (poly.length === 0) continue;
        rings.push(oriented(poly[0], 1)); // 外环逆时针
        for (let h = 1; h < poly.length; h++) {
          rings.push(oriented(poly[h], -1)); // 洞环顺时针
        }
      }
      outline = rings.length === 1 ? rings[0] : bridgeRings(rings);
    } catch {
      outline = legacyOutline(smooth, w);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outline) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const color = strokeColor ?? appState.currentItemStrokeColor;
  const local = outline.map(([x, y]) => [x - minX, y - minY] as [number, number]);
  local.push(local[0]); // 显式闭合多边形

  return {
    id,
    type: "line",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    angle: 0,
    strokeColor: color, // 与填充同色，视觉上等于无边框
    backgroundColor: color,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
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
    points: local,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    polygon: true,
    lastCommittedPoint: null,
  } as unknown as ExcalidrawLineElement;
}


