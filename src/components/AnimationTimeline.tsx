// 动画时间轴：当前页的帧序列编辑面板
//
// 面板只管 UI 与交互，帧内容的存/取、切帧、播放、导出全部由 App 通过回调落地。
// 跟 NotebookPanel 一个路子：这里不碰 Excalidraw 状态。
//
// 缩略图走 exportToCanvas —— 和正式导出同一条渲染路径，
// 颗粒笔迹、竖排文字在缩略图里跟画布上长得一样。

import { useEffect, useRef, useState } from "react";
import { exportToCanvas } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import {
  MAX_FPS,
  MAX_ONION,
  MIN_FPS,
  type AnimTrack,
  type OnionConfig,
} from "../lib/animation";
import { getPaperTemplate, setPaperTemplate } from "../lib/paperTexture";
import { stripOnionElements } from "../lib/onionSkin";
import "./AnimationTimeline.css";

const THUMB_W = 76;
const THUMB_H = 56;

export interface AnimationTimelineProps {
  track: AnimTrack;
  currentFrameId: string;
  /** 画布内容每次落盘就递增，用来触发缩略图刷新 */
  sceneVersion: number;
  playing: boolean;
  files: BinaryFiles;
  /** 读取某帧的元素（当前帧取实时内容，其余取快照） */
  loadFrameElements: (frameId: string) => readonly ExcalidrawElement[];
  onSelectFrame: (frameId: string) => void;
  onAddFrame: () => void;
  onDuplicateFrame: (frameId: string) => void;
  onDeleteFrame: (frameId: string) => void;
  onMoveFrame: (frameId: string, toIndex: number) => void;
  onHoldChange: (frameId: string, hold: number) => void;
  onFpsChange: (fps: number) => void;
  onOnionChange: (onion: OnionConfig) => void;
  onPlayToggle: () => void;
  onPrevFrame: () => void;
  onNextFrame: () => void;
  onExportGif: (scale: number, background: boolean) => void;
  exporting: boolean;
  exportProgress: { done: number; total: number };
  onClose: () => void;
}

