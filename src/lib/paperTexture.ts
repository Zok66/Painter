// 纸张纹理（空白 / 横线 / 方格 / 点阵）
//
// 由 vite.config.ts 的 patch 注入到 Excalidraw 的 renderStaticScene：
// 调用点在 ctx.scale(zoom) 之后、原生 strokeGrid 之前，所以纹理和元素同处
// 场景坐标系——平移时跟着走、缩放时跟着变。同一条渲染路径也被导出复用，
// 因此导出的 PNG / SVG 自带纸张纹理，不需要事后合成。
//
// 注入失败时（Excalidraw 升级导致锚点失配）只是没有纹理，不会报错。

import type { PaperTemplate } from "./notebook";

interface PaperColors {
  ruled: string;
  grid: string;
  dot: string;
}

const LIGHT: PaperColors = {
  ruled: "#d7e3f2",
  grid: "#e1e5eb",
  dot: "#c8ced8",
};

// 暗色主题下用压暗的线色，否则浅蓝网格在深色背景上会发飘
const DARK: PaperColors = {
  ruled: "#2f3a4d",
  grid: "#31363f",
  dot: "#4a5261",
};

/** 点阵比网格密一档，视觉重量才和 32 间距的网格对齐 */
const DOTTED_STEP = 24;
const LINE_STEP = 32;

export function drawPaperTexture(
  ctx: CanvasRenderingContext2D,
  template: PaperTemplate,
  scrollX: number,
  scrollY: number,
  zoom: { value: number },
  width: number,
  height: number,
  isDark = false,
) {
  if (template === "blank") return;

  const colors = isDark ? DARK : LIGHT;
  const step = template === "dotted" ? DOTTED_STEP : LINE_STEP;
  // 取模对齐滚动偏移，纹理才不会随平移"游走"
  const startX = (scrollX % step) - step;
  const startY = (scrollY % step) - step;
  // width/height 是归一化后的画布尺寸，除回 zoom 得到场景坐标
  const w = width / zoom.value;
  const h = height / zoom.value;

  ctx.save();
  // 抵消外层 scale(zoom)，屏幕上始终是 1px 细线
  ctx.lineWidth = Math.min(1 / zoom.value, 1);
  ctx.strokeStyle = template === "ruled" ? colors.ruled : colors.grid;
  ctx.fillStyle = colors.dot;

  if (template === "dotted") {
    const r = Math.max(0.8 / zoom.value, 0.55);
    for (let x = startX; x < startX + w + step * 2; x += step) {
      for (let y = startY; y < startY + h + step * 2; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  ctx.beginPath();
  // 竖线只有方格画，横线两者共用——横线纸因此只剩横线
  if (template === "grid") {
    for (let x = startX; x < startX + w + step * 2; x += step) {
      ctx.moveTo(x, startY - step);
      ctx.lineTo(x, startY + h + step * 2);
    }
  }
  for (let y = startY; y < startY + h + step * 2; y += step) {
    ctx.moveTo(startX - step, y);
    ctx.lineTo(startX + w + step * 2, y);
  }
  ctx.stroke();
  ctx.restore();
}

let currentTemplate: PaperTemplate = "blank";
let currentDark = false;

/** 切页 / 改纸张时调用，下一次重绘即生效 */
export function setPaperTemplate(template: PaperTemplate) {
  currentTemplate = template;
}

/** 导出动画时要临时摘掉纸纹，导完再还原，所以需要读当前值 */
export function getPaperTemplate(): PaperTemplate {
  return currentTemplate;
}

export function setPaperDark(isDark: boolean) {
  currentDark = isDark;
}

/** 注册到 window，供 Excalidraw 渲染钩子调用 */
export function installPaperTextureRenderer() {
  const w = window as unknown as Record<string, unknown>;
  w.__painterPaperRender = (
    ctx: CanvasRenderingContext2D,
    scrollX: number,
    scrollY: number,
    zoom: { value: number },
    width: number,
    height: number,
  ) =>
    drawPaperTexture(
      ctx,
      currentTemplate,
      scrollX,
      scrollY,
      zoom,
      width,
      height,
      currentDark,
    );
}
