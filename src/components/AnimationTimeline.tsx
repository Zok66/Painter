// 动画时间轴（关键帧补间 · 剪映风）
//
// 面板只管 UI 与交互，动画数据的存/取、播放、导出由 App 通过回调落地（和 NotebookPanel 一个路子）。
// - 左侧：动画元素轨道列表（点一下 = 选中画布上那个元素）
// - 右侧：时间标尺 + 可拖动播放头 + 每轨关键帧菱形（拖动改时间、点选改缓动、删除）
// - 选中画布元素后，在播放头处「添加关键帧」即记录该元素当前属性

import { useEffect, useRef, useState } from "react";
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
  const [draggingKf, setDraggingKf] = useState<{ elementId: string; kfId: string } | null>(null);
  const [selectedKf, setSelectedKf] = useState<{ elementId: string; kfId: string } | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exportScale, setExportScale] = useState(1);
  const [exportBg, setExportBg] = useState(false);
  const [showOnion, setShowOnion] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
    if (!draggingKf) return;
    const move = (e: PointerEvent) => {
      const t = tFromClientX(e.clientX);
      onMoveKeyframe(draggingKf.elementId, draggingKf.kfId, t);
      onPlayheadChange(t);
    };
    const up = () => setDraggingKf(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingKf]);

  // 时间标尺刻度（每 0.5s 一条）
  const ticks: number[] = [];
  for (let s = 0; s <= durationSec + 1e-6; s += 0.5) ticks.push(Math.round(s * 100) / 100);

  const hasSelection = !!selectedElementId;
  const selectionTracked = selectedElementId
    ? project.tracks.some((tr) => tr.elementId === selectedElementId)
    : false;

  return (
    <div className="anim-timeline">
      <div className="anim-header">
        <button className="anim-play" onClick={onPlayToggle} title="播放/停止（空格）">
          {playing ? "❚❚" : "▶"}
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
          {collapsed ? "▾" : "▴"}
        </button>
        <button className="anim-btn ghost" onClick={onClose} title="关闭">
          ✕
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
          {project.tracks.map((tr) => (
            <div
              key={tr.elementId}
              className={
                "anim-track-row" + (tr.elementId === selectedElementId ? " active" : "")
              }
              onClick={() => onSelectTrack(tr.elementId)}
            >
              <span className="anim-track-name">{elementName(tr.elementId)}</span>
              <span className="anim-track-count">{tr.keyframes.length}帧</span>
              <button
                className="anim-track-del"
                title="删除该元素动画"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTrack(tr.elementId);
                }}
              >
                ✕
              </button>
            </div>
          ))}
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
              onPlayheadChange(tFromClientX(e.clientX));
            }}
          >
            <div className="anim-playhead" style={{ left: pct(playheadT) }} />
            {project.tracks.map((tr) => (
              <div key={tr.elementId} className="anim-lane-row">
                {tr.keyframes.map((kf) => {
                  const sel =
                    selectedKf?.elementId === tr.elementId && selectedKf?.kfId === kf.id;
                  return (
                    <div
                      key={kf.id}
                      className={"kf-diamond" + (sel ? " sel" : "")}
                      style={{ left: pct(kf.t) }}
                      title={`${kf.t.toFixed(2)}s · ${EASING_LABELS[kf.easing]}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelectedKf({ elementId: tr.elementId, kfId: kf.id });
                        setDraggingKf({ elementId: tr.elementId, kfId: kf.id });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onDeleteKeyframe(tr.elementId, kf.id);
                        setSelectedKf(null);
                      }}
                    />
                  );
                })}
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
                project.tracks
                  .find((t) => t.elementId === selectedKf.elementId)
                  ?.keyframes.find((k) => k.id === selectedKf.kfId)?.easing ?? "linear"
              }
              onChange={(e) =>
                onSetEasing(
                  selectedKf.elementId,
                  selectedKf.kfId,
                  e.target.value as EasingType,
                )
              }
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
          选中画布元素 → 拖到目标位置 → 在播放头处打关键帧，引擎自动补间
        </span>
      </div>
      )}
    </div>
  );
}