async function renderThumb(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): Promise<string | null> {
  const els = stripOnionElements(elements);
  if (!els.length) return null;
  const paperBefore = getPaperTemplate();
  setPaperTemplate("blank");
  try {
    const canvas = await exportToCanvas({
      elements: els as unknown as ExcalidrawElement[],
      appState: {
        exportBackground: false,
        viewBackgroundColor: "#ffffff",
        exportWithDarkMode: false,
        exportEmbedScene: false,
        exportScale: 1,
      } as never,
      files,
      exportPadding: 0,
      getDimensions: (w: number, h: number) => ({
        width: w,
        height: h,
        scale: Math.min(THUMB_W / Math.max(1, w), THUMB_H / Math.max(1, h)),
      }),
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    setPaperTemplate(paperBefore);
  }
}

export default function AnimationTimeline(props: AnimationTimelineProps) {
  const {
    track,
    currentFrameId,
    sceneVersion,
    playing,
    files,
    loadFrameElements,
    onSelectFrame,
    onAddFrame,
    onDuplicateFrame,
    onDeleteFrame,
    onMoveFrame,
    onHoldChange,
    onFpsChange,
    onOnionChange,
    onPlayToggle,
    onPrevFrame,
    onNextFrame,
    onExportGif,
    exporting,
    exportProgress,
    onClose,
  } = props;

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  /** 每帧最后一次生成缩略图时的 sceneVersion，用于判断要不要重算 */
  const thumbStampRef = useRef<Record<string, number>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [exportScale, setExportScale] = useState(1);
  const [exportBg, setExportBg] = useState(false);
  const [showOnionSettings, setShowOnionSettings] = useState(false);

  // 缩略图：当前帧随画布落盘持续刷新；其他帧内容不变，只在首次出现时算一次，
  // 避免每次落盘都把所有帧的 exportToCanvas 重跑一遍
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const frame of track.frames) {
        if (cancelled) return;
        const isCurrent = frame.id === currentFrameId;
        const stamp = thumbStampRef.current[frame.id];
        if (!isCurrent && stamp !== undefined) continue;
        if (isCurrent && stamp === sceneVersion) continue;
        const els = loadFrameElements(frame.id);
        const url = await renderThumb(els, files);
        if (cancelled) return;
        thumbStampRef.current[frame.id] = sceneVersion;
        setThumbs((prev) => {
          const next = url ?? "";
          if (prev[frame.id] === next) return prev;
          return { ...prev, [frame.id]: next };
        });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [track.frames, sceneVersion, currentFrameId, loadFrameElements, files]);

  const currentIndex = track.frames.findIndex((f) => f.id === currentFrameId);
  const total = track.frames.length;

  const handleDrop = (index: number) => {
    if (dragIndex !== null && dragIndex !== index) onMoveFrame(track.frames[dragIndex].id, index);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <section className="anim-timeline" role="region" aria-label="动画时间轴">
      <div className="anim-timeline-bar">
        <div className="anim-group">
          <span className="anim-title">动画</span>
          <span className="anim-subtitle">
            {total} 帧 · 当前第 {(currentIndex < 0 ? 0 : currentIndex) + 1} 帧
          </span>
        </div>

        <div className="anim-divider" />

        <div className="anim-group">
          <button
            className="anim-icon-btn"
            onClick={onPrevFrame}
            title="上一帧（,）"
            aria-label="上一帧"
            disabled={playing}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 5h2.5v14H7zM19 5l-9 7 9 7z" />
            </svg>
          </button>
          <button
            className={"anim-icon-btn anim-play" + (playing ? " is-playing" : "")}
            onClick={onPlayToggle}
            title={playing ? "停止播放（空格）" : "播放（空格）"}
            aria-label={playing ? "停止播放" : "播放"}
          >
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5l11 7-11 7z" />
              </svg>
            )}
          </button>
          <button
            className="anim-icon-btn"
            onClick={onNextFrame}
            title="下一帧（.）"
            aria-label="下一帧"
            disabled={playing}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.5 5H17v14h-2.5zM5 5l9 7-9 7z" />
            </svg>
          </button>
        </div>

        <div className="anim-divider" />

        <label className="anim-field">
          <span className="anim-field-label">帧率</span>
          <input
            className="anim-number"
            type="number"
            min={MIN_FPS}
            max={MAX_FPS}
            value={track.fps}
            onChange={(e) => onFpsChange(Number(e.target.value))}
            aria-label="每秒帧数"
          />
          <span className="anim-field-unit">fps</span>
        </label>

        <div className="anim-group">
          <button
            className={"anim-toggle" + (track.onion.enabled ? " is-on" : "")}
            onClick={() =>
              onOnionChange({ ...track.onion, enabled: !track.onion.enabled })
            }
            aria-pressed={track.onion.enabled}
            title="洋葱皮：把相邻帧淡淡地显示在画布上作参考"
          >
            洋葱皮
          </button>
          <button
            className="anim-icon-btn anim-settings"
            onClick={() => setShowOnionSettings((v) => !v)}
            aria-expanded={showOnionSettings}
            title="洋葱皮设置"
            aria-label="洋葱皮设置"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
              <path d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1l-.4-2.5h-3.9l-.4 2.5a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.7 7.7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.4 2.5h3.9l.4-2.5a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4z" />
            </svg>
          </button>
          {showOnionSettings && (
            <div className="anim-popover">
              <label className="anim-field">
                <span className="anim-field-label">前</span>
                <input
                  className="anim-number"
                  type="number"
                  min={0}
                  max={MAX_ONION}
                  value={track.onion.before}
                  onChange={(e) =>
                    onOnionChange({ ...track.onion, before: Number(e.target.value) })
                  }
                />
                <span className="anim-field-unit">帧</span>
              </label>
              <label className="anim-field">
                <span className="anim-field-label">后</span>
                <input
                  className="anim-number"
                  type="number"
                  min={0}
                  max={MAX_ONION}
                  value={track.onion.after}
                  onChange={(e) =>
                    onOnionChange({ ...track.onion, after: Number(e.target.value) })
                  }
                />
                <span className="anim-field-unit">帧</span>
              </label>
              <label className="anim-field">
                <span className="anim-field-label">浓度</span>
                <input
                  className="anim-range"
                  type="range"
                  min={5}
                  max={80}
                  value={track.onion.opacity}
                  onChange={(e) =>
                    onOnionChange({ ...track.onion, opacity: Number(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
        </div>

        <div className="anim-spacer" />

        <div className="anim-group">
          <select
            className="anim-select"
            value={exportScale}
            onChange={(e) => setExportScale(Number(e.target.value))}
            aria-label="导出倍率"
            title="导出倍率"
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={3}>3×</option>
          </select>
          <select
            className="anim-select"
            value={exportBg ? "bg" : "transparent"}
            onChange={(e) => setExportBg(e.target.value === "bg")}
            aria-label="导出背景"
            title="导出背景"
          >
            <option value="transparent">透明底</option>
            <option value="bg">白底</option>
          </select>
          <button
            className="anim-btn anim-btn-primary"
            onClick={() => onExportGif(exportScale, exportBg)}
            disabled={exporting}
          >
            {exporting
              ? `导出中 ${exportProgress.done}/${exportProgress.total}`
              : "导出 GIF"}
          </button>
        </div>

        <button
          className="anim-icon-btn"
          onClick={onClose}
          title="关闭动画面板"
          aria-label="关闭动画面板"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="anim-frames">
        <div className="anim-frames-scroll">
          {track.frames.map((frame, index) => {
            const isCurrent = frame.id === currentFrameId;
            const thumb = thumbs[frame.id];
            return (
              <div
                key={frame.id}
                className={
                  "anim-frame" +
                  (isCurrent ? " is-current" : "") +
                  (overIndex === index ? " is-over" : "")
                }
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIndex(index);
                }}
                onDragLeave={() => setOverIndex(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(index);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onClick={() => onSelectFrame(frame.id)}
                role="button"
                tabIndex={0}
                aria-current={isCurrent}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectFrame(frame.id);
                  }
                }}
              >
                <div className="anim-thumb">
                  {thumb ? (
                    <img src={thumb} alt="" draggable={false} />
                  ) : (
                    <span className="anim-thumb-empty">空白</span>
                  )}
                  <span className="anim-frame-index">{index + 1}</span>
                  {frame.hold > 1 && (
                    <span className="anim-frame-hold" title={`停留 ${frame.hold} 帧`}>
                      ×{frame.hold}
                    </span>
                  )}
                </div>

                <div className="anim-frame-foot">
                  <button
                    className="anim-mini"
                    onClick={(e) => {
                      e.stopPropagation();
                      onHoldChange(frame.id, frame.hold - 1);
                    }}
                    disabled={frame.hold <= 1}
                    title="减少停留帧数"
                    aria-label="减少停留帧数"
                  >
                    −
                  </button>
                  <span className="anim-hold-value">{frame.hold}</span>
                  <button
                    className="anim-mini"
                    onClick={(e) => {
                      e.stopPropagation();
                      onHoldChange(frame.id, frame.hold + 1);
                    }}
                    title="增加停留帧数"
                    aria-label="增加停留帧数"
                  >
                    +
                  </button>
                  <button
                    className="anim-mini anim-mini-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteFrame(frame.id);
                    }}
                    disabled={total <= 1}
                    title="删除这一帧"
                    aria-label="删除这一帧"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}

          <button className="anim-frame anim-frame-add" onClick={onAddFrame} title="在当前帧之后插入空白帧">
            <span className="anim-add-mark">+</span>
            <span className="anim-add-text">新建帧</span>
          </button>
        </div>

        <div className="anim-frames-actions">
          <button
            className="anim-btn"
            onClick={() => onDuplicateFrame(currentFrameId)}
            title="复制当前帧到后面（沿用当前画面继续改，最常用的逐帧画法）"
          >
            复制当前帧
          </button>
        </div>
      </div>
    </section>
  );
}
