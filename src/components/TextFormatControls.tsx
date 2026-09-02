import type { ReactNode } from "react";
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

      <fieldset>
        <legend>行距</legend>
        <div className="text-format-range">
          <div className="range-row">
            <input
              type="range"
              min={0.8}
              max={3}
              step={0.05}
              value={value.lineHeight}
              onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
            />
            <span className="range-value">{value.lineHeight.toFixed(2)}</span>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>字体间距</legend>
        <div className="text-format-range">
          <div className="range-row">
            <input
              type="range"
              min={-10}
              max={40}
              step={1}
              value={value.letterSpacing}
              onChange={(e) =>
                onChange({ letterSpacing: Number(e.target.value) })
              }
            />
            <span className="range-value">
              {value.letterSpacing > 0 ? `+${value.letterSpacing}` : value.letterSpacing}
              px
            </span>
          </div>
        </div>
      </fieldset>

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
