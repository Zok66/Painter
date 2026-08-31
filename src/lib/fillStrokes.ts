// 笔迹填充（Bucket Fill 笔迹版）核心算法
//
// 输入是原生 computeBucketFillPolygon() 算出的封闭区域 keyhole 单环，
// 输出是一组可进 Excalidraw 场景的元素：
//   - 纯色 / 荧光：单个 polygon line 元素（solid 填充 + 无边框视觉）
//   - 圆珠 / 钢笔 / 铅笔 / 蜡笔：even-odd 扫描线生成水平排线，
//     每条排线 = 一条 freedraw 元素（铅笔/蜡笔挂 grainKind 走颗粒渲染）
//
// 所有元素共享同一 groupIds（成组），并带 customData.fillGroup/fillKind
// 标记，供点击换色（restyle）识别；渲染、撤销、选择、导出全部走原生链路。

import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawLineElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { PEN_PRESETS, buildFreedrawElement, type PenType } from "./pens";
import type { Point } from "./shapeRecognition";

export type FillKind =
  | "solid"
  | "ballpoint"
  | "fountain"
  | "pencil"
  | "crayon"
  | "highlighter";

export interface FillElementCustomData {
  fillGroup: string;
  fillKind: FillKind;
  grainKind?: "pencil" | "crayon";
  grainSeed?: number;
}

/** 排线类风格的填充专用参数（间距/抖动不污染 pens.ts 的笔 preset） */
interface FillStrokeSpec {
  /** 排线间距（场景 px） */
  spacing: number;
  /** 低频抖动幅度 */
  amp: number;
  /** 抖动分段长度 */
  segLen: number;
  /** 复用的笔 preset */
  pen: PenType;
  /** 是否挂 grainKind 走自研颗粒渲染 */
  grain?: boolean;
}

const FILL_SPECS: Record<
  Exclude<FillKind, "solid" | "highlighter">,
  FillStrokeSpec
> = {
  ballpoint: { spacing: 4, amp: 0.55, segLen: 14, pen: "ballpoint" },
  fountain: { spacing: 4.6, amp: 0.8, segLen: 18, pen: "fountain" },
  pencil: { spacing: 3.2, amp: 0.6, segLen: 12, pen: "pencil", grain: true },
  crayon: { spacing: 11, amp: 2.4, segLen: 26, pen: "crayon", grain: true },
};

/** 排线数上限：超出时按比例放大间距重扫，保护细间距 + 大区域的最坏情况 */
const MAX_FILL_LINES = 300;

/** keyhole 零宽桥接区间阈值（小于该宽度视为桥，不落笔） */
const ZERO_SPAN = 0.5;

export interface FillRegionInput {
  /** 封闭区域 keyhole 单环（场景坐标） */
  scenePoints: readonly (readonly [number, number])[];
  kind: FillKind;
  color: string;
  groupId: string;
  /** 随机源种子：同一区域重复生成保持一致，预览与最终可对齐 */
  seed: number;
  appState: AppState;
}

/* ---------------- 基础工具 ---------------- */

/** mulberry32 确定性伪随机：每条排线独立随机源，重绘不跳变 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * even-odd 扫描线：对每个间距 y 求与多边形所有边的交点 → 排序 → 奇偶配对
 * 得内部区间。keyhole 桥接为零宽边（进/出交点成对相邻），配对后区间长度
 * 近似 0，被 ZERO_SPAN 阈值过滤——无需拆环，洞内不落笔。
 */
export function scanFillSpans(
  pts: readonly (readonly [number, number])[],
  spacing: number,
): Array<{ y: number; x0: number; x1: number }> {
  const spans: Array<{ y: number; x0: number; x1: number }> = [];
  if (pts.length < 3 || spacing <= 0) return spans;

  // 闭合环首尾重复点防御：去掉尾重复，避免首段被算两次
  const ring =
    pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;
  if (ring.length < 3) return spans;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of ring) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // 起始 y 偏移半个间距，避免扫描线恰好穿过顶点
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      if (y1 === y2) continue; // 水平边
      // 半开区间：下端含、上端不含，顶点只计数一次
      if (!((y1 <= y && y < y2) || (y2 <= y && y < y1))) continue;
      xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k];
      const x1 = xs[k + 1];
      if (x1 - x0 < ZERO_SPAN) continue;
      spans.push({ y, x0, x1 });
    }
  }
  return spans;
}

/**
 * 单条排线的抖动折线：水平推进时叠加低频随机偏移（随机游走 + 回中），
 * 模拟手绘排线；端点偏移减半，贴边更稳。
 */
function jitteredLine(
  x0: number,
  x1: number,
  y: number,
  amp: number,
  segLen: number,
  rng: () => number,
): Point[] {
  const width = x1 - x0;
  const steps = Math.max(1, Math.ceil(width / segLen));
  const pts: Point[] = [];
  let off = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    off += (rng() - 0.5) * amp * 1.6;
    off *= 0.8;
    off = Math.max(-amp, Math.min(amp, off));
    const scale = i === 0 || i === steps ? 0.5 : 1;
    pts.push({ x: x0 + width * t, y: y + off * scale });
  }
  return pts;
}

/* ---------------- 元素构建 ---------------- */

