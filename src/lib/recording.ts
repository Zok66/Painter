// 画布录制（过程回放）—— 与「关键帧补间」并列的第二种动画形式
//
// 两种动画的区别：
//   关键帧动画 = 记录元素在若干时刻的属性，中间由引擎插值补出来（剪映式）。
//   录制       = 忠实记录画布上发生过的每一次增删改，按真实时间轴重演（录屏式）。
//               所以用户画的一笔会「逐点生长」地重新画出来，删除也会真的消失。
//
// 数据模型：
//   RecProject = { fps, durationSec, initial[], events[] }
//   initial    = 录制起点画布上的元素（基线场景，按原场景顺序）
//   RecEvent   = { t, kind: "add" | "update" | "remove", id, ... }
//
// 采样：录制期间按 fps 定时把当前场景与「上次采样快照」做 diff，只把差异写成事件。
//   ① 用 version / versionNonce 快速跳过没动过的元素，避免每帧全量深比较；
//   ② points 支持「增量追加」——笔画生长时只存新增的那几个点，体积可从 O(n²) 降到 O(n)。
// 回放：从 initial 出发，按 t 依次重放事件，得到该时刻的完整场景。
//
// ⚠️ 快照必须深拷贝：Excalidraw 会原地 mutate 场景里的元素对象，
//    直接存引用会导致录到的全是「最终状态」，回放变成瞬移。

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

/** 序列化后的元素：纯数据对象（可 JSON 存盘），回放时再 cast 回 ExcalidrawElement */
export type SerializedElement = Record<string, unknown> & { id: string };

export type RecEventKind = "add" | "update" | "remove";

/** 一次 update 的差异：普通字段走 set，points 走增量追加（省体积） */
export interface RecPatch {
  set?: Record<string, unknown>;
  appendPoints?: number[][];
}

export interface RecEvent {
  /** 相对录制起点的秒数 */
  t: number;
  kind: RecEventKind;
  id: string;
  /** add：元素完整快照 */
  el?: SerializedElement;
  /** update：与上次快照的差异 */
  patch?: RecPatch;
}

export interface RecProject {
  version: 1;
  /** 采样帧率（也是回放/导出默认帧率） */
  fps: number;
  durationSec: number;
  /** 录制起点的基线场景（按原场景顺序） */
  initial: SerializedElement[];
  /** 按 t 升序 */
  events: RecEvent[];
}

export const DEFAULT_REC_FPS = 24;
export const REC_FPS_OPTIONS = [12, 24, 30] as const;
/** 单次录制的时长上限（秒），防止忘记停止把内存/localStorage 撑爆 */
export const MAX_REC_SECONDS = 300;
/** 事件条数上限，超过即自动停止 */
export const MAX_REC_EVENTS = 40000;

const PROJ_KEY = (pageId: string) => `painter:rec:${pageId}`;

// ── 值拷贝 / 比较 ────────────────────────────────────────
function cloneVal<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(v);
    } catch {
      /* 落到 JSON 兜底 */
    }
  }
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 元素 → 快照（顶层逐字段深拷贝，隔离 Excalidraw 的后续 mutate） */
export function snapshotElement(el: ExcalidrawElement | SerializedElement): SerializedElement {
  const out: Record<string, unknown> = {};
  const src = el as unknown as Record<string, unknown>;
  for (const k of Object.keys(src)) out[k] = cloneVal(src[k]);
  return out as SerializedElement;
}

/** 宽松深比较（数组/普通对象逐层比，函数与 undefined 视为相等当且仅当 ===） */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!looseEq(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!looseEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

type Pts = ReadonlyArray<readonly number[]>;

function ptsEqual(a: Pts, b: Pts): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.length !== q.length) return false;
    for (let j = 0; j < p.length; j++) if (p[j] !== q[j]) return false;
  }
  return true;
}

/** next 是否以 prev 开头（用于判定「只是在后面追加了点」） */
function ptsStartsWith(next: Pts, prev: Pts): boolean {
  if (next.length < prev.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const q = next[i];
    if (p.length !== q.length) return false;
    for (let j = 0; j < p.length; j++) if (p[j] !== q[j]) return false;
  }
  return true;
}

