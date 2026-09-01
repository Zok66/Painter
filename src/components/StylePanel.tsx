import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  applyDarkModeFilter,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_PICKS,
  isColorDark,
} from "@excalidraw/common";
import { PEN_ORDER, PEN_PRESETS } from "../lib/pens";
import type { PenType } from "../lib/pens";
import { PenSwatch } from "./PenMenu";
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

// ============ 颜色选择器 ============

type PaletteValue = string | readonly string[];

const SHADE_KEYS = [
  "cyan",
  "blue",
  "violet",
  "grape",
  "pink",
  "green",
  "teal",
  "yellow",
  "orange",
  "red",
] as const;

const SHADE_LABELS: Record<number, string> = {
  0: "最浅",
  1: "浅",
  2: "标准",
  3: "深",
  4: "最深",
};

/**
 * QWERTY 快捷键：网格按 5 列排，前 15 个色块对应键盘中排三行字母。
 * 与原生一致——字母既是位置也是快捷选色键。
 */
const QWERTY_KEYS = [
  "q", "w", "e", "r", "t",
  "a", "s", "d", "f", "g",
  "z", "x", "c", "v", "b",
] as const;

function findShadeKey(
  palette: Record<string, PaletteValue>,
  color: string,
): string | null {
  for (const key of SHADE_KEYS) {
    const row = palette[key] as string[] | undefined;
    if (row?.includes(color)) return key;
  }
  return null;
}

function buildPaletteRows(
  palette: Record<string, PaletteValue>,
): {
  topRow: readonly string[];
  rows: readonly (readonly string[])[];
} {
  const gray = palette.gray as readonly string[];
  const bronze = palette.bronze as readonly string[];
  const topRow = [
    palette.transparent as string,
    palette.white as string,
    ...gray,
    palette.black as string,
    ...bronze,
  ];
  const rows = SHADE_KEYS.map(
    (key) => palette[key] as readonly string[],
  );
  return { topRow, rows };
}

interface ColorPickerSectionProps {
  label: string;
  color: string;
  topPicks: readonly string[];
  palette: Record<string, PaletteValue>;
  isDark: boolean;
  isTransparent?: boolean;
  onChange: (color: string) => void;
}

/** 浮层与触发按钮的间距，与原生 popper 的 offset 观感一致 */
const POPUP_GAP = 8;
/** 浮层距视口边缘的最小留白 */
const POPUP_EDGE = 8;

