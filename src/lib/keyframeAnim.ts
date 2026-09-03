// 帧动画 · 关键帧补间引擎（剪映逻辑）
//
// 数据模型：
//   AnimProject = { fps, durationSec, tracks[] }
//   AnimTrack   = { elementId, keyframes[] }   一个画布元素一条轨道
//   Keyframe    = { t(秒), props, easing }     记录某时刻该元素的属性
//
// 关键思路：只存「基准场景 + 关键帧差异属性」，播放/预览/导出时
// 用 buildSceneAtTime() 在任意时间点对属性做插值，生成那一帧的完整画布。
// 比逐帧快照体积小，且天然支持「关键帧之间自动补间」。

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type EasingType = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface AnimProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** 弧度，Excalidraw 内部统一用 Radians */
  angle?: number;
  /** 0-100 */
  opacity?: number;
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

const PROJ_KEY = (pageId: string) => `painter:anim:${pageId}`;
const BASE_KEY = (pageId: string) => `painter:anim:base:${pageId}`;

const PROP_KEYS: (keyof AnimProps)[] = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "opacity",
];

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

// 关键帧没写的属性，回落到基准元素的当前值
function fillProps(kf: Keyframe, base: ExcalidrawElement): AnimProps {
  const out: AnimProps = {};
  for (const k of PROP_KEYS) {
    const v = k in kf.props && kf.props[k] != null ? kf.props[k] : (base as Record<string, unknown>)[k];
    (out as Record<string, unknown>)[k] = v;
  }
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
): AnimProps {
  const kfs = track.keyframes;
  if (kfs.length === 0) {
    return {
      x: base.x,
      y: base.y,
      width: base.width,
      height: base.height,
      angle: base.angle,
      opacity: base.opacity,
    };
  }
  if (t <= kfs[0].t) return fillProps(kfs[0], base);
  if (t >= kfs[kfs.length - 1].t) return fillProps(kfs[kfs.length - 1], base);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1e-6;
      const u = ease((t - a.t) / span, a.easing);
      const out: AnimProps = {};
      for (const k of PROP_KEYS) {
        const av =
          k in a.props && a.props[k] != null
            ? (a.props[k] as number)
            : (base as unknown as Record<string, number>)[k];
        const bv =
          k in b.props && b.props[k] != null
            ? (b.props[k] as number)
            : (base as unknown as Record<string, number>)[k];
        (out as Record<string, number>)[k] = lerp(av, bv, u);
      }
      return out;
    }
  }
  return fillProps(kfs[kfs.length - 1], base);
}

/**
 * 把插值后的属性套到基准元素上：
 * 围绕元素中心缩放（width/height + points，文本额外缩放 fontSize）→ 平移到目标 xy → 旋转 → 透明度。
 */
export function applyProps(
  base: ExcalidrawElement,
  p: AnimProps,
): ExcalidrawElement {
  const out: Record<string, unknown> = { ...base };
  const scale =
    p.width != null ? p.width / (base.width || 1) : 1;

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

  const pts = (base as unknown as { points?: ReadonlyArray<readonly [number, number]> }).points;
  if (pts && Array.isArray(pts)) {
    // freedraw / line / arrow：顶点随缩放等比变换
    out.points = pts.map(
      ([px, py]) => [px * scale, py * scale] as [number, number],
    );
  }
  // 文本：缩放落到 fontSize 上，否则只改包围盒会错位
  if (base.type === "text" && typeof (base as { fontSize?: number }).fontSize === "number") {
    out.fontSize = (base as { fontSize: number }).fontSize * scale;
  }

  out.angle = p.angle != null ? p.angle : base.angle;
  out.opacity = p.opacity != null ? p.opacity : base.opacity;
  return out as unknown as ExcalidrawElement;
}

/** 生成某时刻的完整画布：有动画轨道的元素被插值替换，无轨道的原样保留。 */
export function buildSceneAtTime(
  project: AnimProject,
  baseElements: readonly ExcalidrawElement[],
  t: number,
): ExcalidrawElement[] {
  const byId = new Map(project.tracks.map((tr) => [tr.elementId, tr]));
  return baseElements.map((el) => {
    const track = byId.get(el.id);
    if (!track || track.keyframes.length === 0) return el;
    const p = sampleTrack(track, t, el);
    return applyProps(el, p);
  });
}

/** 从画布元素提取可动画属性快照（打关键帧时用） */
export function propsFromElement(el: ExcalidrawElement): AnimProps {
  return {
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: el.angle,
    opacity: el.opacity,
  };
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
