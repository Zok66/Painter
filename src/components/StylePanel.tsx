import { useState, useRef, useEffect, useMemo } from "react";
import "./StylePanel.css";

export type StrokeWidthKey = "thin" | "medium" | "bold";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type Roughness = 0 | 1 | 2;
export type RoundnessMode = "rounded" | "sharp";

export interface DrawStyle {
  strokeColor: string;
  backgroundColor: string;
  strokeWidthKey: StrokeWidthKey;
  strokeStyle: StrokeStyle;
  roughness: Roughness;
  roundness: RoundnessMode;
}

// 调色板行：[透明, 白, 灰, 黑, 棕] + 10 色系 [青, 蓝, 紫, 葡萄紫, 粉, 绿, 青蓝, 黄, 橙, 红]
// 每行 5 档明暗，共 50 色
const COLOR_HUES = [
  { key: "a", name: "青" },
  { key: "b", name: "蓝" },
  { key: "d", name: "紫" },
  { key: "e", name: "葡萄紫" },
  { key: "f", name: "粉" },
  { key: "g", name: "绿" },
  { key: "h", name: "青蓝" },
  { key: "i", name: "黄" },
  { key: "j", name: "橙" },
  { key: "t", name: "红" },
];

const SHADE_LEVELS = [5, 4, 3, 2, 1]; // 从深到浅

// 预设的 14 个常用描边颜色（调色板第一行）
const STROKE_COLORS = [
  { value: "#1e1e1e", label: "黑色" },
  { value: "#ffffff", label: "白色" },
  { value: "#868e96", label: "灰色" },
  { value: "#a18072", label: "棕色" },
  { value: "#e03131", label: "红色" },
  { value: "#f08c00", label: "橙色" },
  { value: "#fab005", label: "黄色" },
  { value: "#2f9e44", label: "绿色" },
  { value: "#099268", label: "青蓝" },
  { value: "#1971c2", label: "蓝色" },
  { value: "#0c8599", label: "青色" },
  { value: "#7950f2", label: "紫色" },
  { value: "#9c36b5", label: "葡萄紫" },
  { value: "#c2255c", label: "粉色" },
];

const BACKGROUND_COLORS = [
  { value: "transparent", label: "透明" },
  { value: "#ffffff", label: "白色" },
  { value: "#f8f9fa", label: "浅灰" },
  { value: "#fff5f5", label: "浅红" },
  { value: "#fff4e6", label: "浅橙" },
  { value: "#fff9db", label: "浅黄" },
  { value: "#ebfbee", label: "浅绿" },
  { value: "#e6fcf5", label: "浅青蓝" },
  { value: "#e7f5ff", label: "浅蓝" },
  { value: "#f3f0ff", label: "浅紫" },
  { value: "#f8f0fc", label: "浅葡萄紫" },
  { value: "#fff0f6", label: "浅粉" },
];