/** version 系列字段每次编辑都会变，但语义上不属于「内容」，差异里跳过 */
const SKIP_KEYS = new Set(["version", "versionNonce", "updated"]);

/**
 * 计算 prev → cur 的差异。无实质变化返回 null。
 * cur 是实时元素（会被 Excalidraw 原地改），故所有取值都要深拷贝。
 */
function diffElement(
  prev: SerializedElement,
  cur: ExcalidrawElement,
): RecPatch | null {
  const set: Record<string, unknown> = {};
  let changed = false;

  // points 单独处理（增量追加）
  const prevPts = (prev.points as Pts | undefined) ?? undefined;
  const curPts = (cur as unknown as { points?: Pts }).points;
  let appendPoints: number[][] | undefined;

  if (curPts) {
    if (!prevPts) {
      set.points = cloneVal(curPts as unknown as number[][]);
      changed = true;
    } else if (curPts.length > prevPts.length && ptsStartsWith(curPts, prevPts)) {
      // 只是在尾部追加了点（freedraw 生长的典型形态）：只存新增部分
      appendPoints = cloneVal(
        curPts.slice(prevPts.length) as unknown as number[][],
      );
      changed = true;
    } else if (!ptsEqual(curPts, prevPts)) {
      set.points = cloneVal(curPts as unknown as number[][]);
      changed = true;
    }
  }

  const src = cur as unknown as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    if (SKIP_KEYS.has(k) || k === "points") continue;
    const b = src[k];
    // 只比较 prev 里存在的字段；新出现的字段（类型变更等）直接算变化
    if (!(k in prev) || !looseEq(prev[k], b)) {
      set[k] = cloneVal(b);
      changed = true;
    }
  }

  if (!changed) return null;
  const patch: RecPatch = {};
  if (Object.keys(set).length) patch.set = set;
  if (appendPoints && appendPoints.length) patch.appendPoints = appendPoints;
  if (!patch.set && !patch.appendPoints) return null;
  return patch;
}

// ── 录制器 ───────────────────────────────────────────────
export interface RecorderOptions {
  fps: number;
  /** 录制起点的画布元素（作为基线场景） */
  elements: readonly ExcalidrawElement[];
}

/**
 * 画布录制器。用法：开始录制时 new 一个，按 fps 调 sample()，结束时 finish()。
 * 内部维护「上次采样快照」，sample 只吐出这一帧相对上一帧的差异。
 */
export class CanvasRecorder {
  readonly fps: number;
  private initial: SerializedElement[];
  private events: RecEvent[] = [];
  private prev = new Map<string, SerializedElement>();
  private lastT = 0;
  private overLimit = false;

  constructor(opts: RecorderOptions) {
    this.fps = Math.max(1, Math.round(opts.fps));
    // 基线：过滤掉已删除元素，保持原场景顺序（决定回放时的层级）
    this.initial = opts.elements
      .filter((el) => !(el as unknown as { isDeleted?: boolean }).isDeleted)
      .map((el) => snapshotElement(el));
    for (const el of this.initial) this.prev.set(el.id, el);
  }

  get eventCount(): number {
    return this.events.length;
  }

  get elapsedSec(): number {
    return this.lastT;
  }

  /** 是否触及上限（时长或事件数），触及后应由调用方停止录制 */
  get limitReached(): boolean {
    return this.overLimit;
  }

