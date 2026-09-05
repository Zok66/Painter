// 画布录制时间轴（过程回放 · 录屏式）
//
// 与关键帧时间轴的区别：这里没有「关键帧菱形」可拖，时间轴记录的是真实过程。
// - 左侧：参与过录制的元素（出现 → 消失）
// - 右侧：每个元素一条时间条，条上的小竖线是它每次被改动的时刻
// - 顶部：录制 / 停止 / 播放 / 播放头 / 采样帧率 / 倍速 / 导出 GIF
//
// 面板只管 UI 与交互，采样、存盘、播放、导出由 App 通过回调落地。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  recordingRows,
  recordingSummary,
  REC_FPS_OPTIONS,
  type RecProject,
} from "../lib/recording";
import "./RecordingTimeline.css";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 与 CSS .rec-lane-row 的高度保持一致 */
const LANE_ROW_HEIGHT = 26;

type IconName =
  | "play"
  | "pause"
  | "chevron-up"
  | "chevron-down"
  | "close"
  | "stop";

const ICON_PATHS: Record<IconName, ReactNode> = {
  play: <polygon points="6 4 20 12 6 20" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.6" />,
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
  const filled = name === "play" || name === "pause" || name === "stop";
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

/** 元素类型 → 面板展示名 */
const TYPE_LABEL: Record<string, string> = {
  freedraw: "手绘",
  rectangle: "矩形",
  ellipse: "椭圆",
  diamond: "菱形",
  arrow: "箭头",
  line: "直线",
  text: "文字",
  image: "图片",
  frame: "框架",
  embeddable: "嵌入",
  iframe: "嵌入",
  magicframe: "框架",
};

function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

export interface RecordingTimelineProps {
  /** null = 还没录过 */
  project: RecProject | null;
  recording: boolean;
  /** 录制中的实时秒数（project 还没生成时用它显示时长） */
  recSeconds: number;
  playheadT: number;
  playing: boolean;
  /** 采样帧率（录制前的设置项，录制中禁用） */
  fps: number;
  /** 回放倍速 */
  speed: number;
  exporting: boolean;
  exportProgress: { done: number; total: number };
  onStart: () => void;
  onStop: () => void;
  onPlayToggle: () => void;
  onPlayheadChange: (t: number) => void;
  onFpsChange: (fps: number) => void;
  onSpeedChange: (speed: number) => void;
  onExportGif: (scale: number, background: boolean) => void;
  onClear: () => void;
  onClose: () => void;
  /** 删除所选时间区间，之后片段前移拼接 */
  onDeleteRange: (rowId: string | null, t0: number, t1: number) => void;
  /** 仅保留所选时间区间，区间外全丢弃 */
  onKeepRange: (rowId: string | null, t0: number, t1: number) => void;
}

export default function RecordingTimeline(props: RecordingTimelineProps) {
  const {
    project,
    recording,
    recSeconds,
    playheadT,
    playing,
    fps,
    speed,
    exporting,
    exportProgress,
    onStart,
    onStop,
    onPlayToggle,
    onPlayheadChange,
    onFpsChange,
    onSpeedChange,
    onExportGif,
    onClear,
    onClose,
    onDeleteRange,
    onKeepRange,
  } = props;

  const laneWrapRef = useRef<HTMLDivElement | null>(null);
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  /** 剪辑模式：开启后 lane 上的拖拽变成「框选区间」而非移动播放头 */
  const [editing, setEditing] = useState(false);
  /** 选择模式：all=整段时间轴（跨所有层），layer=仅当前元素行 */
  const [selectMode, setSelectMode] = useState<"all" | "layer">("all");
  /** 当前选中的时间区间（秒）+ 关联元素行；null = 未选 */
  const [sel, setSel] = useState<{ t0: number; t1: number; rowId?: string } | null>(null);
  const selRef = useRef<{ t0: number; t1: number; rowId?: string } | null>(null);
  useEffect(() => {
    selRef.current = sel;
  }, [sel]);
  /** 框选起点（秒） */
  const selAnchorRef = useRef(0);
  /** 框选起点所在的元素行 id（分层模式用） */
  const selRowIdRef = useRef<string | undefined>(undefined);
  /** 当前拖拽在干啥：playhead=移动播放头，select=框选，t0/t1=拖选区把手 */
  const dragModeRef = useRef<"playhead" | "select" | "t0" | "t1">("playhead");

  const [showExport, setShowExport] = useState(false);
  const [exportScale, setExportScale] = useState(1);
  const [exportBg, setExportBg] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const durationSec = recording
    ? Math.max(recSeconds, 0.1)
    : Math.max(project?.durationSec ?? 0, 0.1);
  const hasData = !!project && project.events.length > 0;

  const rows = useMemo(
    () => (project ? recordingRows(project) : []),
    [project],
  );
  const summary = useMemo(
    () => (project ? recordingSummary(project) : null),
    [project],
  );

  const pct = (t: number) => `${(t / durationSec) * 100}%`;

  // 时间刻度：按总时长挑一个读得出来的间隔
  const ticks = useMemo(() => {
    const step =
      durationSec <= 10 ? 1 : durationSec <= 30 ? 2 : durationSec <= 120 ? 5 : 15;
    const out: number[] = [];
    for (let s = 0; s <= durationSec + 1e-6; s += step) out.push(Number(s.toFixed(3)));
    return out;
  }, [durationSec]);

  const tFromClientX = useCallback(
    (clientX: number) => {
      const el = laneWrapRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return clamp(
        ((clientX - rect.left) / rect.width) * durationSec,
        0,
        durationSec,
      );
    },
    [durationSec],
  );

  /**
   * 指针落在哪个元素行上（按 .rec-lanes 内容坐标算，含滚动）→ 行 id。
   * 落在最后一行以下的空白处返回 undefined（分层模式下按整段时间轴处理）。
   */
  const rowIdFromClientY = useCallback(
    (clientY: number): string | undefined => {
      const el = lanesRef.current;
      if (!el || !rows.length) return undefined;
      const rect = el.getBoundingClientRect();
      const idx = Math.floor((clientY - rect.top + el.scrollTop) / LANE_ROW_HEIGHT);
      if (idx < 0) return rows[0]?.id;
      if (idx >= rows.length) return undefined; // 空白处
      return rows[idx]?.id;
    },
    [rows],
  );

  // 拖拽：根据 dragMode 决定是移动播放头，还是框选 / 拖选区把手
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const mode = dragModeRef.current;
      const t = tFromClientX(e.clientX);
      if (mode === "playhead") {
        onPlayheadChange(t);
        return;
      }
      if (mode === "select") {
        const a = selAnchorRef.current;
        const rowId = selRowIdRef.current;
        setSel({
          t0: Math.min(a, t),
          t1: Math.max(a, t),
          ...(rowId ? { rowId } : {}),
        });
        return;
      }
      const cur = selRef.current;
      if (!cur) return;
      if (mode === "t0") {
        setSel({ ...cur, t0: clamp(t, 0, cur.t1 - 0.01) });
      } else {
        setSel({ ...cur, t1: clamp(t, cur.t0 + 0.01, durationSec) });
      }
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [onPlayheadChange, tFromClientX, durationSec]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      if (!v) setShowExport(false);
      return !v;
    });
  };

  /** 分层选区落在哪一行（-1 = 全层选区） */
  const selRowIdx = sel?.rowId ? rows.findIndex((r) => r.id === sel.rowId) : -1;

  /** 选区两端的拖拽把手（分层 / 全层共用） */
  const selHandles = (
    <>
      <div
        className="rec-sel-handle"
        data-end="t0"
        onPointerDown={(e) => {
          e.stopPropagation();
          setDragging(true);
          dragModeRef.current = "t0";
        }}
      />
      <div
        className="rec-sel-handle"
        data-end="t1"
        onPointerDown={(e) => {
          e.stopPropagation();
          setDragging(true);
          dragModeRef.current = "t1";
        }}
      />
    </>
  );

  return (
    <div className="rec-timeline">
      <div className="rec-header">
        {recording ? (
          <button className="rec-btn rec-stop" onClick={onStop} title="停止录制">
            <span className="rec-dot" />
            停止
          </button>
        ) : (
          <button
            className="rec-btn rec-start"
            onClick={onStart}
            title={hasData ? "清空旧录制并重新开始" : "开始录制画布上的一切变化"}
          >
            <span className="rec-dot" />
            {hasData ? "重新录制" : "开始录制"}
          </button>
        )}

        <button
          className="rec-play"
          onClick={onPlayToggle}
          disabled={recording || !hasData}
          title={hasData ? "播放 / 暂停回放" : "先录制一段"}
        >
          <Icon name={playing ? "pause" : "play"} />
        </button>

        {recording ? (
          <span className="rec-time rec-time-live">
            <span className="rec-dot live" />
            {recSeconds.toFixed(2)}s 录制中
          </span>
        ) : (
          <span className="rec-time">
            {playheadT.toFixed(2)}s / {durationSec.toFixed(2)}s
          </span>
        )}

        <label className="rec-field">
          FPS
          <select
            value={fps}
            disabled={recording}
            onChange={(e) => onFpsChange(Number(e.target.value))}
          >
            {REC_FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label className="rec-field">
          倍速
          <select
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>

        <button
          className="rec-btn"
          disabled={recording || !hasData}
          onClick={() => setShowExport((v) => !v)}
          title={hasData ? "导出为 GIF" : "先录制一段"}
        >
          {exporting
            ? `导出中 ${exportProgress.done}/${exportProgress.total}`
            : "导出 GIF"}
        </button>
        <button
          className={`rec-btn${editing ? " active" : ""}`}
          disabled={recording || !hasData}
          onClick={() => {
            setEditing((v) => !v);
            setSel(null);
          }}
          title={editing ? "退出剪辑模式" : "剪辑模式：在时间轴上拖选一段进行删除或保留"}
        >
          {editing ? "退出剪辑" : "剪辑"}
        </button>
        <button
          className="rec-collapse"
          onClick={toggleCollapsed}
          title={collapsed ? "展开详情" : "收起详情"}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? "chevron-up" : "chevron-down"} />
        </button>
        <button className="rec-btn ghost" onClick={onClose} title="关闭">
          <Icon name="close" />
        </button>
      </div>

      {!collapsed && showExport && hasData && (
        <div className="rec-export">
          <label>
            倍率
            <select
              value={exportScale}
              onChange={(e) => setExportScale(Number(e.target.value))}
            >
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
          <button
            className="rec-btn"
            disabled={exporting}
            onClick={() => onExportGif(exportScale, exportBg)}
          >
            开始导出
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="rec-body">
          <div className="rec-list">
            <div className="rec-list-head">
              {summary ? `${summary.elements} 个元素` : "录制元素"}
            </div>
            {!hasData && !recording && (
              <div className="rec-empty">
                点「开始录制」后，画布上的每一笔、每一次增删都会被按时间记下来，
                回放时像录屏一样重演。
              </div>
            )}
            {rows.map((row) => (
              <div key={row.id} className="rec-list-row">
                <span className="rec-list-name">{typeLabel(row.type)}</span>
                <span className="rec-list-range">
                  {row.startT.toFixed(1)}s
                  {row.endT !== null ? ` → ${row.endT.toFixed(1)}s` : " →"}
                </span>
              </div>
            ))}
          </div>

          <div
            className={`rec-lane-wrap${editing ? " editing" : ""}`}
            ref={laneWrapRef}
            onPointerDown={(e) => {
              if (recording || !hasData) return;
              if (!editing) {
                setDragging(true);
                dragModeRef.current = "playhead";
                onPlayheadChange(tFromClientX(e.clientX));
                return;
              }
              // 剪辑模式：起手框选区间；分层模式锁定起始所在行
              const t = tFromClientX(e.clientX);
              const rowId =
                selectMode === "layer" ? rowIdFromClientY(e.clientY) : undefined;
              selAnchorRef.current = t;
              selRowIdRef.current = rowId;
              setSel({ t0: t, t1: t, ...(rowId ? { rowId } : {}) });
              setDragging(true);
              dragModeRef.current = "select";
            }}
          >
            <div className="rec-ruler">
              {ticks.map((s) => (
                <span key={s} className="rec-tick" style={{ left: pct(s) }}>
                  {s % 1 === 0 ? `${s}s` : `${s}s`}
                </span>
              ))}
            </div>
            <div className="rec-lanes" ref={lanesRef}>
              {rows.map((row) => {
                const end = row.endT ?? durationSec;
                const w = Math.max(end - row.startT, 0.02);
                return (
                  <div key={row.id} className="rec-lane-row">
                    <div
                      className="rec-bar"
                      style={{ left: pct(row.startT), width: `${(w / durationSec) * 100}%` }}
                      title={`${typeLabel(row.type)} · ${row.startT.toFixed(2)}s → ${
                        row.endT === null ? "结束" : `${row.endT.toFixed(2)}s 被删除`
                      }`}
                    >
                      {row.updates.map((u, i) => (
                        <span
                          key={`${u}-${i}`}
                          className="rec-bar-mark"
                          style={{ left: `${((u - row.startT) / w) * 100}%` }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {!hasData && !recording && (
                <div className="rec-lane-empty">暂无录制</div>
              )}
              {/* 分层选区：只覆盖当前元素行，随行滚动 */}
              {editing && sel && selRowIdx >= 0 && (
                <div
                  className="rec-sel layer"
                  style={{
                    left: pct(sel.t0),
                    width: pct(sel.t1 - sel.t0),
                    top: selRowIdx * LANE_ROW_HEIGHT,
                    height: LANE_ROW_HEIGHT,
                  }}
                >
                  {selHandles}
                </div>
              )}
            </div>
            {/* 全层选区：覆盖整段时间轴 */}
            {editing && sel && selRowIdx < 0 && (
              <div
                className="rec-sel"
                style={{ left: pct(sel.t0), width: pct(sel.t1 - sel.t0) }}
              >
                {selHandles}
              </div>
            )}
            <div
              className="rec-playhead"
              style={{ left: pct(recording ? durationSec : playheadT) }}
            />
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="rec-footer">
          <div className="rec-mode" title="剪辑选区的作用范围">
            <button
              className={`rec-mode-btn${selectMode === "layer" ? " active" : ""}`}
              disabled={recording || !hasData}
              onClick={() => {
                setSelectMode("layer");
                setSel(null);
              }}
            >
              分层
            </button>
            <button
              className={`rec-mode-btn${selectMode === "all" ? " active" : ""}`}
              disabled={recording || !hasData}
              onClick={() => {
                setSelectMode("all");
                setSel(null);
              }}
            >
              全部层
            </button>
          </div>
          <span className="rec-hint">
            {selectMode === "layer"
              ? "分层：行内框选只影响该层；空白处框选=整段时间轴"
              : "全部层：框选整段时间轴，剪辑影响所有元素"}
          </span>
          {summary && (
            <span className="rec-stats">
              {summary.adds} 新增 · {summary.updates} 修改 · {summary.removes} 删除
            </span>
          )}
          {editing && sel && sel.t1 > sel.t0 + 1e-4 && (
            <span className="rec-sel-actions">
              <button
                className="rec-btn"
                disabled={recording}
                onClick={() => {
                  onDeleteRange(sel.rowId ?? null, sel.t0, sel.t1);
                  setSel(null);
                }}
                title={
                  sel.rowId
                    ? "删除该层在所选时间段的内容，其他层不受影响"
                    : "删除所选时间段，之后的内容前移拼接"
                }
              >
                删除所选片段
              </button>
              <button
                className="rec-btn"
                disabled={recording}
                onClick={() => {
                  onKeepRange(sel.rowId ?? null, sel.t0, sel.t1);
                  setSel(null);
                }}
                title={
                  sel.rowId
                    ? "该层只保留所选时间段的内容，其他层不受影响"
                    : "只保留所选时间段，区间外全部丢弃"
                }
              >
                仅保留所选片段
              </button>
              <button
                className="rec-btn ghost"
                onClick={() => setSel(null)}
                title="取消选择"
              >
                取消选择
              </button>
            </span>
          )}
          {hasData && !recording && (
            <button className="rec-btn ghost" onClick={onClear} title="删除这段录制">
              删除录制
            </button>
          )}
        </div>
      )}
    </div>
  );
}
