// 油漆桶专属填充风格条（独立于笔刷面板）
// 油漆桶工具激活时显示：纯色 │ 圆珠 │ 钢笔 │ 铅笔 │ 蜡笔 │ 荧光

import { PenSwatch } from "./PenMenu";
import type { FillKind } from "../lib/fillStrokes";
import "./FillStyleBar.css";

/** 纯色选项的实心色块示意 */
function SolidSwatch() {
  return (
    <svg width="48" height="18" viewBox="0 0 48 18" aria-hidden>
      <rect x="2" y="2" width="44" height="14" fill="currentColor" />
    </svg>
  );
}

const FILL_OPTIONS: Array<{ kind: FillKind; label: string }> = [
  { kind: "solid", label: "纯色" },
  { kind: "ballpoint", label: "圆珠" },
  { kind: "fountain", label: "钢笔" },
  { kind: "pencil", label: "铅笔" },
  { kind: "crayon", label: "蜡笔" },
  { kind: "highlighter", label: "荧光" },
];

interface FillStyleBarProps {
  kind: FillKind;
  onChange: (kind: FillKind) => void;
}

export default function FillStyleBar({ kind, onChange }: FillStyleBarProps) {
  return (
    <aside className="fill-style-bar">
      <div className="fill-style-bar-title">填充风格</div>
      <div className="fill-style-bar-options">
        {FILL_OPTIONS.map((opt) => {
          const selected = kind === opt.kind;
          return (
            <button
              key={opt.kind}
              className={`fill-option${selected ? " selected" : ""}`}
              onClick={() => onChange(opt.kind)}
              aria-pressed={selected}
              title={`用${opt.label}风格填充`}
            >
              <span className="fill-option-swatch" aria-hidden>
                {opt.kind === "solid" ? <SolidSwatch /> : <PenSwatch type={opt.kind} />}
              </span>
              <span className="fill-option-label">{opt.label}</span>
              {selected && <span className="fill-option-check">✓</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
