// 帧动画导出 GIF（关键帧补间版）
//
// 流程：按时间逐帧 buildSceneAtTime 采样 → 算所有输出帧的并集包围盒 →
// 把每帧对齐到统一画布 → gifenc 量化编码。
//
// 两个坑（与逐帧版一致）：
// 1. exportToCanvas 按单帧自身包围盒裁剪，每帧尺寸不同，直接塞 GIF 会跳动，
//    故先算并集包围盒再 drawImage 对齐。
// 2. 纸纹钩子挂在 _renderStaticScene 上，导出也会画出来；动画一般不要纸，
//    故导出前临时切 blank，导完还原。

import { exportToCanvas } from "@excalidraw/excalidraw";
import { getCommonBounds } from "@excalidraw/element";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { getPaperTemplate, setPaperTemplate } from "./paperTexture";
import { stripOnionElements } from "./onionSkin";
import { buildSceneAtTime, type AnimProject } from "./keyframeAnim";

export interface GifExportOptions {
  project: AnimProject;
  /** 基准场景（用户编辑的画布元素） */
  baseElements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  fps: number;
  /** 总时长（秒） */
  durationSec: number;
  /** 导出倍率，1 = 原始尺寸 */
  scale: number;
  /** 是否铺背景色；false = 透明底 */
  background: boolean;
  backgroundColor: string;
  onProgress?: (done: number, total: number) => void;
}

/** 导出时留的白边（场景坐标） */
const PADDING = 8;

function globalBounds(
  project: AnimProject,
  baseElements: readonly ExcalidrawElement[],
  total: number,
  fps: number,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    const els = stripOnionElements(buildSceneAtTime(project, baseElements, t));
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
  project,
  baseElements,
  files,
  fps,
  durationSec,
  scale,
  background,
  backgroundColor,
  onProgress,
}: GifExportOptions): Promise<Blob> {
  const safeScale = Math.max(0.5, Math.min(4, scale || 1));
  const total = Math.max(1, Math.round(durationSec * fps));
  const [gMinX, gMinY, gMaxX, gMaxY] = globalBounds(
    project,
    baseElements,
    total,
    fps,
  );
  const width = Math.max(1, Math.round((gMaxX - gMinX + PADDING * 2) * safeScale));
  const height = Math.max(1, Math.round((gMaxY - gMinY + PADDING * 2) * safeScale));

  const composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建导出画布");

  const gif = GIFEncoder();
  // gifenc 的 writeFrame.delay 期望毫秒
  const perFrameMs = 1000 / Math.max(1, fps);

  const paperBefore = getPaperTemplate();
  setPaperTemplate("blank");

  try {
    for (let i = 0; i < total; i++) {
      const t = i / fps;
      const els = stripOnionElements(buildSceneAtTime(project, baseElements, t));
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
        // 单帧画布左上角对应场景 (fMinX-PADDING, fMinY-PADDING)，
        // composite 起点对应场景 (gMinX-PADDING, gMinY-PADDING)，
        // 故元素 bbox 左上 (fMinX, fMinY) 落在 composite 的 (fMinX-gMinX, fMinY-gMinY)。
        const dx = Math.round((fMinX - gMinX) * safeScale);
        const dy = Math.round((fMinY - gMinY) * safeScale);
        ctx.drawImage(canvas, dx, dy, canvas.width, canvas.height);
      }

      const imageData = ctx.getImageData(0, 0, width, height);
      // gifenc 要求 flat 的 Uint8ClampedArray（逐字节 RGBA），直接传 imageData.data
      const rgba = imageData.data;
      const palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
      const index = applyPalette(rgba, palette, "rgba4444");
      const delay = Math.round(perFrameMs);
      const transparent = !background;
      let transparentIndex = 0;
      if (transparent) {
        const idx = palette.findIndex((c) => c.length >= 4 && c[3] === 0);
        if (idx >= 0) transparentIndex = idx;
      }
      gif.writeFrame(index, width, height, {
        palette,
        delay,
        transparent,
        transparentIndex,
        repeat: i === 0 ? 0 : -1,
      });
      onProgress?.(i + 1, total);
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
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
