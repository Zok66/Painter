// 把自研识别器的结果构造成 Excalidraw 元素。
// 三角形、五角星等 Excalidraw 没有对应元素类型，统一用闭合的 line 多边形表示。

import { getStrokeWidthByKey } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { recognizeShape } from "./shapeRecognition";
import type { Point } from "./shapeRecognition";

type LocalPointTuple = [number, number];

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
): ExcalidrawElement | null {
  const result = recognizeShape(points);
  if (result.type === "freedraw") return null;

  const [minX, minY, maxX, maxY] = result.bbox;

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
    } as unknown as ExcalidrawElement;
  }

  if (result.type === "line" || result.type === "arrow") {
    const x = result.start.x;
    const y = result.start.y;
    const pts: LocalPointTuple[] = [
      [0, 0],
      [result.end.x - x, result.end.y - y],
    ];
    const base = commonProps(appState, result.type, x, y, 0, 0);
    if (result.type === "arrow") {
      return {
        ...base,
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
  const x = polygon[0].x;
  const y = polygon[0].y;
  const pts: LocalPointTuple[] = polygon.map(
    (p) => [p.x - x, p.y - y] as LocalPointTuple,
  );
  pts.push([0, 0]);
  return {
    ...commonProps(appState, "line", x, y, 0, 0),
    points: pts,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    polygon: true,
  } as unknown as ExcalidrawElement;
}

// 绘制过程中的轨迹预览：一个半透明的 freedraw 元素，
// 通过 updateScene 加入场景渲染，松手时再替换为最终形状。
export function buildFreedrawPreview(
  points: Point[],
  appState: AppState,
  id: string,
  opacity = 45,
): ExcalidrawFreeDrawElement {
  const x = points[0].x;
  const y = points[0].y;
  const base = commonProps(appState, "freedraw", x, y, 0, 0);
  return {
    ...base,
    // 用 STROKE_WIDTH 的真实值（而非 FREEDRAW_STROKE_WIDTH 的一半），
    // 让绘制中的浅色轨迹预览与松手后实际生成的形状线粗细完全一致。
    strokeWidth: getStrokeWidthByKey("line", appState.currentItemStrokeWidthKey),
    id,
    type: "freedraw",
    points: points.map(
      (p) => [p.x - x, p.y - y] as LocalPointTuple,
    ),
    pressures: points.map(() => 0.5),
    simulatePressure: false,
    strokeOptions: { variability: "variable", streamline: 0.5 },
    opacity,
  } as unknown as ExcalidrawFreeDrawElement;
}