// height 严格等于 Excalidraw STROKE_WIDTH 的真实像素值，
// 保证面板预览线与实际生成图形描边完全一致。
const STROKE_WIDTHS: { key: StrokeWidthKey; label: string; height: number }[] = [
  { key: "thin", label: "细", height: 1 },
  { key: "medium", label: "中", height: 2 },
  { key: "bold", label: "粗", height: 4 },
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

const ROUNDNESS_OPTIONS: { key: RoundnessMode; label: string }[] = [
  { key: "sharp", label: "直角" },
  { key: "rounded", label: "圆角" },
];

interface StylePanelProps {
  style: DrawStyle;
  onChange: (style: Partial<DrawStyle>) => void;
}

// 从 Excalidraw 源码提取的完整颜色映射（key = 色调 + 明暗等级）
const COLOR_MAP: Record<string, string> = {
  // 第一行：灰阶
  q5: "#1e1e1e", q4: "#495057", q3: "#868e96", q2: "#ced4da", q1: "#f1f3f5",
  w5: "#212529", w4: "#495057", w3: "#868e96", w2: "#ced4da", w1: "#f8f9fa",
  // 棕
  r5: "#3b2b20", r4: "#6b5038", r3: "#a18072", r2: "#d7ccc8", r1: "#efebe9",
  // 青
  a5: "#0b7285", a4: "#1098ad", a3: "#15aabf", a2: "#66d9e8", a1: "#c5f6fa",
  // 蓝
  b5: "#1864ab", b4: "#1c7ed6", b3: "#339af0", b2: "#74c0fc", b1: "#d0ebff",
  // 紫
  d5: "#5f3dc4", d4: "#7048e8", d3: "#845ef7", d2: "#b197fc", d1: "#e5dbff",
  // 葡萄紫
  e5: "#862e9c", e4: "#ae3ec9", e3: "#cc5de8", e2: "#e599f7", e1: "#f3d9fa",
  // 粉
  f5: "#a61e4d", f4: "#d6336c", f3: "#e64980", f2: "#f783ac", f1: "#fce4ec",
  // 绿
  g5: "#2f9e44", g4: "#37b24d", g3: "#51cf66", g2: "#8ce99a", g1: "#d3f9d8",
  // 青蓝
  h5: "#087f5b", h4: "#099268", h3: "#12b886", h2: "#63e6be", h1: "#c3fae8",
  // 黄
  i5: "#e67700", i4: "#f59f00", i3: "#fcc419", i2: "#ffd43b", i1: "#fff3bf",
  // 橙
  j5: "#d9480f", j4: "#e8590c", j3: "#f76707", j2: "#ffa94d", j1: "#ffd8a8",
  // 红
  t5: "#c92a2a", t4: "#e03131", t3: "#fa5252", t2: "#ffa8a8", t1: "#ffe3e3",
};

function getColorFromMap(hue: string, shade: number): string {
  return COLOR_MAP[`${hue}${shade}`] || "#000000";
}

export default function StylePanel({ style, onChange }: StylePanelProps) {
  const isTransparent = useMemo(
    () => style.backgroundColor === "transparent",
    [style.backgroundColor],
  );

  return (
    <aside className="style-panel" aria-label="绘图风格">
      <ColorPickerSection
        label="描边"
        presetColors={STROKE_COLORS}
        currentColor={style.strokeColor}
        onChange={(c) => onChange({ strokeColor: c })}
      />

      <ColorPickerSection
        label="背景"
        presetColors={BACKGROUND_COLORS}
        currentColor={style.backgroundColor}
        isTransparent={isTransparent}
        onChange={(c) => onChange({ backgroundColor: c })}
      />

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

      <div className="style-section">
        <span className="style-label">边角</span>
        <div className="style-toggle-row">
          {ROUNDNESS_OPTIONS.map((o) => (
            <button
              key={o.key}
              className={`style-toggle ${style.roundness === o.key ? "active" : ""}`}
              title={o.label}
              aria-label={`边角 ${o.label}`}
              onClick={() => onChange({ roundness: o.key })}
            >
              <RoundnessIcon mode={o.key} />
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ============ 颜色选择器组件 ============

interface ColorPickerSectionProps {
  label: string;
  presetColors: { value: string; label: string }[];
  currentColor: string;
  isTransparent?: boolean;
  onChange: (color: string) => void;
}

function ColorPickerSection({
  label,
  presetColors,
  currentColor,
  isTransparent,
  onChange,
}: ColorPickerSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setExpanded(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [expanded]);

  return (
    <div className="style-section color-picker-section">
      <span className="style-label">{label}</span>
      <div className="color-picker-row">
        <div className="style-swatches">
          {presetColors.map((c) => (
            <button
              key={c.value}
              className={`style-swatch ${currentColor === c.value ? "active" : ""} ${c.value === "transparent" ? "checkerboard" : ""}`}
              style={c.value === "transparent" ? {} : { backgroundColor: c.value }}
              title={c.label}
              aria-label={`${label}颜色 ${c.label}`}
              onClick={() => onChange(c.value)}
            >
              {c.value === "transparent" && isTransparent && (
                <span className="transparent-check" />
              )}
            </button>
          ))}
        </div>
        <button
          ref={buttonRef}
          className={`color-expand-btn ${expanded ? "active" : ""}`}
          title="展开更多颜色"
          aria-label="展开更多颜色"
          onClick={() => setExpanded((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 5 L7 9 L11 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {expanded && (
        <div ref={popupRef} className="color-popup">
          <ColorPickerGrid
            currentColor={currentColor}
            isTransparent={isTransparent}
            onChange={(c) => {
              onChange(c);
              setExpanded(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

interface ColorPickerGridProps {
  currentColor: string;
  isTransparent?: boolean;
  onChange: (color: string) => void;
}

function ColorPickerGrid({ currentColor, isTransparent, onChange }: ColorPickerGridProps) {
  const [hexInput, setHexInput] = useState(currentColor.startsWith("#") ? currentColor.slice(1) : "");

  const handleHex = (value: string) => {
    setHexInput(value);
    const clean = value.replace(/[^0-9a-fA-F]/g, "");
    if (clean.length === 6) {
      onChange(`#${clean.toLowerCase()}`);
    }
  };

  const shadeLabels: Record<number, string> = {
    5: "最深",
    4: "深",
    3: "标准",
    2: "浅",
    1: "最浅",
  };

  // 第一行：灰阶 + 棕
  const topRowKeys = [
    ["q", 5], ["q", 4], ["q", 3], ["q", 2], ["q", 1],
    ["w", 5], ["w", 4], ["w", 3], ["w", 2], ["w", 1],
    ["r", 5], ["r", 4], ["r", 3], ["r", 2], ["r", 1],
  ] as const;

  return (
    <div className="color-picker-grid">
      {/* 标题 */}
      <div className="grid-title">颜色</div>

      {/* 灰阶 + 棕 行 */}
      <div className="grid-row">
        {topRowKeys.map(([hue, shade], i) => {
          const color = getColorFromMap(hue, shade);
          const key = `${hue}${shade}`;
          return (
            <button
              key={`top-${i}`}
              className={`grid-swatch ${currentColor === color ? "active" : ""}`}
              style={{ backgroundColor: color }}
              title={`${color} (${key})`}
              aria-label={`颜色 ${color}`}
              onClick={() => onChange(color)}
            />
          );
        })}
      </div>

      {/* 10 色系 × 5 明暗 共 50 色 */}
      {COLOR_HUES.map((hue) => (
        <div key={hue.key} className="grid-row">
          {SHADE_LEVELS.map((shade) => {
            const color = getColorFromMap(hue.key, shade);
            const key = `${hue.key}${shade}`;
            return (
              <button
                key={key}
                className={`grid-swatch ${currentColor === color ? "active" : ""}`}
                style={{ backgroundColor: color }}
                title={`${hue.name} ${shadeLabels[shade]} ${color}`}
                aria-label={`${hue.name} ${color}`}
                onClick={() => onChange(color)}
              />
            );
          })}
        </div>
      ))}

      {/* 当前选中色预览 */}
      <div className="grid-current">
        <span>当前：</span>
        {currentColor === "transparent" ? (
          <span className="current-swatch checkerboard" />
        ) : (
          <span className="current-swatch" style={{ backgroundColor: currentColor }} />
        )}
        <span className="current-hex">
          {currentColor === "transparent" ? "透明" : currentColor}
        </span>
      </div>

      {/* 明暗提示 */}
      <div className="grid-shade-hint">
        <span>色调明暗：深浅 ←→ 深浅</span>
      </div>

      {/* 十六进制输入 */}
      <div className="grid-hex">
        <span>十六进制值</span>
        <div className="hex-input-wrap">
          <span className="hex-prefix">#</span>
          <input
            className="hex-input"
            type="text"
            maxLength={6}
            placeholder={currentColor === "transparent" ? "------" : currentColor.replace("#", "")}
            value={hexInput}
            onChange={(e) => handleHex(e.target.value)}
            aria-label="十六进制颜色值"
          />
        </div>
      </div>

      <div className="grid-tip">Tip：点击任意颜色快速选择</div>
    </div>
  );
}

// ============ 图标组件 ============

function RoughnessIcon({ level }: { level: Roughness }) {
  const paths = [
    "M4 14 L28 14",
    "M4 14 C10 10, 14 18, 20 14 S26 10, 28 14",
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

function RoundnessIcon({ mode }: { mode: RoundnessMode }) {
  if (mode === "rounded") {
    return (
      <svg width="32" height="28" viewBox="0 0 32 28" className="roundness-icon">
        <path
          d="M6 22 L6 10 Q6 6 10 6 L22 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="32" height="28" viewBox="0 0 32 28" className="roundness-icon">
      <path
        d="M6 22 L6 6 L24 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
