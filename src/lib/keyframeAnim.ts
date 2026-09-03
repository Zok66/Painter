// 帧动画 · 关键帧补间引擎（剪映逻辑）
//
// 数据模型：
//   AnimProject = { fps, durationSec, tracks[] }
//   AnimTrack   = { elementId, keyframes[] }   一个画布元素一条轨道
//   Keyframe    = { t(秒), props, easing }     记录某时刻该元素的【完整属性快照】
//
// 关键思路：只存「基准场景 + 关键帧差异属性」，播放/预览/导出时
// 用 buildSceneAtTime() 在任意时间点对属性做插值，生成那一帧的完整画布。
// 比逐帧快照体积小，且天然支持「关键帧之间自动补间」。
//
// ⚠️ props 覆盖该元素在画布上的【一切可动画变动】：
//   几何(x/y/width/height/angle/opacity)、顶点(points，逐点插值)、
//   字体(fontSize/fontFamily/lineHeight/text)、样式(strokeColor/backgroundColor/
//   fillStyle/strokeStyle/strokeWidth/roughness/roundness)、层级(z，记录元素在
//   场景数组中的序号，播放时整体按 z 重排)。只要页面上该元素有任何变动都进关键帧。

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut";

/** 单个关键帧记录的「元素完整属性快照」——覆盖页面上一切变动 */
export interface AnimProps {
  // 几何变换
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** 弧度，Excalidraw 内部统一用 Radians */
  angle?: number;
  /** 0-100 */
  opacity?: number;
  /** 线性/手绘/箭头等带顶点的元素：顶点相对坐标 [x,y][]（逐点插值） */
  points?: ReadonlyArray<readonly [number, number]>;
  // 文字
  fontSize?: number;
  fontFamily?: number;
  lineHeight?: number;
  textAlign?: string;
  text?: string;
  // 样式
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeStyle?: string;
  strokeWidth?: number;
  roughness?: number;
  roundness?: unknown;
  // 层级：元素在场景数组中的序号，播放时整体按 z 重排（实现置顶/置底动画）
  z?: number;
}

export interface Keyframe {
  id: string;
  /** 时间，单位秒，相对动画起点 */
  t: number;
  props: AnimProps;
  /** 到下一个关键帧之间的缓动 */
  easing: EasingType;
}

export interface AnimTrack {
  elementId: string;
  /** 按 t 升序 */
  keyframes: Keyframe[];
}

export interface AnimProject {
  version: 1;
  fps: number;
  durationSec: number;
  tracks: AnimTrack[];
}

export const DEFAULT_FPS = 24;
export const DEFAULT_DURATION = 3;
export const EASING_LABELS: Record<EasingType, string> = {
  linear: "线性",
  easeIn: "缓入",
  easeOut: "缓出",
  easeInOut: "缓入缓出",
};

// ── 属性分类 ────────────────────────────────────────
// 数值型：区间线性插值
const NUMERIC_PROPS: (keyof AnimProps)[] = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "opacity",
  "fontSize",
  "strokeWidth",
  "roughness",
  "lineHeight",
];
// 颜色型：区间做 hex 插值（非 hex 时退化为保持）
const COLOR_PROPS: (keyof AnimProps)[] = ["strokeColor", "backgroundColor"];
// 离散型：区间保持起点值，到下一关键帧整段切换（不插值）
const STEP_PROPS: (keyof AnimProps)[] = [
  "fillStyle",
  "strokeStyle",
  "fontFamily",
  "textAlign",
  "text",
  "roundness",
];

const PROJ_KEY = (pageId: string) => `painter:anim:${pageId}`;
const BASE_KEY = (pageId: string) => `painter:anim:base:${pageId}`;

function uid(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}

export function createProject(): AnimProject {
  return {
    version: 1,
    fps: DEFAULT_FPS,
    durationSec: DEFAULT_DURATION,
    tracks: [],
  };
}

/**
 * 读取动画工程。旧版「逐帧」数据（含 frames、无 tracks）直接忽略，
 * 返回空工程，由调用方把当前画布当作基准场景重新建立。
 */
export function loadProject(pageId: string): AnimProject {
  try {
    const raw = localStorage.getItem(PROJ_KEY(pageId));
    if (!raw) return createProject();
    const p = JSON.parse(raw) as Partial<AnimProject>;
    if (!p || p.version !== 1 || !Array.isArray(p.tracks)) return createProject();
    return {
      version: 1,
      fps: Number(p.fps) || DEFAULT_FPS,
      durationSec: Number(p.durationSec) || DEFAULT_DURATION,
      tracks: p.tracks.map((t) => ({
        elementId: t.elementId,
        keyframes: [...t.keyframes].sort((a, b) => a.t - b.t),
      })),
    };
  } catch {
    return createProject();
  }
}

