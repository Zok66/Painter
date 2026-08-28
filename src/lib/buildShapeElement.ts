// 把自研识别器的结果构造成 Excalidraw 元素。
// 三角形、五角星等 Excalidraw 没有对应元素类型，统一用闭合的 line 多边形表示。

import { getStrokeWidthByKey } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawLineElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { recognizeShape } from "./shapeRecognition";
import type { Point } from "./shapeRecognition";

type LocalPointTuple = [number, number];
type RoundnessMode = "rounded" | "sharp";

function randomId(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

function commonProps(
  appState: AppState,
  type: ExcalidrawElement["type"],
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return {
    id: randomId(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: appState.currentItemStrokeColor,
    backgroundColor: appState.currentItemBackgroundColor,
    fillStyle: appState.currentItemFillStyle,
    strokeWidth: getStrokeWidthByKey(
      type,
      appState.currentItemStrokeWidthKey,
    ),
    strokeStyle: appState.currentItemStrokeStyle,
    roughness: appState.currentItemRoughness,
    opacity: appState.currentItemOpacity,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: 0,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

export function buildShapeElement(
  points: Point[],
  appState: AppState,
  roundnessMode: RoundnessMode = "sharp",
): ExcalidrawElement | null {
  const result = recognizeShape(points);
  if (result.type === "freedraw") return null;

  const [minX, minY, maxX, maxY] = result.bbox;

  // 根据 roundnessMode 决定是否添加圆角
  const lineRoundness = roundnessMode === "rounded" ? { type: 2 } : null;

  if (
    result.type === "rectangle" ||
    result.type === "diamond" ||
    result.type === "ellipse"
  ) {
    return {
      ...commonProps(
        appState,
        result.type,
        minX,
        minY,
        maxX - minX,
        maxY - minY,
      ),
      // 矩形/菱形需要应用圆角；椭圆没有圆角概念，保持 null
      roundness: result.type === "ellipse" ? null : lineRoundness,
    } as unknown as ExcalidrawElement;
  }

  if (result.type === "line" || result.type === "arrow") {
    const x = result.start.x;
    const y = result.start.y;
    const endX = result.end.x;
    const endY = result.end.y;
    const pts: LocalPointTuple[] = [
      [0, 0],
      [endX - x, endY - y],
    ];
    // 计算 line 的 bounding box 宽高
    const w = Math.abs(endX - x);
    const h = Math.abs(endY - y);
    const base = commonProps(appState, result.type, Math.min(x, endX), Math.min(y, endY), w, h);
    if (result.type === "arrow") {
      return {
        ...base,
        roundness: lineRoundness,
        points: pts,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: appState.currentItemEndArrowhead ?? "arrow",
        elbowed: false,
      } as unknown as ExcalidrawElement;
    }
    return {
      ...base,
      roundness: lineRoundness,
      points: pts,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: null,
      polygon: false,
    } as unknown as ExcalidrawElement;
  }

  // triangle / star5 / trapezoid / pentagon / hexagon：闭合 line 多边形
  const polygon = result.polygon;
  if (polygon.length < 3) return null;
  const polyX = polygon[0].x;
  const polyY = polygon[0].y;
  const pts: LocalPointTuple[] = polygon.map(
    (p) => [p.x - polyX, p.y - polyY] as LocalPointTuple,
  );
  pts.push([0, 0]);
  // 使用 bbox 的宽高，确保 adjustRoughness 函数能正确应用 roughness
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    ...commonProps(appState, "line", minX, minY, w, h),
    roundness: lineRoundness,
    points: pts,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    polygon: true,
  } as unknown as ExcalidrawElement;
}

// 绘制过程中的轨迹预览：用普通的 line 折线，不用 freedraw。
// freedraw 笔触会按 pressure 加粗，导致同 strokeWidth 下比最终生成的 line 粗很多。
// line 折线的渲染方式和最终形状完全一致，所以预览粗细等于实际生成粗细。
export function buildPreviewPolyline(
  points: Point[],
  appState: AppState,
  id: string,
  opacity = 45,
): ExcalidrawLineElement {
  const x = points[0].x;
  const y = points[0].y;
  const pts: LocalPointTuple[] = points.map(
    (p) => [p.x - x, p.y - y] as LocalPointTuple,
  );
  const base = commonProps(appState, "line", x, y, 0, 0);
  return {
    ...base,
    id,
    type: "line",
    points: pts,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    polygon: false,
    opacity,
  } as unknown as ExcalidrawLineElement;
}
