// 动画时间轴（关键帧补间 · 剪映风）
//
// 面板只管 UI 与交互，动画数据的存/取、播放、导出由 App 通过回调落地（和 NotebookPanel 一个路子）。
// - 左侧：动画元素轨道列表（点一下 = 选中画布上那个元素）
// - 右侧：时间标尺 + 可拖动播放头 + 每轨关键帧菱形（拖动改时间、点选改缓动、删除）
// - 选中画布元素后，在播放头处「添加关键帧」即记录该元素当前属性

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import {
  EASING_LABELS,
  type AnimProject,
  type EasingType,
} from "../lib/keyframeAnim";
import type { OnionConfig } from "../lib/onionSkin";
import "./AnimationTimeline.css";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 统一线性风格图标（仿 Excalidraw 原生细描边 / currentColor / 24×24 viewBox）
type IconName = "play" | "pause" | "chevron-up" | "chevron-down" | "close";

const ICON_PATHS: Record<IconName, ReactNode> = {
  play: <polygon points="6 4 20 12 6 20" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </>
  ),
  "chevron-up": <polyline points="6 14 12 8 18 14" />,
  "chevron-down": <polyline points="6 10 12 16 18 10" />,
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = name === "play" || name === "pause";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export interface AnimationTimelineProps {
  project: AnimProject;
  playheadT: number;
  playing: boolean;
  fps: number;
  durationSec: number;
  onion: OnionConfig;
  /** 把元素 id 翻译成展示名 */
  elementName: (id: string) => string;
  /** 画布当前选中的单个元素 id */
  selectedElementId: string | null;
  /** 当前选中的编组 id（用于高亮 group 行），非编组选中时为 null */
  selectedGroupId?: string | null;
  /** 元素所属编组 id（没有则返回 null）—— 用于把多条轨道聚合显示为「编组」一行 */
  groupOf?: (id: string) => string | null;
  files: BinaryFiles;
  baseElements: readonly ExcalidrawElement[];
  onAddKeyframe: () => void;
  onSelectTrack: (id: string) => void;
  onDeleteKeyframe: (elementId: string, kfId: string) => void;
  onMoveKeyframe: (elementId: string, kfId: string, t: number) => void;
  onSetEasing: (elementId: string, kfId: string, easing: EasingType) => void;
  onDeleteTrack: (elementId: string) => void;
  onFpsChange: (fps: number) => void;
  onDurationChange: (sec: number) => void;
  onOnionChange: (onion: OnionConfig) => void;
  onPlayheadChange: (t: number) => void;
  onPlayToggle: () => void;
  playMode: "once" | "loop";
  onPlayModeChange: (mode: "once" | "loop") => void;
  onExportGif: (scale: number, background: boolean) => void;
  exporting: boolean;
  exportProgress: { done: number; total: number };
  onClose: () => void;
}