export function saveProject(pageId: string, p: AnimProject): void {
  try {
    localStorage.setItem(PROJ_KEY(pageId), JSON.stringify(p));
  } catch {
    /* 忽略写入错误 */
  }
}

export function loadBaseScene(pageId: string): string | null {
  return localStorage.getItem(BASE_KEY(pageId));
}

export function saveBaseScene(pageId: string, json: string): void {
  try {
    localStorage.setItem(BASE_KEY(pageId), json);
  } catch {
    /* 忽略写入错误 */
  }
}

export function deleteProject(pageId: string): void {
  localStorage.removeItem(PROJ_KEY(pageId));
  localStorage.removeItem(BASE_KEY(pageId));
}

// ── 缓动 ─────────────────────────────────────────────
function ease(u: number, type: EasingType): number {
  switch (type) {
    case "easeIn":
      return u * u;
    case "easeOut":
      return u * (2 - u);
    case "easeInOut":
      return u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u;
    default:
      return u;
  }
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

const num = (v: unknown, fb: number): number => (typeof v === "number" ? v : fb);

// ── 颜色插值（仅 #rrggbb 六位 hex，否则退化为保持）──
function parseHex(c: string): [number, number, number] | null {
  if (typeof c !== "string") return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(c.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpColor(a: string | undefined, b: string | undefined, u: number): string | undefined {
  const ca = parseHex(a ?? "");
  const cb = parseHex(b ?? "");
  if (!ca || !cb) return u < 1 ? a : b; // 非 hex：整段保持起点，到下一关键帧切换
  const r = Math.round(lerp(ca[0], cb[0], u));
  const g = Math.round(lerp(ca[1], cb[1], u));
  const bl = Math.round(lerp(ca[2], cb[2], u));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

// ── 顶点插值 ─────────────────────────────────────────
function lerpPoints(
  a: ReadonlyArray<readonly [number, number]> | undefined,
  b: ReadonlyArray<readonly [number, number]> | undefined,
  u: number,
): ReadonlyArray<readonly [number, number]> | undefined {
  if (!a || !b) return u < 0.5 ? a : b;
  if (a.length !== b.length) return u < 0.5 ? a : b;
  return a.map((p, i) => [lerp(p[0], b[i][0], u), lerp(p[1], b[i][1], u)] as [number, number]);
}

function basePoints(el: ExcalidrawElement): ReadonlyArray<readonly [number, number]> | undefined {
  const pts = (el as unknown as { points?: ReadonlyArray<readonly [number, number]> }).points;
  return Array.isArray(pts) ? pts : undefined;
}

// 全量属性兜底（用于区间外 / 单一关键帧）：缺失字段回落基准元素
function fillProps(kf: Keyframe, base: ExcalidrawElement, baseIndex: number): AnimProps {
  const out: AnimProps = {};
  for (const k of NUMERIC_PROPS) {
    const v = (kf.props as Record<string, unknown>)[k];
    (out as Record<string, unknown>)[k] = v != null ? v : (base as unknown as Record<string, number>)[k];
  }
  for (const k of COLOR_PROPS) {
    const v = (kf.props as Record<string, unknown>)[k];
    (out as Record<string, unknown>)[k] = v != null ? v : (base as unknown as Record<string, string>)[k];
  }
  for (const k of STEP_PROPS) {
    const v = (kf.props as Record<string, unknown>)[k];
    (out as Record<string, unknown>)[k] = v != null ? v : (base as unknown as Record<string, unknown>)[k];
  }
  const bp = basePoints(base);
  (out as Record<string, unknown>).points = Array.isArray(kf.props.points) ? kf.props.points : bp;
  const kfz = (kf.props as Record<string, unknown>).z;
  (out as Record<string, unknown>).z = kfz != null ? (kfz as number) : baseIndex;
  return out;
}

/**
 * 采样某轨道在时刻 t 的属性值：
 * - t 在首/尾关键帧之外 → 取最近的关键帧
 * - t 落在某区间 [a,b] → 对每属性按 a.easing 插值
 * - 关键帧未记录的属性，用 base 的当前值兜底
 */
export function sampleTrack(
  track: AnimTrack,
  t: number,
  base: ExcalidrawElement,
  baseIndex = 0,
): AnimProps {
  const kfs = track.keyframes;
  if (kfs.length === 0) return fillProps({ id: "", t: 0, props: {}, easing: "linear" }, base, baseIndex);
  if (t <= kfs[0].t) return fillProps(kfs[0], base, baseIndex);
  if (t >= kfs[kfs.length - 1].t) return fillProps(kfs[kfs.length - 1], base, baseIndex);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1e-6;
      const u = ease((t - a.t) / span, a.easing);
      const out: AnimProps = {};
      for (const k of NUMERIC_PROPS) {
        const av = (a.props as Record<string, unknown>)[k];
        const bv = (b.props as Record<string, unknown>)[k];
        (out as Record<string, number>)[k] = lerp(
          num(av, (base as unknown as Record<string, number>)[k] ?? 0),
          num(bv, (base as unknown as Record<string, number>)[k] ?? 0),
          u,
        );
      }
      for (const k of COLOR_PROPS) {
        const av = (a.props as Record<string, unknown>)[k] as string | undefined;
        const bv = (b.props as Record<string, unknown>)[k] as string | undefined;
        (out as Record<string, string>)[k] = lerpColor(av, bv, u)!;
      }
      for (const k of STEP_PROPS) {
        const av = (a.props as Record<string, unknown>)[k];
        (out as Record<string, unknown>)[k] =
          av != null ? av : (base as unknown as Record<string, unknown>)[k];
      }
      const bp = basePoints(base);
      (out as Record<string, unknown>).points = lerpPoints(
        Array.isArray(a.props.points) ? a.props.points : bp,
        Array.isArray(b.props.points) ? b.props.points : bp,
        u,
      );
      const az = (a.props as Record<string, unknown>).z;
      const bz = (b.props as Record<string, unknown>).z;
      // 层级：前半段（含中点）保持起点值，后半段切到终点，实现「置顶/置底」动画
      const z = az != null || bz != null ? (u <= 0.5 ? az ?? baseIndex : bz ?? baseIndex) : baseIndex;
      (out as Record<string, unknown>).z = z;
      return out;
    }
  }
  return fillProps(kfs[kfs.length - 1], base, baseIndex);
}

/**
 * 把插值后的属性套到基准元素上：
 * 围绕元素中心缩放（width/height + points，文本额外缩放 fontSize）→ 平移到目标 xy → 旋转 → 透明度
 * → 写回文字/样式/层级等全部捕获字段。
 */
export function applyProps(
  base: ExcalidrawElement,
  p: AnimProps,
): ExcalidrawElement {
  const out: Record<string, unknown> = { ...base };
  const scale = p.width != null ? p.width / (base.width || 1) : 1;

  const newW = p.width != null ? p.width : base.width;
  const newH = p.height != null ? p.height : base.height;
  let nx = p.x != null ? p.x : base.x;
  let ny = p.y != null ? p.y : base.y;
  // 中心保持：仅当尺寸被动画、且位置未被显式关键帧时，围绕原中心缩放，
  // 这样「只改宽高」的缩放动画会原地放大/缩小（剪映式）；显式关键帧了位置则尊重它。
  if (p.width != null && p.x == null) {
    nx = base.x + base.width / 2 - newW / 2;
  }
  if (p.height != null && p.y == null) {
    ny = base.y + base.height / 2 - newH / 2;
  }

  out.x = nx;
  out.y = ny;
  out.width = newW;
  out.height = newH;

  const pts = basePoints(base);
  if (pts && pts.length) {
    // 带顶点元素：尊重录制时点的真实形状（含弯曲），不再按宽高比缩放
    out.points = Array.isArray(p.points) ? p.points : pts.map(([px, py]) => [px * scale, py * scale] as [number, number]);
  }
  // 文本：缩放落到 fontSize 上，否则只改包围盒会错位
  if (base.type === "text" && typeof (base as { fontSize?: number }).fontSize === "number") {
    out.fontSize = p.fontSize != null ? p.fontSize : (base as { fontSize: number }).fontSize * scale;
  } else if (p.fontSize != null) {
    out.fontSize = p.fontSize;
  }

  out.angle = p.angle != null ? p.angle : base.angle;
  out.opacity = p.opacity != null ? p.opacity : base.opacity;

  // 写回文字 / 样式 / 离散字段（录制到了就覆盖，没录制则保留基准）
  const STYLE_PROPS: (keyof AnimProps)[] = [
    "strokeColor",
    "backgroundColor",
    "fillStyle",
    "strokeStyle",
    "strokeWidth",
    "roughness",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "text",
    "roundness",
  ];
  for (const k of STYLE_PROPS) {
    const v = (p as Record<string, unknown>)[k];
    if (v !== undefined) out[k as string] = v;
  }
  return out as unknown as ExcalidrawElement;
}

/** 生成某时刻的完整画布：有动画轨道的元素被插值替换并按 z 重排，无轨道的原样保留。 */
export function buildSceneAtTime(
  project: AnimProject,
  baseElements: readonly ExcalidrawElement[],
  t: number,
): ExcalidrawElement[] {
  const byId = new Map(project.tracks.map((tr) => [tr.elementId, tr]));
  const arr = baseElements.map((el, i) => {
    const track = byId.get(el.id);
    if (!track || track.keyframes.length === 0) return { el, z: i };
    const p = sampleTrack(track, t, el, i);
    const out = applyProps(el, p);
    const z = p.z != null ? p.z : i;
    return { el: out, z };
  });
  // 按层级 z 重排，实现置顶/置底动画
  arr.sort((a, b) => (a.z as number) - (b.z as number));
  return arr.map((x) => x.el);
}

/** 从画布元素提取可动画属性快照（打关键帧时用）。z 为该元素在场景中的序号。 */
export function propsFromElement(el: ExcalidrawElement, z?: number): AnimProps {
  const e = el as unknown as Record<string, unknown>;
  const p: AnimProps = {
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: el.angle,
    opacity: el.opacity,
    fontSize: e.fontSize as number | undefined,
    fontFamily: e.fontFamily as number | undefined,
    lineHeight: e.lineHeight as number | undefined,
    textAlign: e.textAlign as string | undefined,
    text: e.text as string | undefined,
    strokeColor: e.strokeColor as string | undefined,
    backgroundColor: e.backgroundColor as string | undefined,
    fillStyle: e.fillStyle as string | undefined,
    strokeStyle: e.strokeStyle as string | undefined,
    strokeWidth: e.strokeWidth as number | undefined,
    roughness: e.roughness as number | undefined,
    roundness: e.roundness,
    points: basePoints(el),
  };
  if (typeof z === "number") p.z = z;
  return p;
}

/** 全量属性签名：用于「页面是否变动」判定（字段一致即同签名，避免漏字段/误判）。 */
export function propsSignature(p: AnimProps): string {
  return JSON.stringify(p);
}

/**
 * 在播放头 t 处为某元素 upsert 关键帧：已存在同时间点则合并属性，否则新增。
 * 返回新的工程（不可变更新）。
 */
export function upsertKeyframe(
  project: AnimProject,
  elementId: string,
  t: number,
  props: AnimProps,
  easing: EasingType = "easeInOut",
): AnimProject {
  const tracks = project.tracks.map((tr) => ({
    ...tr,
    keyframes: tr.keyframes.slice(),
  }));
  let track = tracks.find((tr) => tr.elementId === elementId);
  if (!track) {
    track = { elementId, keyframes: [] };
    tracks.push(track);
  }
  const existing = track.keyframes.find((k) => Math.abs(k.t - t) < 1e-4);
  const kf: Keyframe = existing
    ? { ...existing, props: { ...existing.props, ...props }, easing: existing.easing || easing }
    : { id: uid("kf"), t, props, easing };
  track.keyframes = existing
    ? track.keyframes.map((k) => (k === existing ? kf : k))
    : [...track.keyframes, kf];
  track.keyframes.sort((a, b) => a.t - b.t);

  const idx = tracks.indexOf(track);
  tracks[idx] = track;
  return { ...project, tracks };
}

export function removeKeyframe(
  project: AnimProject,
  elementId: string,
  kfId: string,
): AnimProject {
  const tracks = project.tracks
    .map((tr) =>
      tr.elementId === elementId
        ? { ...tr, keyframes: tr.keyframes.filter((k) => k.id !== kfId) }
        : tr,
    )
    .filter((tr) => tr.keyframes.length > 0);
  return { ...project, tracks };
}

export function setKeyframeEasing(
  project: AnimProject,
  elementId: string,
  kfId: string,
  easing: EasingType,
): AnimProject {
  const tracks = project.tracks.map((tr) => {
    if (tr.elementId !== elementId) return tr;
    return {
      ...tr,
      keyframes: tr.keyframes.map((k) => (k.id === kfId ? { ...k, easing } : k)),
    };
  });
  return { ...project, tracks };
}

/** 删除某元素整条轨道（不再动画） */
export function deleteTrack(
  project: AnimProject,
  elementId: string,
): AnimProject {
  return {
    ...project,
    tracks: project.tracks.filter((tr) => tr.elementId !== elementId),
  };
}

/** 工程里出现过的所有元素 id（用于 UI 列出轨道） */
export function trackElementIds(project: AnimProject): string[] {
  return project.tracks.map((tr) => tr.elementId);
}
