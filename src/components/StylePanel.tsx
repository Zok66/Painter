import { useId } from "react";
import type { ReactNode } from "react";
import { PEN_ORDER, PEN_PRESETS } from "../lib/pens";
import type { PenType } from "../lib/pens";
import { PenSwatch } from "./PenMenu";
import { NativeColorPicker } from "../excalidraw-color-picker/NativeColorPicker";
import "./StylePanel.css";

export type StrokeWidthKey = "thin" | "medium" | "bold";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type FillStyle = "hachure" | "cross-hatch" | "solid";
export type Roughness = 0 | 1 | 2;
export type RoundnessMode = "rounded" | "sharp";

export interface DrawStyle {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidthKey: StrokeWidthKey;
  strokeStyle: StrokeStyle;
  roughness: Roughness;
  roundness: RoundnessMode;
}

/** 翻转方向 */
export type FlipDirection = "horizontal" | "vertical";

interface StylePanelProps {
  style: DrawStyle;
  onChange: (style: Partial<DrawStyle>) => void;
  isDark: boolean;
  /**
   * shape = 智能画笔面板（描边 / 背景 / 填充 / 描边宽度 / 边框样式 / 线条风格 / 边角）
   * pen   = 更多画笔面板，与原生 Excalidraw 的 freedraw 面板保持一致，
   *         只保留对笔画真正生效的两项：描边 + 描边宽度
   */
  mode?: "shape" | "pen";
  /** 当前选中的笔型；pen 模式下用于顶部「画笔」栏高亮 */
  penType?: PenType | null;
  /** 切换笔型回调 */
  onPenTypeChange?: (type: PenType) => void;
  /** 是否挂载到原生面板容器（.App-menu__left），用 static 定位融入原生布局 */
  nativeHost?: boolean;
  /** 水平翻转回调 */
  onFlipHorizontal?: () => void;
  /** 垂直翻转回调 */
  onFlipVertical?: () => void;
}

