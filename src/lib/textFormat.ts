import { getFontString, applyDarkModeFilter } from "@excalidraw/common";

export type TextDirection = "horizontal" | "vertical";

/** 垂直对齐：框高于内容时，文字在框内的落位。与原生 VERTICAL_ALIGN 取值一致。 */
export type TextVerticalAlign = "top" | "middle" | "bottom";

export interface TextFormatCustomData {
  textDirection?: TextDirection;
  /** 字体间距（字距），单位 px，0 表示原生默认 */
  letterSpacing?: number;
  /** 用户拖拽上下手柄设定的框高度。缺省（undefined）表示高度由内容决定，即原生行为。 */
  fixedHeight?: number;
  /** 垂直对齐。缺省按 "top"，与原生 DEFAULT_VERTICAL_ALIGN 一致，保证旧文档不受影响。 */
  verticalAlign?: TextVerticalAlign;
}

export const DEFAULT_VERTICAL_ALIGN: TextVerticalAlign = "top";

/**
 * 文字在框内的垂直偏移：框高于内容时按 verticalAlign 分配富余空间。
 * 渲染（横排/竖排）与编辑态 textarea 共用，保证两处落位一致。
 * contentHeight 为当前文本的实际排版高度；框不高于内容时恒为 0（内容永远完整可见）。
 */
export function painterTextPadTop(
  boxHeight: number,
  contentHeight: number,
  verticalAlign: TextVerticalAlign | undefined,
): number {
  const free = boxHeight - contentHeight;
  if (!(free > 0)) return 0;
  if (verticalAlign === "bottom") return free;
  if (verticalAlign === "middle") return free / 2;
  return 0;
}

export interface TextMetrics {
  width: number;
  height: number;
}

/** 竖排时每列宽度（像素）= 字号 × 此系数；与绘制保持一致，确保包围盒精确贴合文本 */
const COLUMN_WIDTH_FACTOR = 1;

let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx) {
    const canvas = document.createElement("canvas");
    _measureCtx = canvas.getContext("2d");
  }
  return _measureCtx;
}

function measureLineWidth(text: string, font: string, letterSpacing: number): number {
  const ctx = getMeasureCtx();
  if (!ctx) return 0;
  ctx.font = font;
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = letterSpacing
      ? `${letterSpacing}px`
      : "0px";
  } catch {
    /* 浏览器不支持 ctx.letterSpacing 时忽略 */
  }
  return ctx.measureText(text || " ").width;
}

/**
 * 计算文字元素的包围盒尺寸，覆盖原生 measureText：
 * - 竖排：宽 = 列数 × 字号，高 = 最长列字符数 × 行距（含字距）
 * - 横排 + 字距：原生逐行宽度叠加字距
 * 由 Excalidraw 的 redrawTextBoundingBox 在打过补丁后调用（见 scripts/patch-excalidraw.mjs）。
 */
export function painterMeasureText(element: {
  text: string;
  fontSize: number;
  lineHeight: number;
  fontFamily: number;
  customData?: TextFormatCustomData;
}): TextMetrics {
  try {
    const fontSize = element.fontSize;
    const lineHeightPx = fontSize * element.lineHeight;
    const letterSpacing = element.customData?.letterSpacing ?? 0;
    const vertical = element.customData?.textDirection === "vertical";
    const lines = (element.text || "").replace(/\r\n?/g, "\n").split("\n");

    if (vertical) {
      const columnWidth = fontSize * COLUMN_WIDTH_FACTOR;
      const stepY = lineHeightPx + letterSpacing;
      let maxChars = 1;
      for (const line of lines) maxChars = Math.max(maxChars, line.length);
      const height = maxChars * stepY;
      const width = lines.length * columnWidth;
      return { width, height };
    }

    const font = getFontString({ fontSize, fontFamily: element.fontFamily });
    let width = 0;
    for (const line of lines) {
      width = Math.max(width, measureLineWidth(line, font, letterSpacing));
    }
    const height = lines.length * lineHeightPx;
    return { width, height };
  } catch (e) {
    console.error("[painterMeasureText]", e);
    return { width: element.fontSize || 16, height: element.fontSize || 16 };
  }
}

/**
 * 竖排文字绘制：每个字符独占一格，自上而下堆叠；多行文本按列从右向左排列
 * （遵循中文竖排习惯）。字距（letterSpacing）会叠加到每格垂直间距上。
 * 仅处理竖排；横排 + 字距走原生渲染（由 patch-excalidraw.mjs 注入 context.letterSpacing）。
 */
export function painterTextRender(
  element: {
    text: string;
    fontSize: number;
    lineHeight: number;
    fontFamily: number;
    textAlign: "left" | "center" | "right";
    strokeColor: string;
    height: number;
    customData?: TextFormatCustomData;
  },
  context: CanvasRenderingContext2D,
  renderConfig: { theme?: "light" | "dark" },
  _opts?: { rtl?: boolean },
): void {
  try {
    context.save();
    context.font = getFontString({
      fontSize: element.fontSize,
      fontFamily: element.fontFamily,
    });
    context.fillStyle = applyDarkModeFilter(
      element.strokeColor,
      renderConfig?.theme === "dark",
    );
    context.textAlign = "center";
    context.textBaseline = "middle";

    const letterSpacing = element.customData?.letterSpacing ?? 0;
    const lines = (element.text || "").replace(/\r\n?/g, "\n").split("\n");
    const lineHeightPx = element.fontSize * element.lineHeight;
    const columnWidth = element.fontSize * COLUMN_WIDTH_FACTOR;
    const stepY = lineHeightPx + letterSpacing;

    const totalWidth = lines.length * columnWidth;
    const anchorX =
      element.textAlign === "center"
        ? totalWidth / 2
        : element.textAlign === "right"
          ? totalWidth - columnWidth / 2
          : columnWidth / 2;

    try {
      (context as unknown as { letterSpacing: string }).letterSpacing = letterSpacing
        ? `${letterSpacing}px`
        : "0px";
    } catch {
      /* ignore */
    }

    // 框高于内容时，按 verticalAlign 把整块文字下移对应距离（竖排同样作用于垂直方向）
    let maxChars = 1;
    for (const line of lines) maxChars = Math.max(maxChars, line.length);
    const padTop = painterTextPadTop(
      element.height,
      maxChars * stepY,
      element.customData?.verticalAlign,
    );

    for (let c = 0; c < lines.length; c++) {
      const col = lines[c];
      const x = anchorX - c * columnWidth;
      for (let i = 0; i < col.length; i++) {
        const y = i * stepY + stepY / 2 + padTop;
        context.fillText(col[i], x, y);
      }
    }

    context.restore();
  } catch (e) {
    console.error("[painterTextRender]", e);
    context.restore();
  }
}

/** 在应用启动早期调用，把渲染/测量钩子挂到 window，供 Excalidraw 补丁调用 */
export function installPainterTextFormat(): void {
  const w = window as unknown as Record<string, unknown>;
  w.__painterTextRender = painterTextRender;
  w.__painterMeasureText = painterMeasureText;
}
