// 动画数据层
//
// 作用域是「当前笔记本页」：动画轨道挂在 painter:anim:<pageId> 上，
// 切页时动画跟着页走，不同页各有自己的帧序列。
//
// 帧内容存元素快照而不是像素：手绘是矢量的，快照可以再编辑、缩放不失真，
// 体积也比逐帧位图小得多。每帧一个独立 key（painter:frame:<frameId>），
// 切帧只读写一帧，帧数多了也不卡。
//
// 快照格式与笔记本页一致（serializeAsJSON 的字符串），
// 读回来必须过 restoreElements，跟 loadPageById 保持同一套。

export interface AnimFrame {
  id: string;
  /** 停留时长，单位为「帧」（GIF 里换算成 delay）。最小 1 */
  hold: number;
}

export interface OnionConfig {
  enabled: boolean;
  /** 往前看几帧（红色调） */
  before: number;
  /** 往后看几帧（绿色调） */
  after: number;
  /** 幽灵元素不透明度，0-100 */
  opacity: number;
}

export interface AnimTrack {
  version: 1;
  fps: number;
  frames: AnimFrame[];
  onion: OnionConfig;
  /** 这一页上次停在哪个帧，切页回来还停在那儿 */
  lastFrameId: string;
  updatedAt: number;
}

export const DEFAULT_FPS = 12;
export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MAX_ONION = 5;

const TRACK_PREFIX = "painter:anim:";
const FRAME_PREFIX = "painter:frame:";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function trackKey(pageId: string): string {
  return `${TRACK_PREFIX}${pageId}`;
}

export function frameKey(frameId: string): string {
  return `${FRAME_PREFIX}${frameId}`;
}

export function createFrame(hold = 1): AnimFrame {
  return { id: newId(), hold: Math.max(1, Math.round(hold)) };
}

export function createTrack(): AnimTrack {
  const first = createFrame();
  return {
    version: 1,
    fps: DEFAULT_FPS,
    frames: [first],
    onion: { enabled: true, before: 1, after: 1, opacity: 30 },
    lastFrameId: first.id,
    updatedAt: Date.now(),
  };
}

/** 容错：fps / hold / 洋葱皮范围都夹回合法区间，空帧列表补一帧 */
function normalize(track: AnimTrack): AnimTrack {
  const frames = (Array.isArray(track.frames) ? track.frames : [])
    .filter((f) => f && typeof f.id === "string")
    .map((f) => ({ id: f.id, hold: Math.min(100, Math.max(1, Math.round(f.hold) || 1)) }));
  if (frames.length === 0) frames.push(createFrame());
  const onion = track.onion ?? {
    enabled: true,
    before: 1,
    after: 1,
    opacity: 30,
  };
  // lastFrameId 指向的帧可能已被删除，失效就退回第一帧
  const lastFrameId = frames.some((f) => f.id === track.lastFrameId)
    ? track.lastFrameId
    : frames[0].id;
  return {
    version: 1,
    fps: Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(track.fps) || DEFAULT_FPS)),
    frames,
    lastFrameId,
    onion: {
      enabled: !!onion.enabled,
      before: Math.min(MAX_ONION, Math.max(0, Math.round(onion.before) || 0)),
      after: Math.min(MAX_ONION, Math.max(0, Math.round(onion.after) || 0)),
      opacity: Math.min(100, Math.max(5, Math.round(onion.opacity) || 30)),
    },
    updatedAt: track.updatedAt ?? Date.now(),
  };
}

export function loadTrack(pageId: string): AnimTrack {
  try {
    const raw = localStorage.getItem(trackKey(pageId));
    if (raw) {
      const parsed = JSON.parse(raw) as AnimTrack;
      if (parsed && Array.isArray(parsed.frames)) return normalize(parsed);
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return createTrack();
}

export function saveTrack(pageId: string, track: AnimTrack) {
  try {
    localStorage.setItem(
      trackKey(pageId),
      JSON.stringify({ ...track, updatedAt: Date.now() }),
    );
  } catch {
    /* 隐私模式 / 配额满：静默失败，画布本身也是这个策略 */
  }
}

export function deleteTrack(pageId: string) {
  try {
    const track = loadTrack(pageId);
    for (const f of track.frames) localStorage.removeItem(frameKey(f.id));
    localStorage.removeItem(trackKey(pageId));
  } catch {
    /* 忽略 */
  }
}

export function loadFrameScene(frameId: string): unknown | null {
  try {
    const raw = localStorage.getItem(frameKey(frameId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveFrameScene(frameId: string, scene: unknown) {
  try {
    const value = typeof scene === "string" ? scene : JSON.stringify(scene);
    localStorage.setItem(frameKey(frameId), value);
  } catch {
    /* 忽略 */
  }
}

export function deleteFrameScene(frameId: string) {
  try {
    localStorage.removeItem(frameKey(frameId));
  } catch {
    /* 忽略 */
  }
}

export function findFrameIndex(track: AnimTrack, frameId: string): number {
  return track.frames.findIndex((f) => f.id === frameId);
}

/** 在指定帧之后插入一帧，返回新轨道与新帧 id */
export function insertFrameAfter(
  track: AnimTrack,
  frameId: string | null,
  hold = 1,
): { track: AnimTrack; frameId: string } {
  const frame = createFrame(hold);
  const frames = [...track.frames];
  const idx = frameId ? findFrameIndex(track, frameId) : frames.length - 1;
  frames.splice(idx < 0 ? frames.length : idx + 1, 0, frame);
  return { track: { ...track, frames }, frameId: frame.id };
}

export function removeFrame(track: AnimTrack, frameId: string): AnimTrack {
  const frames = track.frames.filter((f) => f.id !== frameId);
  return { ...track, frames: frames.length ? frames : [createFrame()] };
}

/** 把某帧挪到目标下标（拖拽排序） */
export function moveFrame(
  track: AnimTrack,
  frameId: string,
  toIndex: number,
): AnimTrack {
  const from = findFrameIndex(track, frameId);
  if (from < 0) return track;
  const frames = [...track.frames];
  const [moved] = frames.splice(from, 1);
  const clamped = Math.min(frames.length, Math.max(0, toIndex));
  frames.splice(clamped, 0, moved);
  return { ...track, frames };
}

export function setFrameHold(
  track: AnimTrack,
  frameId: string,
  hold: number,
): AnimTrack {
  return {
    ...track,
    frames: track.frames.map((f) =>
      f.id === frameId
        ? { ...f, hold: Math.min(100, Math.max(1, Math.round(hold) || 1)) }
        : f,
    ),
  };
}

/** 动画总时长（秒），按每帧 hold 累加 */
export function trackDuration(track: AnimTrack): number {
  const total = track.frames.reduce((sum, f) => sum + f.hold, 0);
  return total / track.fps;
}