// 原生 Draw to shape 面板的图标，SVG 结构直接取自 Excalidraw。
function IconSvg({
  width = 20,
  height = 20,
  children,
  strokeWidth = 2,
}: {
  width?: number;
  height?: number;
  children: ReactNode;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const StrokeWidthBaseIcon = () => (
  <IconSvg width={20} height={20}>
    <path
      d="M4.167 10h11.666"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </IconSvg>
);

const StrokeWidthBoldIcon = () => (
  <IconSvg width={20} height={20}>
    <path
      d="M5 10h10"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </IconSvg>
);

const StrokeWidthExtraBoldIcon = () => (
  <IconSvg width={20} height={20}>
    <path
      d="M5 10h10"
      stroke="currentColor"
      strokeWidth="3.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </IconSvg>
);

const StrokeStyleDashedIcon = () => (
  <IconSvg width={24} height={24}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M5 12h2" />
    <path d="M17 12h2" />
    <path d="M11 12h2" />
  </IconSvg>
);

const StrokeStyleDottedIcon = () => (
  <IconSvg width={24} height={24}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 12v.01" />
    <path d="M8 12v.01" />
    <path d="M12 12v.01" />
    <path d="M16 12v.01" />
    <path d="M20 12v.01" />
  </IconSvg>
);

const SloppinessArchitectIcon = () => (
  <IconSvg width={20} height={20}>
    <path
      d="M2.5 12.038c1.655-.885 5.9-3.292 8.568-4.354 2.668-1.063.101 2.821 1.332 3.104 1.218.283 5.112-1.814 5.112-1.814"
      strokeWidth="1.25"
    />
  </IconSvg>
);

const SloppinessArtistIcon = () => (
  <IconSvg width={20} height={20}>
    <path
      d="M2.5 12.563c1.655-.886 5.9-3.293 8.568-4.355 2.668-1.062.101 2.822 1.332 3.105 1.218.283 5.112-1.814 5.112-1.814m-13.469 2.23c2.963-1.586 6.13-5.62 7.468-4.998 1.338.623-1.153 4.11-.132 5.595 1.02 1.487 6.133-1.43 6.133-1.43"
      strokeWidth="1.25"
    />
  </IconSvg>
);

const SloppinessCartoonistIcon = () => (
  <IconSvg width={20} height={20}>
    <path
      d="M2.5 11.936c1.737-.879 8.627-5.346 10.42-5.268 1.795.078-.418 5.138.345 5.736.763.598 3.53-1.789 4.235-2.147M2.929 9.788c1.164-.519 5.47-3.28 6.987-3.114 1.519.165 1 3.827 2.121 4.109 1.122.281 3.839-2.016 4.606-2.42"
      strokeWidth="1.25"
    />
  </IconSvg>
);

const EdgeSharpIcon = () => (
  <IconSvg width={20} height={20}>
    <path d="M3.33334 9.99998V6.66665C3.33334 6.04326 3.33403 4.9332 3.33539 3.33646C4.95233 3.33436 6.06276 3.33331 6.66668 3.33331H10" />
    <path d="M13.3333 3.33331V3.34331" />
    <path d="M16.6667 3.33331V3.34331" />
    <path d="M16.6667 6.66669V6.67669" />
    <path d="M16.6667 10V10.01" />
    <path d="M3.33334 13.3333V13.3433" />
    <path d="M16.6667 13.3333V13.3433" />
    <path d="M3.33334 16.6667V16.6767" />
    <path d="M6.66666 16.6667V16.6767" />
    <path d="M10 16.6667V16.6767" />
    <path d="M13.3333 16.6667V16.6767" />
    <path d="M16.6667 16.6667V16.6767" />
  </IconSvg>
);

const EdgeRoundIcon = () => (
  <IconSvg width={24} height={24}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 12v-4a4 4 0 0 1 4 -4h4" />
    <line x1="16" y1="4" x2="16" y2="4.01" />
    <line x1="20" y1="4" x2="20" y2="4.01" />
    <line x1="20" y1="8" x2="20" y2="8.01" />
    <line x1="20" y1="12" x2="20" y2="12.01" />
    <line x1="4" y1="16" x2="4" y2="16.01" />
    <line x1="20" y1="16" x2="20" y2="16.01" />
    <line x1="8" y1="20" x2="8" y2="20.01" />
    <line x1="12" y1="20" x2="12" y2="20.01" />
    <line x1="16" y1="20" x2="16" y2="20.01" />
    <line x1="20" y1="20" x2="20" y2="20.01" />
  </IconSvg>
);

/** 水平翻转图标（左右镜像） */
const FlipHorizontalIcon = () => (
  <IconSvg width={20} height={20}>
    <path stroke="none" d="M0 0h20v20H0z" fill="none" />
    <path d="M3 4h3v12H3z" strokeWidth="1.5" />
    <path d="M14 4h3v12h-3z" strokeWidth="1.5" />
    <path d="M9 3v14" strokeWidth="1.25" />
    <path d="M6 7l3-3 3 3" strokeWidth="1.25" />
    <path d="M6 13l3 3 3-3" strokeWidth="1.25" />
  </IconSvg>
);

/** 垂直翻转图标（上下镜像） */
const FlipVerticalIcon = () => (
  <IconSvg width={20} height={20}>
    <path stroke="none" d="M0 0h20v20H0z" fill="none" />
    <path d="M4 3v3h12V3z" strokeWidth="1.5" />
    <path d="M4 14v3h12v-3z" strokeWidth="1.5" />
    <path d="M3 9h14" strokeWidth="1.25" />
    <path d="M7 6l-3 3 3 3" strokeWidth="1.25" />
    <path d="M13 6l3 3-3 3" strokeWidth="1.25" />
  </IconSvg>
);

const FillHachureIcon = () => {
  const id = useId();
  const maskId = `hachure-${id}`;
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.879 2.625h8.242a3.254 3.254 0 0 1 3.254 3.254v8.242a3.254 3.254 0 0 1-3.254 3.254H5.88a3.254 3.254 0 0 1-3.254-3.254V5.88a3.254 3.254 0 0 1 3.254-3.254Z" />
      <mask
        id={maskId}
        style={{ maskType: "alpha" }}
        maskUnits="userSpaceOnUse"
        x={2}
        y={2}
        width={16}
        height={16}
      >
        <path
          d="M5.879 2.625h8.242a3.254 3.254 0 0 1 3.254 3.254v8.242a3.254 3.254 0 0 1-3.254 3.254H5.88a3.254 3.254 0 0 1-3.254-3.254V5.88a3.254 3.254 0 0 1 3.254-3.254Z"
          fill="currentColor"
          stroke="currentColor"
        />
      </mask>
      <g mask={`url(#${maskId})`}>
        <path d="M2.258 15.156 15.156 2.258M7.324 20.222 20.222 7.325m-20.444 5.35L12.675-.222m-8.157 18.34L17.416 5.22" />
      </g>
    </svg>
  );
};

const FillCrossHatchIcon = () => {
  const id = useId();
  const clipId = `cross-clip-${id}`;
  const maskId = `cross-mask-${id}`;
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <g clipPath={`url(#${clipId})`}>
        <path d="M5.879 2.625h8.242a3.254 3.254 0 0 1 3.254 3.254v8.242a3.254 3.254 0 0 1-3.254 3.254H5.88a3.254 3.254 0 0 1-3.254-3.254V5.88a3.254 3.254 0 0 1 3.254-3.254Z" />
        <mask
          id={maskId}
          style={{ maskType: "alpha" }}
          maskUnits="userSpaceOnUse"
          x={-1}
          y={-1}
          width={22}
          height={22}
        >
          <path d="M2.426 15.044 15.044 2.426M7.383 20 20 7.383M0 12.617 12.617 0m-7.98 17.941L17.256 5.324m-2.211 12.25L2.426 4.956M20 12.617 7.383 0m5.234 20L0 7.383m17.941 7.98L5.324 2.745" />
        </mask>
        <g mask={`url(#${maskId})`}>
          <path d="M14.121 2H5.88A3.879 3.879 0 0 0 2 5.879v8.242A3.879 3.879 0 0 0 5.879 18h8.242A3.879 3.879 0 0 0 18 14.121V5.88A3.879 3.879 0 0 0 14.121 2Z" fill="currentColor" />
        </g>
      </g>
      <defs>
        <clipPath id={clipId}>
          <path fill="#fff" d="M0 0h20v20H0z" />
        </clipPath>
      </defs>
    </svg>
  );
};