export default function AnimationTimeline(props: AnimationTimelineProps) {
  const {
    project,
    playheadT,
    playing,
    fps,
    durationSec,
    onion,
    elementName,
    selectedElementId,
    selectedGroupId,
    groupOf,
    onAddKeyframe,
    onSelectTrack,
    onDeleteKeyframe,
    onMoveKeyframe,
    onSetEasing,
    onDeleteTrack,
    onFpsChange,
    onDurationChange,
    onOnionChange,
    onPlayheadChange,
    onPlayToggle,
    playMode,
    onPlayModeChange,
    onExportGif,
    exporting,
    exportProgress,
    onClose,
  } = props;

  const laneRef = useRef<HTMLDivElement | null>(null);
  /** 关键帧引用：单元素 keyframe，或编组在某时刻的批量关键帧（作用于所有成员） */
  type KfRef =
    | { elementId: string; kfId: string }
    | { groupId: string; t: number; members: { elementId: string; kfId: string }[] };
  const [draggingKf, setDraggingKf] = useState<KfRef | null>(null);
  const [selectedKf, setSelectedKf] = useState<KfRef | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exportScale, setExportScale] = useState(1);
  const [exportBg, setExportBg] = useState(false);
  const [showOnion, setShowOnion] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // 区分单击 vs 拖动：pointerdown 仅记起点，超过 3px 才进入真正的拖动
  type PointerDown =
    | { elementId: string; kfId: string; startX: number; startY: number }
    | {
        groupId: string;
        t: number;
        members: { elementId: string; kfId: string }[];
        startX: number;
        startY: number;
      };
  const pointerDownRef = useRef<PointerDown | null>(null);
  // 镜像到 ref，给全局监听器读最新值，避免 effect 频繁重建
  const draggingKfRef = useRef(draggingKf);
  const selectedKfRef = useRef(selectedKf);
  useEffect(() => {
    draggingKfRef.current = draggingKf;
  }, [draggingKf]);
  useEffect(() => {
    selectedKfRef.current = selectedKf;
  }, [selectedKf]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      // 收起的瞬间把展开中的子面板也关掉，避免折叠后再展开弹回洋葱皮/导出对话框
      if (next) {
        setShowOnion(false);
        setShowExport(false);
      }
      return next;
    });
  };

  const pct = (t: number) => `${(t / durationSec) * 100}%`;

  // 拖动关键帧 / 播放头：在轨道区上换算时间
  const tFromClientX = (clientX: number) => {
    const el = laneRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * durationSec, 0, durationSec);
  };

  useEffect(() => {
    const DRAG_THRESHOLD = 3; // px
    const move = (e: PointerEvent) => {
      const pd = pointerDownRef.current;
      if (!pd) return;
      const dragging = draggingKfRef.current;
      if (!dragging) {
        // 还没真正进入拖动：检测是否越过阈值，越过则升级为拖动
        const dx = Math.abs(e.clientX - pd.startX);
        const dy = Math.abs(e.clientY - pd.startY);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          if ("groupId" in pd) {
            setDraggingKf({
              groupId: pd.groupId,
              t: pd.t,
              members: pd.members,
            });
          } else {
            setDraggingKf({ elementId: pd.elementId, kfId: pd.kfId });
          }
        }
        return;
      }
      // 已在拖动中：实时改关键帧时间 + 拖动播放头
      const t = tFromClientX(e.clientX);
      onPlayheadChange(t);
      if (dragging && "groupId" in dragging) {
        for (const m of dragging.members) {
          onMoveKeyframe(m.elementId, m.kfId, t);
        }
      } else if (dragging) {
        onMoveKeyframe(dragging.elementId, dragging.kfId, t);
      }
    };
    const up = () => {
      const pd = pointerDownRef.current;
      const dragging = draggingKfRef.current;
      // 没有发生拖动 = 视作单击 → 选中（不要立即覆盖正在拖动结束的选中态）
      if (pd && !dragging) {
        if ("groupId" in pd) {
          setSelectedKf({ groupId: pd.groupId, t: pd.t, members: pd.members });
        } else {
          setSelectedKf({ elementId: pd.elementId, kfId: pd.kfId });
        }
      }
      pointerDownRef.current = null;
      setDraggingKf(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键盘删除：选中关键帧时按 Delete / Backspace 直接删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const sel = selectedKfRef.current;
      if (!sel) return;
      // 输入框 / select / textarea 中 Backspace 属于正常编辑，不抢
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if ("groupId" in sel) {
        for (const m of sel.members) onDeleteKeyframe(m.elementId, m.kfId);
      } else {
        onDeleteKeyframe(sel.elementId, sel.kfId);
      }
      setSelectedKf(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 时间标尺刻度（每 0.5s 一条）
  const ticks: number[] = [];
  for (let s = 0; s <= durationSec + 1e-6; s += 0.5) ticks.push(Math.round(s * 100) / 100);

  const hasSelection = !!selectedElementId;
  const selectionTracked = selectedElementId
    ? project.tracks.some((tr) => tr.elementId === selectedElementId)
    : false;

  // 聚合轨道行：同 group 的多条 track 合并显示为一行「编组 (N)」
  const resolveGroup = groupOf ?? (() => null);
  const groupRows = new Map<string, string[]>();
  const soloRows: string[] = [];
  for (const tr of project.tracks) {
    const g = resolveGroup(tr.elementId);
    if (g) {
      if (!groupRows.has(g)) groupRows.set(g, []);
      groupRows.get(g)!.push(tr.elementId);
    } else {
      soloRows.push(tr.elementId);
    }
  }
  const animRows: { isGroup: boolean; key: string; ids: string[] }[] = [];
  for (const [g, ids] of groupRows) animRows.push({ isGroup: true, key: g, ids });
  for (const id of soloRows) animRows.push({ isGroup: false, key: id, ids: [id] });

  return (
    <div className="anim-timeline">
      <div className="anim-header">
        <button className="anim-play" onClick={onPlayToggle} title="播放/停止（空格）">
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <div className="anim-playmode" role="group" aria-label="播放模式">
          <button
            type="button"
            className={playMode === "loop" ? "active" : ""}
            onClick={() => onPlayModeChange("loop")}
            title="循环播放"
          >
            循环
          </button>
          <button
            type="button"
            className={playMode === "once" ? "active" : ""}
            onClick={() => onPlayModeChange("once")}
            title="播放一次"
          >
            一次
          </button>
        </div>
        <span className="anim-time">
          {playheadT.toFixed(2)}s / {durationSec.toFixed(2)}s
        </span>
        <label className="anim-field">
          FPS
          <input
            type="number"
            min={1}
            max={60}
            value={fps}
            onChange={(e) => onFpsChange(Number(e.target.value) || 1)}
          />
        </label>
        <label className="anim-field">
          时长(s)
          <input
            type="number"
            min={0.2}
            max={60}
            step={0.1}
            value={durationSec}
            onChange={(e) => onDurationChange(Number(e.target.value) || 1)}
          />
        </label>
        <button className="anim-btn" onClick={() => setShowOnion((v) => !v)}>
          洋葱皮
        </button>
        <button className="anim-btn" onClick={() => setShowExport((v) => !v)}>
          {exporting
            ? `导出中 ${exportProgress.done}/${exportProgress.total}`
            : "导出 GIF"}
        </button>
        <button
          className="anim-collapse"
          onClick={toggleCollapsed}
          title={collapsed ? "展开详情" : "收起详情"}
          aria-label={collapsed ? "展开详情" : "收起详情"}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? "chevron-up" : "chevron-down"} />
        </button>
        <button className="anim-btn ghost" onClick={onClose} title="关闭">
          <Icon name="close" />
        </button>
      </div>

      {!collapsed && showOnion && (
        <div className="anim-onion">
          <label>
            <input
              type="checkbox"
              checked={onion.enabled}
              onChange={(e) => onOnionChange({ ...onion, enabled: e.target.checked })}
            />
            开启
          </label>
          <label>
            前
            <input
              type="number"
              min={0}
              max={5}
              value={onion.before}
              onChange={(e) => onOnionChange({ ...onion, before: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            后
            <input
              type="number"
              min={0}
              max={5}
              value={onion.after}
              onChange={(e) => onOnionChange({ ...onion, after: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            浓度
            <input
              type="number"
              min={5}
              max={100}
              value={onion.opacity}
              onChange={(e) => onOnionChange({ ...onion, opacity: Number(e.target.value) || 30 })}
            />
          </label>
        </div>
      )}

      {!collapsed && showExport && (
        <div className="anim-export">
          <label>
            倍率
            <select value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={3}>3×</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportBg}
              onChange={(e) => setExportBg(e.target.checked)}
            />
            白底（否则透明）
          </label>
          <button className="anim-btn" disabled={exporting} onClick={() => onExportGif(exportScale, exportBg)}>
            开始导出
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="anim-body">
        <div className="anim-track-list">
          <div className="anim-track-list-head">动画元素</div>
          {project.tracks.length === 0 && (
            <div className="anim-empty">选中画布元素并打关键帧即可开始</div>
          )}
          {animRows.map((row) => {
            if (row.isGroup) {
              const isActive = selectedGroupId === row.key;
              const totalFrames = row.ids.reduce(
                (s, id) => s + (project.tracks.find((t) => t.elementId === id)?.keyframes.length ?? 0),
                0,
              );
              return (
                <div
                  key={`g:${row.key}`}
                  className={"anim-track-row anim-track-group" + (isActive ? " active" : "")}
                  onClick={() => onSelectTrack(row.ids[0])}
                >
                  <span className="anim-track-name">
                    <span className="anim-group-badge">编组</span>
                    {row.ids.length} 个元素
                  </span>
                  <span className="anim-track-count">{totalFrames}帧</span>
                  <button
                    className="anim-track-del"
                    title="删除该编组动画"
                    onClick={(e) => {
                      e.stopPropagation();
                      for (const id of row.ids) onDeleteTrack(id);
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              );
            }
            const tr = project.tracks.find((t) => t.elementId === row.key);
            if (!tr) return null;
            return (
              <div
                key={row.key}
                className={
                  "anim-track-row" + (row.key === selectedElementId ? " active" : "")
                }
                onClick={() => onSelectTrack(row.key)}
              >
                <span className="anim-track-name">{elementName(row.key)}</span>
                <span className="anim-track-count">{tr.keyframes.length}帧</span>
                <button
                  className="anim-track-del"
                  title="删除该元素动画"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTrack(row.key);
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="anim-lane-wrap">
          <div className="anim-ruler">
            {ticks.map((s) => (
              <span key={s} className="anim-tick" style={{ left: pct(s) }}>
                {s % 1 === 0 ? `${s}s` : ""}
              </span>
            ))}
          </div>
          <div
            className="anim-lane"
            ref={laneRef}
            onPointerDown={(e) => {
              // 点空白轨道 = 取消关键帧选中 + 移动播放头
              if (selectedKf) setSelectedKf(null);
              onPlayheadChange(tFromClientX(e.clientX));
            }}
          >
            <div className="anim-playhead" style={{ left: pct(playheadT) }} />
            {animRows.map((row) => (
              <div key={row.isGroup ? `g:${row.key}` : row.key} className="anim-lane-row">
                {row.isGroup
                  ? (() => {
                      // 编组行：把所有成员的关键帧按 t 合并去重，渲染成并集菱形
                      const byT = new Map<
                        number,
                        { t: number; members: { elementId: string; kfId: string }[] }
                      >();
                      for (const id of row.ids) {
                        const tr = project.tracks.find((t) => t.elementId === id);
                        if (!tr) continue;
                        for (const kf of tr.keyframes) {
                          const key = Math.round(kf.t * 1e4);
                          if (!byT.has(key)) byT.set(key, { t: kf.t, members: [] });
                          byT.get(key)!.members.push({ elementId: id, kfId: kf.id });
                        }
                      }
                      const items = [...byT.values()].sort((a, b) => a.t - b.t);
                      return items.map((item) => {
                        const sel =
                          !!selectedKf &&
                          "groupId" in selectedKf &&
                          selectedKf.groupId === row.key &&
                          Math.abs(selectedKf.t - item.t) < 1e-4;
                        return (
                          <div
                            key={`${row.key}:${item.t}`}
                            className={"kf-pos" + (sel ? " sel" : "")}
                            style={{ left: pct(item.t) }}
                            title={`${item.t.toFixed(2)}s · 编组关键帧${sel ? " · 按 Delete 删除" : ""}`}
                          >
                            <div
                              className="kf-diamond"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                pointerDownRef.current = {
                                  groupId: row.key,
                                  t: item.t,
                                  members: item.members,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                };
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                for (const m of item.members) onDeleteKeyframe(m.elementId, m.kfId);
                                setSelectedKf(null);
                              }}
                            />
                            {sel && (
                              <button
                                className="kf-del"
                                title="删除该关键帧（Delete）"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  for (const m of item.members) onDeleteKeyframe(m.elementId, m.kfId);
                                  setSelectedKf(null);
                                }}
                              >
                                <Icon name="close" size={9} />
                              </button>
                            )}
                          </div>
                        );
                      });
                    })()
                  : (() => {
                      const tr = project.tracks.find((t) => t.elementId === row.key);
                      if (!tr) return null;
                      return tr.keyframes.map((kf) => {
                        const sel =
                          !!selectedKf &&
                          !("groupId" in selectedKf) &&
                          selectedKf.elementId === row.key &&
                          selectedKf.kfId === kf.id;
                        return (
                          <div
                            key={kf.id}
                            className={"kf-pos" + (sel ? " sel" : "")}
                            style={{ left: pct(kf.t) }}
                            title={`${kf.t.toFixed(2)}s · ${EASING_LABELS[kf.easing]}${sel ? " · 按 Delete 删除" : ""}`}
                          >
                            <div
                              className="kf-diamond"
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                pointerDownRef.current = {
                                  elementId: row.key,
                                  kfId: kf.id,
                                  startX: e.clientX,
                                  startY: e.clientY,
                                };
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                onDeleteKeyframe(row.key, kf.id);
                                setSelectedKf(null);
                              }}
                            />
                            {sel && (
                              <button
                                className="kf-del"
                                title="删除该关键帧（Delete）"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteKeyframe(row.key, kf.id);
                                  setSelectedKf(null);
                                }}
                              >
                                <Icon name="close" size={9} />
                              </button>
                            )}
                          </div>
                        );
                      });
                    })()}
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {!collapsed && (
        <div className="anim-footer">
        <button
          className="anim-btn primary"
          disabled={!hasSelection}
          onClick={onAddKeyframe}
          title={hasSelection ? "在播放头处为选中元素打/更新关键帧" : "请先在画布选中一个元素"}
        >
          {selectionTracked ? "更新关键帧" : "添加关键帧"}
        </button>
        {selectedKf && (
          <label className="anim-easing">
            缓动
            <select
              value={
                (() => {
                  if ("groupId" in selectedKf) {
                    const f = selectedKf.members[0];
                    if (!f) return "linear";
                    return (
                      project.tracks
                        .find((t) => t.elementId === f.elementId)
                        ?.keyframes.find((k) => k.id === f.kfId)?.easing ?? "linear"
                    );
                  }
                  return (
                    project.tracks
                      .find((t) => t.elementId === selectedKf.elementId)
                      ?.keyframes.find((k) => k.id === selectedKf.kfId)?.easing ?? "linear"
                  );
                })()
              }
              onChange={(e) => {
                const easing = e.target.value as EasingType;
                if ("groupId" in selectedKf) {
                  for (const m of selectedKf.members)
                    onSetEasing(m.elementId, m.kfId, easing);
                } else {
                  onSetEasing(selectedKf.elementId, selectedKf.kfId, easing);
                }
              }}
            >
              {(Object.keys(EASING_LABELS) as EasingType[]).map((k) => (
                <option key={k} value={k}>
                  {EASING_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="anim-hint">
          拖动关键帧改时间 · 选中后按 Delete 或点 × 删除 · 缓动下拉可改曲线
        </span>
      </div>
      )}
    </div>
  );
}