  /** 采样一帧：t 为相对录制起点的秒数 */
  sample(elements: readonly ExcalidrawElement[], t: number): void {
    this.lastT = Math.max(this.lastT, t);
    if (this.overLimit) return;

    const seen = new Set<string>();
    const batch: RecEvent[] = [];

    for (const el of elements) {
      if ((el as unknown as { isDeleted?: boolean }).isDeleted) continue;
      const id = el.id;
      seen.add(id);
      const prev = this.prev.get(id);
      if (!prev) {
        // 新元素：记 add（完整快照）
        const snap = snapshotElement(el);
        this.prev.set(id, snap);
        batch.push({ t, kind: "add", id, el: snap });
        continue;
      }
      // 快速通道：version 没变说明这一帧它没被编辑过（Excalidraw 每次 mutate 都会 bump）
      const pv = prev.version;
      const cv = (el as unknown as { version?: number }).version;
      if (
        typeof pv === "number" &&
        pv === cv &&
        prev.versionNonce === (el as unknown as { versionNonce?: number }).versionNonce
      ) {
        continue;
      }
      const patch = diffElement(prev, el);
      const snap = snapshotElement(el);
      this.prev.set(id, snap);
      if (patch) batch.push({ t, kind: "update", id, patch });
    }

    // 从场景里消失 = 被删除（撤销/删除/清空都走这条路）
    for (const id of [...this.prev.keys()]) {
      if (seen.has(id)) continue;
      this.prev.delete(id);
      batch.push({ t, kind: "remove", id });
    }

    if (batch.length) this.events.push(...batch);

    if (this.events.length > MAX_REC_EVENTS || this.lastT > MAX_REC_SECONDS) {
      this.overLimit = true;
    }
  }

  /** 收尾：产出工程。durationSec 由调用方给（真实录制时长） */
  finish(durationSec: number): RecProject {
    return {
      version: 1,
      fps: this.fps,
      durationSec: Math.max(0.1, durationSec),
      initial: this.initial,
      events: this.events.sort((a, b) => a.t - b.t),
    };
  }
}

// ── 回放 ─────────────────────────────────────────────────
function applyPatch(cur: SerializedElement, patch: RecPatch): SerializedElement {
  const next: SerializedElement = { ...cur, ...(patch.set ?? {}) };
  if (patch.appendPoints && patch.appendPoints.length) {
    const base = (cur.points as number[][] | undefined) ?? [];
    next.points = [...base, ...patch.appendPoints];
  }
  return next;
}

/**
 * 重建 t 时刻的完整场景：从基线出发，重放所有 t' <= t 的事件。
 * 返回的元素对象是浅拷贝（共享 points 等子对象），每帧重建成本很低；
 * 即便 Excalidraw 原地改了这些临时对象，下一帧也会从工程数据重放，不污染源数据。
 */
export function buildRecordSceneAtTime(
  project: RecProject,
  t: number,
): ExcalidrawElement[] {
  const map = new Map<string, SerializedElement>();
  const order: string[] = [];
  for (const el of project.initial) {
    map.set(el.id, el);
    order.push(el.id);
  }
  for (const ev of project.events) {
    if (ev.t > t + 1e-6) break;
    if (ev.kind === "add" && ev.el) {
      if (!map.has(ev.id)) order.push(ev.id);
      map.set(ev.id, ev.el);
    } else if (ev.kind === "update" && ev.patch) {
      const cur = map.get(ev.id);
      if (cur) map.set(ev.id, applyPatch(cur, ev.patch));
    } else if (ev.kind === "remove") {
      map.delete(ev.id);
    }
  }
  const out: ExcalidrawElement[] = [];
  // order 里同一 id 可能出现多次（remove 后又 add，如撤销删除），
  // 只按「最后一次插入」的位置输出一次，避免场景出现重复元素
  const lastIdx = new Map<string, number>();
  order.forEach((id, i) => lastIdx.set(id, i));
  for (let i = 0; i < order.length; i++) {
    if (lastIdx.get(order[i]) !== i) continue;
    const el = map.get(order[i]);
    if (el) out.push({ ...el } as unknown as ExcalidrawElement);
  }
  return out;
}

// ── 面板用的统计信息 ──────────────────────────────────────
export interface RecElementRow {
  id: string;
  type: string;
  /** 出现时刻（基线里就有 = 0） */
  startT: number;
  /** 消失时刻（null = 一直存在到最后） */
  endT: number | null;
  /** 每次属性更新的时刻 */
  updates: number[];
}

