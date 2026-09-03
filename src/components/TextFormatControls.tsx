import { useState, type ReactNode } from "react";
import type { TextDirection, TextVerticalAlign } from "../lib/textFormat";

export interface TextFormatValue {
  textDirection: TextDirection;
  lineHeight: number;
  letterSpacing: number;
  verticalAlign: TextVerticalAlign;
}

interface TextFormatControlsProps {
  value: TextFormatValue;
  onChange: (patch: {
    textDirection?: TextDirection;
    lineHeight?: number;
    letterSpacing?: number;
    verticalAlign?: TextVerticalAlign;
  }) => void;
}

function IconSvg({
  width = 20,
  height = 20,
  children,
}: {
  width?: number;
  height?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const HorizontalIcon = () => (
  <IconSvg width={20} height={20}>
    <path d="M4 7h12" />
    <path d="M4 13h12" />
  </IconSvg>
);

const VerticalIcon = () => (
  <IconSvg width={20} height={20}>
    <path d="M7 4v12" />
    <path d="M13 4v12" />
  </IconSvg>
);

/** 垂直对齐：框内三行短横线分别贴顶/居中/贴底 */
const AlignTopIcon = () => (
  <IconSvg width={20} height={20}>
    <path d="M4 6h12" />
    <path d="M4 9h12" />
    <path d="M4 12h8" />
  </IconSvg>
);

const AlignMiddleIcon = () => (
  <IconSvg width={20} height={20}>
    <path d="M4 9h12" />
    <path d="M4 12h8" />
    <path d="M4 6h8" />
  </IconSvg>
);

const AlignBottomIcon = () => (
  <IconSvg width={20} height={20}>
    <path d="M4 14h12" />
    <path d="M4 11h12" />
    <path d="M4 8h8" />
  </IconSvg>
);

const ChevronUpIcon = () => (
  <IconSvg width={12} height={12}>
    <path d="M2 8l4-4 4 4" />
  </IconSvg>
);

const ChevronDownIcon = () => (
  <IconSvg width={12} height={12}>
    <path d="M2 4l4 4 4-4" />
  </IconSvg>
);

interface NumericFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  unit?: string;
  onChange: (value: number) => void;
}

function NumericField({
  label,
  value,
  min,
  max,
  step,
  decimals = 0,
  unit,
  onChange,
}: NumericFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) {
      const clamped = Math.max(min, Math.min(max, n));
      const stepped = Math.round(clamped / step) * step;
      onChange(Number(stepped.toFixed(decimals)));
    }
    setDraft(null);
  };

  const displayValue = draft !== null ? draft : value.toFixed(decimals);

  const bump = (delta: number) => {
    const next = Math.max(min, Math.min(max, value + delta));
    onChange(Number(next.toFixed(decimals)));
  };

  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="text-format-number">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={displayValue}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit((e.target as HTMLInputElement).value);
            }
          }}
        />
        {unit && <span className="text-format-unit">{unit}</span>}
        <div className="text-format-spinners">
          <button
            type="button"
            tabIndex={-1}
            aria-label="增加"
            onClick={() => bump(step)}
          >
            <ChevronUpIcon />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="减少"
            onClick={() => bump(-step)}
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>
    </fieldset>
  );
}

/**
 * 文字格式化控件：文字方向（横排/竖排）、行距、字体间距。
 * 作为 React 门户挂载进原生 .selected-shape-actions-container，
 * 与原生文字面板（字体/字号/对齐）共处同一面板，不再另开独立面板。
 */
export default function TextFormatControls({
  value,
  onChange,
}: TextFormatControlsProps) {
  return (
    <div className="text-format-controls">
      <fieldset>
        <legend>文字方向</legend>
        <div className="buttonList">
          <label
            className={value.textDirection === "horizontal" ? "active" : ""}
            title="横排"
          >
            <input
              type="radio"
              name="text-direction"
              checked={value.textDirection === "horizontal"}
              onChange={() => onChange({ textDirection: "horizontal" })}
            />
            <HorizontalIcon />
          </label>
          <label
            className={value.textDirection === "vertical" ? "active" : ""}
            title="竖排"
          >
            <input
              type="radio"
              name="text-direction"
              checked={value.textDirection === "vertical"}
              onChange={() => onChange({ textDirection: "vertical" })}
            />
            <VerticalIcon />
          </label>
        </div>
      </fieldset>

      <NumericField
        label="行距"
        value={value.lineHeight}
        min={0.8}
        max={3}
        step={0.05}
        decimals={2}
        onChange={(lineHeight) => onChange({ lineHeight })}
      />

      <NumericField
        label="字体间距"
        value={value.letterSpacing}
        min={-10}
        max={40}
        step={1}
        decimals={0}
        unit="px"
        onChange={(letterSpacing) => onChange({ letterSpacing })}
      />

      <fieldset>
        <legend>垂直对齐</legend>
        <div className="buttonList">
          {(
            [
              { v: "top", icon: <AlignTopIcon />, title: "顶部对齐" },
              { v: "middle", icon: <AlignMiddleIcon />, title: "垂直居中" },
              { v: "bottom", icon: <AlignBottomIcon />, title: "底部对齐" },
            ] as const
          ).map(({ v, icon, title }) => (
            <label
              key={v}
              className={value.verticalAlign === v ? "active" : ""}
              title={title}
            >
              <input
                type="radio"
                name="text-vertical-align"
                checked={value.verticalAlign === v}
                onChange={() => onChange({ verticalAlign: v })}
              />
              {icon}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