/** 纯色 / 荧光：单个 polygon line（solid 填充，描边与填充同色 = 无边框视觉） */
function buildFillPolygon(
  scenePts: readonly (readonly [number, number])[],
  kind: "solid" | "highlighter",
  color: string,
  groupId: string,
): ExcalidrawLineElement | null {
  if (scenePts.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of scenePts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const local = scenePts.map(([x, y]) => [x - minX, y - minY] as [number, number]);
  local.push(local[0]); // 显式闭合多边形

  return {
    id: `fill-${groupId}`,
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
    opacity: kind === "highlighter" ? 32 : 100,
    groupIds: [groupId],
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
    customData: { fillGroup: groupId, fillKind: kind } satisfies FillElementCustomData,
  } as unknown as ExcalidrawLineElement;
}

/**
 * 按风格构建整个填充元素组。
 * 返回空数组表示区域退化（无内部区间），调用方静默丢弃。
 */
export function buildFillElements(input: FillRegionInput): ExcalidrawElement[] {
  const { scenePoints, kind, color, groupId, seed, appState } = input;

  if (kind === "solid" || kind === "highlighter") {
    const el = buildFillPolygon(scenePoints, kind, color, groupId);
    return el ? [el] : [];
  }

  const spec = FILL_SPECS[kind];

  // 密度上限：排线过多时按比例放大间距重扫
  let spacing = spec.spacing;
  let spans = scanFillSpans(scenePoints, spacing);
  for (let i = 0; i < 4 && spans.length > MAX_FILL_LINES; i++) {
    spacing = spacing * (spans.length / MAX_FILL_LINES);
    spans = scanFillSpans(scenePoints, spacing);
  }
  if (spans.length === 0) return [];

  const preset = PEN_PRESETS[spec.pen];
  const out: ExcalidrawElement[] = [];
  spans.forEach((span, i) => {
    const rng = mulberry32((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    const pts = jitteredLine(span.x0, span.x1, span.y, spec.amp, spec.segLen, rng);
    if (pts.length < 2) return;

    const customData: FillElementCustomData = {
      fillGroup: groupId,
      fillKind: kind,
    };
    if (spec.grain) {
      customData.grainKind = spec.pen as "pencil" | "crayon";
      customData.grainSeed = Math.floor(rng() * 2 ** 31);
    }

    const el = buildFreedrawElement(
      pts,
      appState,
      preset,
      `fill-line-${groupId}-${i}`,
      color,
      customData as unknown as Record<string, unknown>,
    );
    out.push({ ...el, groupIds: [groupId] } as ExcalidrawFreeDrawElement);
  });
  return out;
}

/* ---------------- 点击换色（restyle） ---------------- */

function fillDataOf(el: ExcalidrawElement): FillElementCustomData | undefined {
  return el.customData as FillElementCustomData | undefined;
}

/** 射线法：点是否在 polygon line 元素内部（场景坐标 → 元素局部坐标） */
function pointInLinePolygon(
  x: number,
  y: number,
  el: ExcalidrawLineElement,
): boolean {
  const px = x - el.x;
  const py = y - el.y;
  const pts = el.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 点到折线的最小距离（freedraw 排线命中检测） */
function distToPolyline(
  x: number,
  y: number,
  el: ExcalidrawFreeDrawElement,
): number {
  const px = x - el.x;
  const py = y - el.y;
  const pts = el.points;
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    }
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * 点击处命中的填充组 id（从顶层往下找第一个命中成员）。
 * 纯色/荧光 = 精确点在多边形内；排线 = 距中心线 ≤ 半笔宽 + 余量。
 * 返回 null 表示未命中填充组（走新生成流程）。
 */
export function hitFillGroup(
  x: number,
  y: number,
  elements: readonly ExcalidrawElement[],
): string | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted) continue;
    const data = fillDataOf(el);
    if (!data?.fillGroup) continue;
    // bbox 快速排除
    if (
      x < el.x - 8 ||
      x > el.x + el.width + 8 ||
      y < el.y - 8 ||
      y > el.y + el.height + 8
    ) {
      continue;
    }
    if (data.fillKind === "solid" || data.fillKind === "highlighter") {
      if (el.type === "line" && pointInLinePolygon(x, y, el as ExcalidrawLineElement)) {
        return data.fillGroup;
      }
    } else if (el.type === "freedraw") {
      const strokeW = (el as ExcalidrawFreeDrawElement).strokeWidth;
      const threshold = Math.max(strokeW / 2 + 2, 4);
      if (distToPolyline(x, y, el as ExcalidrawFreeDrawElement) <= threshold) {
        return data.fillGroup;
      }
    }
  }
  return null;
}

/** 全组换当前色（不重新生成、不叠加）：返回新元素数组 */
export function restyleFillGroup(
  groupId: string,
  color: string,
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  return elements.map((el) => {
    const data = fillDataOf(el);
    if (!data || data.fillGroup !== groupId) return el;
    const fillPoly = data.fillKind === "solid" || data.fillKind === "highlighter";
    return {
      ...el,
      strokeColor: color,
      ...(fillPoly ? { backgroundColor: color } : {}),
      updated: Date.now(),
    } as ExcalidrawElement;
  });
}