/** 把事件流整理成「每个元素一条时间条」，供时间轴面板渲染 */
export function recordingRows(project: RecProject): RecElementRow[] {
  const rows = new Map<string, RecElementRow>();
  const ensure = (id: string, type?: string): RecElementRow => {
    let r = rows.get(id);
    if (!r) {
      r = { id, type: type ?? "元素", startT: 0, endT: null, updates: [] };
      rows.set(id, r);
    }
    return r;
  };
  for (const el of project.initial) {
    ensure(el.id, String(el.type ?? "元素"));
  }
  for (const ev of project.events) {
    const r = ensure(ev.id);
    if (ev.kind === "add") {
      if (ev.el && (!r.type || r.type === "元素")) r.type = String(ev.el.type ?? "元素");
      r.startT = ev.t;
      r.endT = null;
    } else if (ev.kind === "remove") {
      r.endT = ev.t;
    } else if (ev.kind === "update") {
      r.updates.push(ev.t);
    }
  }
  return [...rows.values()].sort((a, b) => a.startT - b.startT);
}

export interface RecSummary {
  elements: number;
  events: number;
  adds: number;
  updates: number;
  removes: number;
}

export function recordingSummary(project: RecProject): RecSummary {
  let adds = 0;
  let updates = 0;
  let removes = 0;
  for (const ev of project.events) {
    if (ev.kind === "add") adds += 1;
    else if (ev.kind === "update") updates += 1;
    else removes += 1;
  }
  return {
    elements: recordingRows(project).length,
    events: project.events.length,
    adds,
    updates,
    removes,
  };
}

// ── 区间剪辑（选择片段删除 / 保留）─────────────────────────
//
// 两类操作都基于「删除一部分事件、把剩余事件的时间轴平移」，区别只是保留哪段：
//   deleteRange：删掉 [t0, t1] 内的事件，t1 之后的事件整体左移 (t1-t0)。
//   keepRange ：只留 [t0, t1] 内的事件，区间内的事件整体左移 t0。
//
// 平移后可能出现「元素的 add 被删了、但它在更晚的时刻还有 update/remove」的悬空引用
// （典型：一笔横跨被剪区间）。这类元素在回放时会凭空消失，体验不对。
// 解决：用被剪区间起点的场景做锚点，给这类孤儿子元素补一个 add，
// 让它们从「区间前的状态」无缝续上。

/**
 * 给 ke 补「add 被剪掉、但元素在锚点时刻仍存在」的 add 锚点，保证回放连续。
 * 关键：以 anchorT（被剪区间右端）的场景为基准扫描——只要元素那一刻在场、
 * 且它的 add 不在保留事件里（add 落在被剪区间内），就补一个 add@anchorAt。
 * 这覆盖了「一笔笔画完整画在被剪区间内、之后再没被改过」的情况：
 * 它没有任何 kept 事件，若不补锚点会被整体抹除（用户视角=整层消失）。
 */
function applyAnchorAdds(
  project: RecProject,
  kept: RecEvent[],
  anchorT: number,
  anchorAt: number,
): RecEvent[] {
  const before = buildRecordSceneAtTime(project, Math.max(0, anchorT) + 1e-4);
  const initialIds = new Set(project.initial.map((el) => el.id));
  const addedIds = new Set<string>();
  for (const e of kept) if (e.kind === "add") addedIds.add(e.id);

  const extra: RecEvent[] = [];
  for (const el of before) {
    if (initialIds.has(el.id) || addedIds.has(el.id)) continue;
    extra.push({ t: anchorAt, kind: "add", id: el.id, el: snapshotElement(el) });
  }
  if (!extra.length) return kept;
  return [...extra, ...kept].sort((a, b) => a.t - b.t);
}

