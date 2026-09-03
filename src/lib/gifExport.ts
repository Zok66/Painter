// 帧动画导出 GIF
//
// 流程：逐帧 exportToCanvas 渲染 → 按全局包围盒对齐到同一张画布 → gifenc 量化编码。
//
// 两个坑：
// 1. exportToCanvas 是按「这一帧自己的包围盒」裁剪的，每帧尺寸不一样，
//    直接塞进 GIF 会让画面来回跳。所以先算出所有帧的并集包围盒，
//    再把每帧画到统一画布上对应的偏移位置。
// 2. 纸纹钩子（__painterPaperRender）也挂在 _renderStaticScene 上，
//    导出时同样会画出来。动画一般不要纸，所以导出前临时切成 blank，导完还原。

import { exportToCanvas } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { getPaperTemplate, setPaperTemplate } from "./paperTexture";
import { stripOnionElements } from "./onionSkin";

export interface GifFrameInput {
  elements: readonly ExcalidrawElement[];
  /** 停留帧数 */
  hold: number;
}

export interface GifExportOptions {
  frames: GifFrameInput[];
  files: BinaryFiles;
  fps: number;
  /** 导出倍率，1 = 原始尺寸 */
  scale: number;
  /** 是否铺背景色；false = 透明底 */
  background: boolean;
  backgroundColor: string;
  onProgress?: (done: number, total: number) => void;
}

/** 导出时留的白边（场景坐标） */
const PADDING = 8;

function globalBounds(frames: GifFrameInput[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    const els = stripOnionElements(frame.elements);
    if (!els.length) continue;
    const [x1, y1, x2, y2] = getCommonBounds(
      els as unknown as Parameters<typeof getCommonBounds>[0],
    );
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }
  if (!Number.isFinite(minX)) return [0, 0, 0, 0] as const;
  return [minX, minY, maxX, maxY] as const;
}

export async function exportAnimationToGif({
  frames,
  files,
  fps,
  scale,
  background,
  backgroundColor,
  onProgress,
}: GifExportOptions): Promise<Blob> {
  const safeScale = Math.max(0.5, Math.min(4, scale || 1));
  const [gMinX, gMinY, gMaxX, gMaxY] = globalBounds(frames);
  const width = Math.max(1, Math.round((gMaxX - gMinX + PADDING * 2) * safeScale));
  const height = Math.max(1, Math.round((gMaxY - gMinY + PADDING * 2) * safeScale));

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建导出画布");

  const gif = GIFEncoder();
  // GIF 的 delay 单位是 1/100 秒
  const perFrame = 100 / Math.max(1, fps);

  const paperBefore = getPaperTemplate();
  setPaperTemplate("blank");

  try {
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const els = stripOnionElements(frame.elements);
      ctx.clearRect(0, 0, width, height);

      if (els.length) {
        const canvas = await exportToCanvas({
          elements: els as unknown as ExcalidrawElement[],
          appState: {
            exportBackground: background,
            viewBackgroundColor: backgroundColor,
            exportWithDarkMode: false,
            exportEmbedScene: false,
            exportScale: safeScale,
          } as never,
          files,
          exportPadding: PADDING,
          getDimensions: (w: number, h: number) => ({
            width: w,
            height: h,
            scale: safeScale,
          }),
        });

        const [fMinX, fMinY] = getCommonBounds(
          els as unknown as Parameters<typeof getCommonBounds>[0],
        );
        // 这一帧画布左上角在全局画布里的位置
        const dx = Math.round((fMinX - PADDING - gMinX) * safeScale);
        const dy = Math.round((fMinY - PADDING - gMinY) * safeScale);
        ctx.drawImage(canvas, dx, dy, canvas.width, canvas.height);
      }

      const imageData = ctx.getImageData(0, 0, width, height);
      const rgba = new Uint32Array(imageData.data.buffer);
      const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
      const index = applyPalette(rgba, palette, "rgba4444");
      const delay = Math.max(2, Math.round(perFrame * Math.max(1, frame.hold)));
      const transparent = !background;
      gif.writeFrame(index, width, height, {
        palette,
        delay,
        transparent,
        // 只在第一帧写循环次数，0 = 无限循环
        repeat: i === 0 ? 0 : -1,
      });
      onProgress?.(i + 1, frames.length);
    }
  } finally {
    setPaperTemplate(paperBefore);
  }

  gif.finish();
  const bytes = gif.bytes();
  return new Blob([bytes as unknown as BlobPart], { type: "image/gif" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立刻 revoke 在部分浏览器会打断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