const FillSolidIcon = () => {
  const id = useId();
  const clipId = `solid-clip-${id}`;
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <g clipPath={`url(#${clipId})`}>
        <path d="M4.91 2.625h10.18a2.284 2.284 0 0 1 2.285 2.284v10.182a2.284 2.284 0 0 1-2.284 2.284H4.909a2.284 2.284 0 0 1-2.284-2.284V4.909a2.284 2.284 0 0 1 2.284-2.284Z" />
        <path d="M4.91 2.625h10.18a2.284 2.284 0 0 1 2.285 2.284v10.182a2.284 2.284 0 0 1-2.284 2.284H4.909a2.284 2.284 0 0 1-2.284-2.284V4.909a2.284 2.284 0 0 1 2.284-2.284Z" fill="currentColor" />
      </g>
      <defs>
        <clipPath id={clipId}>
          <path fill="#fff" d="M0 0h20v20H0z" />
        </clipPath>
      </defs>
    </svg>
  );
};

// ============ 单选按钮组 ============

interface RadioOption<T> {
  value: T;
  label: string;
  icon: ReactNode;
}

function RadioSection<T extends string | number>({
  label,
  group,
  options,
  value,
  onChange,
}: {
  label: string;
  group: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="buttonList">
        {options.map((option) => (
          <label
            key={String(option.value)}
            className={value === option.value ? "active" : ""}
            title={option.label}
          >
            <input
              type="radio"
              name={group}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.icon}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ============ 面板 ============

export default function StylePanel({
  style,
  onChange,
  isDark,
  mode = "shape",
  penType,
  onPenTypeChange,
  nativeHost = false,
  onFlipHorizontal,
  onFlipVertical,
}: StylePanelProps) {
  const isTransparent = style.backgroundColor === "transparent";
  const isPen = mode === "pen";

  const fillOptions: RadioOption<FillStyle>[] = [
    { value: "hachure", label: "线条", icon: <FillHachureIcon /> },
    { value: "cross-hatch", label: "交叉线条", icon: <FillCrossHatchIcon /> },
    { value: "solid", label: "实心", icon: <FillSolidIcon /> },
  ];

  const strokeWidthOptions: RadioOption<StrokeWidthKey>[] = [
    { value: "thin", label: "细", icon: <StrokeWidthBaseIcon /> },
    { value: "medium", label: "中", icon: <StrokeWidthBoldIcon /> },
    { value: "bold", label: "粗", icon: <StrokeWidthExtraBoldIcon /> },
  ];

  const strokeStyleOptions: RadioOption<StrokeStyle>[] = [
    { value: "solid", label: "实线", icon: <StrokeWidthBaseIcon /> },
    { value: "dashed", label: "虚线", icon: <StrokeStyleDashedIcon /> },
    { value: "dotted", label: "点虚线", icon: <StrokeStyleDottedIcon /> },
  ];

  const sloppinessOptions: RadioOption<Roughness>[] = [
    { value: 0, label: "朴素", icon: <SloppinessArchitectIcon /> },
    { value: 1, label: "艺术", icon: <SloppinessArtistIcon /> },
    { value: 2, label: "漫画家", icon: <SloppinessCartoonistIcon /> },
  ];

  const roundnessOptions: RadioOption<RoundnessMode>[] = [
    { value: "sharp", label: "尖锐", icon: <EdgeSharpIcon /> },
    { value: "rounded", label: "圆润", icon: <EdgeRoundIcon /> },
  ];

  // 更多画笔：只保留对笔画生效的两项，DOM 结构与完整面板保持一致（复用同一套样式）
  if (isPen) {
    return (
      <aside className={`style-panel${nativeHost ? " in-native-panel" : ""}`} aria-label="绘图风格">
        <div className="selected-shape-actions">
          <div className="pen-list">
            <fieldset>
              <legend>画笔</legend>
              <div className="buttonList">
                {PEN_ORDER.map((type) => {
                  const preset = PEN_PRESETS[type];
                  const selected = penType === type;
                  return (
                    <label
                      key={type}
                      className={selected ? "active" : ""}
                      title={preset.name}
                    >
                      <input
                        type="radio"
                        name="pen-type"
                        checked={selected}
                        onChange={() => onPenTypeChange?.(type)}
                      />
                      <PenSwatch type={type} />
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <NativeColorPicker
            label="描边"
            type="elementStroke"
            color={style.strokeColor}
            theme={isDark ? "dark" : "light"}
            onChange={(c) => onChange({ strokeColor: c })}
          />

          <RadioSection
            label="描边宽度"
            group="stroke-width"
            options={strokeWidthOptions}
            value={style.strokeWidthKey}
            onChange={(strokeWidthKey) => onChange({ strokeWidthKey })}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className={`style-panel${nativeHost ? " in-native-panel" : ""}`} aria-label="绘图风格">
      <div className="selected-shape-actions">
        <NativeColorPicker
          label="描边"
          type="elementStroke"
          color={style.strokeColor}
          theme={isDark ? "dark" : "light"}
          onChange={(c) => onChange({ strokeColor: c })}
        />

        <NativeColorPicker
          label="更改背景颜色"
          type="elementBackground"
          color={style.backgroundColor}
          theme={isDark ? "dark" : "light"}
          onChange={(c) => onChange({ backgroundColor: c })}
        />

        {!isTransparent && (
          <RadioSection
            label="填充"
            group="fill"
            options={fillOptions}
            value={style.fillStyle}
            onChange={(fillStyle) => onChange({ fillStyle })}
          />
        )}

        <RadioSection
          label="描边宽度"
          group="stroke-width"
          options={strokeWidthOptions}
          value={style.strokeWidthKey}
          onChange={(strokeWidthKey) => onChange({ strokeWidthKey })}
        />

        <RadioSection
          label="边框样式"
          group="strokeStyle"
          options={strokeStyleOptions}
          value={style.strokeStyle}
          onChange={(strokeStyle) => onChange({ strokeStyle })}
        />

        <RadioSection
          label="线条风格"
          group="sloppiness"
          options={sloppinessOptions}
          value={style.roughness}
          onChange={(roughness) => onChange({ roughness })}
        />

        <RadioSection
          label="边角"
          group="edges"
          options={roundnessOptions}
          value={style.roundness}
          onChange={(roundness) => onChange({ roundness })}
        />

        {/* 翻转 / 镜像 */}
        {(onFlipHorizontal || onFlipVertical) && (
          <fieldset>
            <legend>翻转</legend>
            <div className="buttonList">
              {onFlipHorizontal && (
                <label
                  title="水平翻转 (Shift+H)"
                  className="flip-btn"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onFlipHorizontal();
                  }}
                >
                  <FlipHorizontalIcon />
                </label>
              )}
              {onFlipVertical && (
                <label
                  title="垂直翻转 (Shift+V)"
                  className="flip-btn"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onFlipVertical();
                  }}
                >
                  <FlipVerticalIcon />
                </label>
              )}
            </div>
          </fieldset>
        )}
      </div>
    </aside>
  );
}