/** 删除 [t0, t1] 时间区间内的所有事件，之后事件前移拼接 */
export function deleteRange(
  project: RecProject,
  t0: number,
  t1: number,
): RecProject {
  if (!(t1 > t0) || project.events.length === 0) return project;
  const eps = 1e-6;
  const shift = t1 - t0;
  const kept: RecEvent[] = [];
  for (const e of project.events) {
    if (e.t >= t0 - eps && e.t <= t1 + eps) continue; // 落在被删区间
    kept.push(e.t > t1 ? { ...e, t: e.t - shift } : { ...e });
  }
  const events = applyAnchorAdds(project, kept, t1, t0);
  return {
    ...project,
    durationSec: Math.max(0.1, project.durationSec - shift),
    events,
  };
}

/** 只保留 [t0, t1] 区间内的事件，区间外全部丢弃，区间内事件前移使 t0→0 */
export function keepRange(
  project: RecProject,
  t0: number,
  t1: number,
): RecProject {
  if (!(t1 > t0) || project.events.length === 0) return project;
  const eps = 1e-6;
  const kept: RecEvent[] = [];
  for (const e of project.events) {
    if (e.t < t0 - eps || e.t > t1 + eps) continue; // 丢区间外
    kept.push({ ...e, t: Math.max(0, e.t - t0) });
  }
  const events = applyAnchorAdds(project, kept, t0, 0);
  return {
    ...project,
    durationSec: Math.max(0.1, t1 - t0),
    events,
  };
}

// ── 按元素（分层）剪辑 ────────────────────────────────────
//
// 与全局剪辑的区别：只动目标元素自己的事件，**不移动全局时间轴**（其他元素不动）。
// 元素在被剪区间内的「消失 / 续接」靠补 add/remove 锚点实现：
//   删区间 [t0,t1]：区间前活着 → 补 remove@t0；区间后还活着 → 补 add@t1（取 t1 后状态）。
//   留区间 [t0,t1]：区间前活着 → 补 add@t0（取 t0 前状态）；区间后还活着 → 补 remove@t1。

/** 元素在「严格某时刻」的状态；不在场景里返回 null */
function elementStateAtTime(
  project: RecProject,
  id: string,
  t: number,
): SerializedElement | null {
  const scene = buildRecordSceneAtTime(project, t);
  const el = scene.find((e) => e.id === id);
  return el ? snapshotElement(el) : null;
}

/** 删除指定元素在 [t0, t1] 内的内容：该元素区间内消失，区间外原样（含跨区间续接） */
export function deleteElementRange(
  project: RecProject,
  id: string,
  t0: number,
  t1: number,
): RecProject {
  if (!(t1 > t0)) return project;
  const eps = 1e-6;
  const before = elementStateAtTime(project, id, Math.max(0, t0 - eps));
  const after = elementStateAtTime(project, id, t1 + eps);
  // 只丢弃该元素落在区间内的事件，其他元素的事件原样保留
  const kept = project.events.filter(
    (e) => e.id !== id || e.t < t0 - eps || e.t > t1 + eps,
  );
  const extra: RecEvent[] = [];
  if (before) extra.push({ t: t0, kind: "remove", id });
  if (after) extra.push({ t: t1, kind: "add", id, el: after });
  if (!extra.length) return { ...project, events: kept };
  return { ...project, events: [...extra, ...kept].sort((a, b) => a.t - b.t) };
}

/** 只保留指定元素在 [t0, t1] 内的内容：该元素区间外消失，其他元素原样 */
export function keepElementRange(
  project: RecProject,
  id: string,
  t0: number,
  t1: number,
): RecProject {
  if (!(t1 > t0)) return project;
  const eps = 1e-6;
  const before = elementStateAtTime(project, id, Math.max(0, t0 - eps));
  const after = elementStateAtTime(project, id, t1 + eps);
  // 其他元素的事件原样保留；目标元素只留区间内的事件
  const kept = project.events.filter(
    (e) => e.id !== id || (e.t >= t0 - eps && e.t <= t1 + eps),
  );
  const extra: RecEvent[] = [];
  if (before) extra.push({ t: t0, kind: "add", id, el: before });
  if (after) extra.push({ t: t1, kind: "remove", id });
  if (!extra.length) return { ...project, events: kept };
  return { ...project, events: [...extra, ...kept].sort((a, b) => a.t - b.t) };
}