function ColorPickerSection({
  label,
  color,
  topPicks,
  palette,
  isDark,
  isTransparent,
  onChange,
}: ColorPickerSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // null = 还没测量完（此时浮层隐藏在视口外，避免闪一下再跳位）
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  /**
   * 锚定到触发按钮并按可用空间翻转。
   * 用 fixed 而不是 absolute：.style-panel 有 overflow-y: auto，
   * absolute 浮层会被面板高度裁掉。
   */
  useLayoutEffect(() => {
    if (!expanded) {
      setPopupPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!trigger || !popup) return;

    const t = trigger.getBoundingClientRect();
    const h = popup.offsetHeight;
    const w = popup.offsetWidth;
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // 垂直：优先放下方，下方不够就翻到上方，上下都不够则贴视口底部
    let top = t.bottom + POPUP_GAP;
    if (top + h > vh - POPUP_EDGE) {
      const above = t.top - POPUP_GAP - h;
      top =
        above >= POPUP_EDGE ? above : Math.max(POPUP_EDGE, vh - h - POPUP_EDGE);
    }

    // 水平：浮层左边缘对齐触发按钮左边缘（与原生 .dropdown-menu 一致），
    // 只有右下溢出视口时才整体左移并夹进视口，避免被左边裁掉。
    let left = t.left;
    if (left + w > vw - POPUP_EDGE) {
      left = Math.max(POPUP_EDGE, vw - w - POPUP_EDGE);
    }
    if (left < POPUP_EDGE) left = POPUP_EDGE;

    setPopupPos({ top, left });
  }, [expanded, color]);

  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      const section = sectionRef.current;
      if (
        section &&
        !section.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
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

  const displayColor =
    color === "transparent"
      ? color
      : applyDarkModeFilter(color, isDark);

  return (
    <div className="color-picker-section" ref={sectionRef}>
      <h3>{label}</h3>
      <div className="color-picker-container">
        <div className="color-picker__top-picks">
          {topPicks.map((pick) => {
            const displayPick =
              pick === "transparent"
                ? pick
                : applyDarkModeFilter(pick, isDark);
            return (
              <button
                key={pick}
                type="button"
                className={`color-picker__button ${
                  pick === color ? "active" : ""
                } ${pick === "transparent" ? "is-transparent" : ""} ${
                  !isColorDark(pick) ? "has-outline" : ""
                }`}
                style={{ "--swatch-color": displayPick } as CSSProperties}
                title={pick === "transparent" ? "透明" : pick}
                aria-label={`${label} ${pick === "transparent" ? "透明" : pick}`}
                onClick={() => onChange(pick)}
              >
                <div className="color-picker__button-outline" />
              </button>
            );
          })}
        </div>
        <div className="button-separator" />
        <button
          ref={triggerRef}
          type="button"
          className={`color-picker__button color-picker__button--large ${
            color === "transparent" ? "is-transparent" : ""
          } ${!isColorDark(color) ? "has-outline" : ""}`}
          style={{ "--swatch-color": displayColor } as CSSProperties}
          title={expanded ? "收起" : "更多颜色"}
          aria-label={expanded ? "收起颜色面板" : "展开更多颜色"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="color-picker__button-outline" />
        </button>
      </div>

      {expanded && (
        <div
          ref={popupRef}
          className="color-picker-popup"
          style={
            popupPos
              ? { top: popupPos.top, left: popupPos.left }
              : // 还没测量时先藏到视口外，避免先闪一下左上角再跳位
                { top: -9999, left: -9999, visibility: "hidden" }
          }
        >
          <ColorPickerGrid
            palette={palette}
            color={color}
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

function ColorPickerGrid({
  palette,
  color,
  isTransparent,
  onChange,
}: {
  palette: Record<string, PaletteValue>;
  color: string;
  isTransparent?: boolean;
  onChange: (color: string) => void;
}) {
  const [hexInput, setHexInput] = useState(
    color.startsWith("#") ? color.slice(1) : "",
  );
  const { topRow, rows } = buildPaletteRows(palette);
  const activeShadeKey = findShadeKey(palette, color);

  // palette 是模块级常量（DEFAULT_ELEMENT_*_PALETTE），引用稳定，故 flatColors
  // 用 useMemo([palette]) 只算一次，QWERTY 监听不会因每次渲染产生新数组而反复解绑重绑。
  const flatColors = useMemo(() => [...topRow, ...rows.flat()], [palette]);

  // 用 ref 拿最新的 onChange，避免父组件重渲染导致监听反复解绑重绑
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // QWERTY 快捷键：本组件只在浮层展开时挂载，所以监听天然只在展开期生效
  useEffect(() => {
    // 网格渲染顺序 = topRow 在前、各色系依次在后，快捷键按这个顺序映射前 15 个。
    const handleKey = (e: KeyboardEvent) => {
      // 正在十六进制输入框里打字时不能触发，否则输入会被误当成选色
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const index = QWERTY_KEYS.indexOf(
        e.key.toLowerCase() as (typeof QWERTY_KEYS)[number],
      );
      if (index === -1) return;
      const picked = flatColors[index];
      if (picked === undefined) return;

      e.preventDefault();
      onChangeRef.current(picked);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [flatColors]);

  const handleHex = (value: string) => {
    setHexInput(value);
    const clean = value.replace(/[^0-9a-fA-F]/g, "");
    if (clean.length === 6) {
      onChange(`#${clean.toLowerCase()}`);
    }
  };

  const gridSwatches = (
    colors: readonly string[],
    titlePrefix: string,
  ): ReactNode =>
    colors.map((c) => {
      const isTransparentColor = c === "transparent";
      return (
        <button
          key={c}
          type="button"
          className={`color-picker__button ${
            c === color ? "active" : ""
          } ${isTransparentColor ? "is-transparent" : ""} ${
            !isColorDark(c) ? "has-outline" : ""
          }`}
          style={{ "--swatch-color": c } as CSSProperties}
          title={isTransparentColor ? "透明" : c}
          aria-label={`${titlePrefix} ${
            isTransparentColor ? "透明" : c
          }`}
          onClick={() => onChange(c)}
        >
          <div className="color-picker__button-outline" />
        </button>
      );
    });

  const shades = activeShadeKey
    ? (palette[activeShadeKey] as readonly string[])
    : null;

  return (
    <div className="color-picker-content">
      <div className="picker-heading">颜色</div>
      <div className="color-picker-content color-picker-content--default">
        {gridSwatches(topRow, "颜色")}
        {rows.map((row) => gridSwatches(row, "颜色"))}
      </div>

      {/* 与原生的差异：色阶区块始终存在，无变体时显示占位文案而不是整块消失 */}
      <div className="picker-heading">色调明暗</div>
      {shades ? (
        <div className="shade-list">
          {shades.map((c, i) => (
            <button
              key={`${activeShadeKey}-${i}`}
              type="button"
              className={`color-picker__button color-picker__button--large ${
                c === color ? "active" : ""
              } ${!isColorDark(c) ? "has-outline" : ""}`}
              style={{ "--swatch-color": c } as CSSProperties}
              title={`${SHADE_LABELS[i]} ${c}`}
              aria-label={`${SHADE_LABELS[i]} ${c}`}
              onClick={() => onChange(c)}
            >
              <div className="color-picker__button-outline" />
            </button>
          ))}
        </div>
      ) : (
        <div className="shade-empty">此颜色没有可用的明暗变化</div>
      )}

      <div className="picker-heading">十六进制值</div>
      <div className="color-picker__input-label">
        <span className="color-picker__input-hash">#</span>
        <input
          className="color-picker-input"
          type="text"
          maxLength={6}
          placeholder={
            isTransparent || !color.startsWith("#")
              ? "------"
              : color.replace("#", "")
          }
          value={hexInput}
          onChange={(e) => handleHex(e.target.value)}
          aria-label="十六进制颜色值"
        />
      </div>

      <div className="color-picker__tip">
        按住并拖拽任意颜色到上方常用色，即可固定它
      </div>
    </div>
  );
}

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
          <ColorPickerSection
            label="描边"
            color={style.strokeColor}
            topPicks={DEFAULT_ELEMENT_STROKE_PICKS}
            palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
            isDark={isDark}
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
        <ColorPickerSection
          label="描边"
          color={style.strokeColor}
          topPicks={DEFAULT_ELEMENT_STROKE_PICKS}
          palette={DEFAULT_ELEMENT_STROKE_COLOR_PALETTE}
          isDark={isDark}
          onChange={(c) => onChange({ strokeColor: c })}
        />

        <ColorPickerSection
          label="更改背景颜色"
          color={style.backgroundColor}
          topPicks={DEFAULT_ELEMENT_BACKGROUND_PICKS}
          palette={DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE}
          isDark={isDark}
          isTransparent={isTransparent}
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
      </div>
    </aside>
  );
}
