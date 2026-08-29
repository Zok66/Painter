import { useEffect, useRef, useState } from "react";
import { PEN_ORDER, PEN_PRESETS, type PenType } from "../lib/pens";
import "./PenMenu.css";

/** 每支笔在菜单里的笔触示意图（48x18） */
function PenSwatch({ type }: { type: PenType }) {
  switch (type) {
    case "ballpoint":
      return (
        <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden>
          <path
            d="M3 12C10 4 16 15 24 9s15-7 21-1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </svg>
      );
    case "fountain":
      return (
        <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden>
          {/* 柳叶形：起笔重、行笔细，模拟钢笔笔锋 */}
          <path
            d="M3 9C10 3.2 17 14.5 24 8.4 31 2.6 40 5 45 8.6 40 11.6 31 12 24 11.4 17 10.8 10 11.4 3 9Z"
            fill="currentColor"
          />
        </svg>
      );
    case "pencil":
      return (
        <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden>
          <path
            d="M3 12l5-4 4 4 5-5 4 5 5-6 4 6 5-4 4 4 3-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.72"
          />
        </svg>
      );
    case "crayon":
      return (
        <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden>
          {/* 两层错位断续粗线，模拟蜡质覆盖的斑驳留白 */}
          <path
            d="M3 11C10 4.5 16 14 24 8.5 32 3.5 40 10 45 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="5.2"
            strokeLinecap="round"
            strokeDasharray="8 2.4"
            opacity="0.85"
          />
          <path
            d="M3 11C10 4.5 16 14 24 8.5 32 3.5 40 10 45 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="5.2"
            strokeLinecap="round"
            strokeDasharray="2.6 7.8"
            strokeDashoffset="5.4"
            opacity="0.5"
          />
        </svg>
      );
    case "highlighter":
      return (
        <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden>
          <path
            d="M3 11C11 4 17 14 25 8.5 33 3.5 40 10 45 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="butt"
            opacity="0.38"
          />
        </svg>
      );
  }
}

interface PenMenuProps {
  /** 当前启用的笔，null 表示未启用自研笔刷 */
  activePen: PenType | null;
  onSelectPen: (type: PenType) => void;
}

export default function PenMenu({ activePen, onSelectPen }: PenMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 关闭菜单
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activePreset = activePen ? PEN_PRESETS[activePen] : null;

  return (
    <div className="pen-menu" ref={wrapRef}>
      <button
        className={`btn btn-pen${activePen ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={
          activePen
            ? `当前：${activePreset?.name}（点击可切换笔型）`
            : "选择圆珠笔 / 钢笔 / 铅笔 / 蜡笔 / 荧光笔"
        }
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="pen-btn-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" opacity="0.55" />
            <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </span>
        <span className="pen-btn-text">
          {activePen ? activePreset?.name : "更多画笔"}
        </span>
        <span className={`pen-caret${open ? " up" : ""}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="pen-dropdown" role="menu">
          {PEN_ORDER.map((type) => {
            const preset = PEN_PRESETS[type];
            const selected = activePen === type;
            return (
              <button
                key={type}
                role="menuitemradio"
                aria-checked={selected}
                className={`pen-item${selected ? " selected" : ""}`}
                onClick={() => {
                  onSelectPen(type);
                  setOpen(false);
                }}
              >
                <span className="pen-swatch" aria-hidden>
                  <PenSwatch type={type} />
                </span>
                <span className="pen-meta">
                  <span className="pen-name">{preset.name}</span>
                  <span className="pen-desc">{preset.desc}</span>
                </span>
                {selected && <span className="pen-check">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