/**
 * 把目标元素的所有事件整体水平平移 dt 秒（剪映式拖动时间条）。
 * 基线元素（事件流里没有它 → 始终依赖 initial））无事件可平移，原样返回。
 * 平移范围 clamp 到 [0, durationSec]——整体不出时间轴。
 */
export function shiftElement(
  project: RecProject,
  id: string,
  deltaT: number,
): RecProject {
  if (!deltaT) return project;
  const elementEvents = project.events.filter((e) => e.id === id);
  if (elementEvents.length === 0) return project;
  const minT = Math.min(...elementEvents.map((e) => e.t));
  const maxT = Math.max(...elementEvents.map((e) => e.t));
  let dt = deltaT;
  if (dt < -minT) dt = -minT;
  if (dt > project.durationSec - maxT) dt = project.durationSec - maxT;
  if (!dt) return project;
  const events = project.events
    .map((e) => (e.id === id ? { ...e, t: Math.max(0, e.t + dt) } : e))
    .sort((a, b) => a.t - b.t);
  return { ...project, events };
}

/**
 * 自动裁掉空白片段：把事件聚类成「有效段」，段与段之间超过 pad 秒的空档
 * 压缩为 pad（保留一点呼吸感），掐掉开头/结尾的空白。
 * 纯时间映射——不丢任何事件，所以没有锚点/连续性问题。
 */
export function trimBlankSegments(project: RecProject, pad = 0.2): RecProject {
  if (project.events.length === 0) return project;
  const times = project.events.map((e) => e.t).sort((a, b) => a - b);
  // 聚类：相邻事件间隔 > pad 即分段
  const segs: Array<[number, number]> = [];
  let segStart = times[0];
  let prev = times[0];
  for (let i = 1; i < times.length; i++) {
    const t = times[i];
    if (t - prev > pad) {
      segs.push([segStart, prev]);
      segStart = t;
    }
    prev = t;
  }
  segs.push([segStart, prev]);
  // 时间映射：第 i 段整体左移 offset_i，段与段之间留 pad
  const offsets: number[] = [];
  let cursor = 0;
  for (const [s, e] of segs) {
    offsets.push(s - cursor);
    cursor += e - s + pad;
  }
  // 裁后时长 = 累积游标减去最后一段多加的 pad（= 各段长度之和 + 段间垫片）
  const events = project.events
    .map((ev) => {
      for (let i = segs.length - 1; i >= 0; i--) {
        if (ev.t >= segs[i][0] - 1e-9) {
          return { ...ev, t: Math.max(0, ev.t - offsets[i]) };
        }
      }
      return { ...ev };
    })
    .sort((a, b) => a.t - b.t);
  return { ...project, events, durationSec: Math.max(0.1, cursor - pad) };
}

// ── 存取（挂在笔记本页上，与关键帧工程同策略）──────────────
export function createRecording(fps: number): RecProject {
  return { version: 1, fps, durationSec: 0, initial: [], events: [] };
}

export function loadRecording(pageId: string): RecProject | null {
  try {
    const raw = localStorage.getItem(PROJ_KEY(pageId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<RecProject>;
    if (!p || p.version !== 1 || !Array.isArray(p.events)) return null;
    return {
      version: 1,
      fps: Number(p.fps) || DEFAULT_REC_FPS,
      durationSec: Number(p.durationSec) || 0,
      initial: Array.isArray(p.initial) ? p.initial : [],
      events: p.events,
    };
  } catch {
    return null;
  }
}

/** 存盘。localStorage 有 5MB 配额，写不下时返回 false（调用方提示用户） */
export function saveRecording(pageId: string, p: RecProject): boolean {
  try {
    localStorage.setItem(PROJ_KEY(pageId), JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function deleteRecording(pageId: string): void {
  try {
    localStorage.removeItem(PROJ_KEY(pageId));
  } catch {
    /* 忽略 */
  }
}
