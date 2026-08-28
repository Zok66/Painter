import { useMemo } from "react";
import "./StylePanel.css";

export type StrokeWidthKey = "thin" | "regular" | "bold";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Roughness = 0 | 1 | 2;

export interface DrawStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidthKey: StrokeWidthKey;
  strokeStyle: StrokeStyle;
  roughness: Roughness;
}

const STROKE_COLORS = [
  { value: "#1e1e1e", label: "黑色" },
  { value: "#ef4444", label: "红色" },
  { value: "#22c55e", label: "绿色" },
  { value: "#3b82f6", label: "蓝色" },
  { value: "#f97316", label: "橙色" },
  { value: "#a855f7", label: "紫色" },
];

const BACKGROUND_COLORS = [
  { value: "transparent", label: "透明" },
  { value: "#fee2e2", label: "浅红" },
  { value: "#dcfce7", label: "浅绿" },
  { value: "#dbeafe", label: "浅蓝" },
  { value: "#fef9c3", label: "浅黄" },
  { value: "#ffffff", label: "白色" },
];

const STROKE_WIDTHS: { key: StrokeWidthKey; label: string; height: number }[] = [
  { key: "thin", label: "细", height: 2 },
  { key: "regular", label: "中", height: 4 },
  { key: "bold", label: "粗", height: 6 },
];

const STROKE_STYLES: { key: StrokeStyle; label: string }[] = [
  { key: "solid", label: "实线" },
  { key: "dashed", label: "虚线" },
  { key: "dotted", label: "点线" },
];

const ROUGHNESS_LEVELS: { key: Roughness; label: string }[] = [
  { key: 0, label: "规整" },
  { key: 1, label: "手绘" },
  { key: 2, label: "潦草" },
];

interface StylePanelProps {
  style: DrawStyle;
  onChange: (style: Partial<DrawStyle>) => void;
}

export default function StylePanel({ style, onChange }: StylePanelProps) {
  const isTransparent = useMemo(
    () => style.backgroundColor === "transparent",
    [style.backgroundColor],
  );

  return (
    <aside className="style-panel" aria-label="绘图风格">
      <div className="style-section">
        <span className="style-label">描边</span>
        <div className="style-swatches">
          {STROKE_COLORS.map((c) => (
            <button
              key={c.value}
              className={`style-swatch ${style.strokeColor === c.value ? "active" : ""}`}
              style={{ backgroundColor: c.value }}
              title={c.label}
              aria-label={`描边颜色 ${c.label}`}
              onClick={() => onChange({ strokeColor: c.value })}
            />
          ))}
        </div>
      </div>

      <div className="style-section">
        <span className="style-label">背景</span>
        <div className="style-swatches">
          {BACKGROUND_COLORS.map((c) => (
            <button
              key={c.value}
              className={`style-swatch ${style.backgroundColor === c.value ? "active" : ""} ${c.value === "transparent" ? "checkerboard" : ""}`}
              style={c.value === "transparent" ? {} : { backgroundColor: c.value }}
              title={c.label}
              aria-label={`背景颜色 ${c.label}`}
              onClick={() => onChange({ backgroundColor: c.value })}
            >
              {c.value === "transparent" && isTransparent && (
                <span className="transparent-check" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="style-section">
        <span className="style-label">描边宽度</span>
        <div className="style-toggle-row">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w.key}
              className={`style-toggle ${style.strokeWidthKey === w.key ? "active" : ""}`}
              title={w.label}
              aria-label={`描边宽度 ${w.label}`}
              onClick={() => onChange({ strokeWidthKey: w.key })}
            >
              <span
                className="stroke-width-line"
                style={{ height: w.height }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="style-section">
        <span className="style-label">边框样式</span>
        <div className="style-toggle-row">
          {STROKE_STYLES.map((s) => (
            <button
              key={s.key}
              className={`style-toggle ${style.strokeStyle === s.key ? "active" : ""}`}
              title={s.label}
              aria-label={`边框样式 ${s.label}`}
              onClick={() => onChange({ strokeStyle: s.key })}
            >
              <span className={`stroke-style-line stroke-style-${s.key}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="style-section">
        <span className="style-label">线条风格</span>
        <div className="style-toggle-row">
          {ROUGHNESS_LEVELS.map((r) => (
            <button
              key={r.key}
              className={`style-toggle ${style.roughness === r.key ? "active" : ""}`}
              title={r.label}
              aria-label={`线条风格 ${r.label}`}
              onClick={() => onChange({ roughness: r.key })}
            >
              <RoughnessIcon level={r.key} />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function RoughnessIcon({ level }: { level: Roughness }) {
  // 用 SVG 路径模拟三种 roughness 的线形
  const paths = [
    // 规整：直线
    "M4 14 L28 14",
    // 手绘：轻微起伏
    "M4 14 C10 10, 14 18, 20 14 S26 10, 28 14",
    // 潦草：明显抖动
    "M4 14 C8 8, 12 20, 16 12 S24 22, 28 10",
  ];
  return (
    <svg width="32" height="28" viewBox="0 0 32 28" className="roughness-icon">
      <path
        d={paths[level]}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
