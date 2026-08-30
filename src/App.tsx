import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
  loadFromBlob,
  THEME,
  CaptureUpdateAction,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFileData,
  BinaryFiles,
  ActiveTool,
  PointerDownState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import Toolbar from "./components/Toolbar";
import StylePanel, {
  type DrawStyle,
  type FillStyle,
  type StrokeStyle,
  type StrokeWidthKey,
  type Roughness,
} from "./components/StylePanel";
import { buildShapeElement, buildPreviewPolyline } from "./lib/buildShapeElement";
import {
  PEN_PRESETS,
  buildFreedrawElement,
  buildHighlighterStrokeElement,
  randomPenId,
  scalePenPreset,
  isDefaultInk,
  type PenType,
} from "./lib/pens";
import { installGrainElementRenderer } from "./lib/grainElementRenderer";
import type { Point } from "./lib/shapeRecognition";
import "./App.css";

// 注册场景内颗粒渲染钩子（必须在 Excalidraw 渲染前完成）
installGrainElementRenderer();

const STORAGE_KEY = "painter:scene:v1";
const SMART_SHAPE_TOOL = "smart-shape";
const PEN_TOOL = "pen-brush";

/** 判断工具是否为智能画笔（自研自定义工具） */
function isSmartShapeTool(tool: ActiveTool): boolean {
  return tool.type === "custom" && tool.customType === SMART_SHAPE_TOOL;
}

/** 判断工具是否为自研多笔刷 */
function isPenTool(tool: ActiveTool): boolean {
  return tool.type === "custom" && tool.customType === PEN_TOOL;
}

/** 是否走自研颗粒渲染的笔（铅笔 / 蜡笔） */
function isGrainPen(pen: PenType | null): boolean {
  return pen === "pencil" || pen === "crayon";
}

/**
 * 每支笔的画布光标（SVG data-URI）。
 * 默认 crosshair 字形热点由系统决定、对粗笔只是一根细十字，看不出落在笔宽中间；
 * 这里用热点精确居中（17,17）的十字 +（粗笔）表示笔宽的圆，保证十字处于笔宽正中。
 */
function penCursor(pen: PenType | null): string {
  if (!pen) return "crosshair";
  // 近似笔半径（CSS px，仅用于光标可视化，不随画布缩放变化）
  const radius: Record<PenType, number> = {
    ballpoint: 2,
    fountain: 6,
    pencil: 6,
    crayon: 9,
    highlighter: 8,
  };
  const r = radius[pen];
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'>` +
    `<g stroke='white' stroke-width='3.2' stroke-linecap='round'>` +
    `<line x1='17' y1='1' x2='17' y2='13'/><line x1='17' y1='21' x2='17' y2='33'/>` +
    `<line x1='1' y1='17' x2='13' y2='17'/><line x1='21' y1='17' x2='33' y2='17'/>` +
    `</g>` +
    `<g stroke='black' stroke-width='1.6' stroke-linecap='round'>` +
    `<line x1='17' y1='1' x2='17' y2='13'/><line x1='17' y1='21' x2='17' y2='33'/>` +
    `<line x1='1' y1='17' x2='13' y2='17'/><line x1='21' y1='17' x2='33' y2='17'/>` +
    `</g>` +
    `<circle cx='17' cy='17' r='${r}' fill='none' stroke='black' stroke-width='1.4' opacity='0.55'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 17 17, crosshair`;
}

const DEFAULT_DRAW_STYLE: DrawStyle = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "hachure",
  strokeWidthKey: "medium",
  strokeStyle: "solid",
  roughness: 1,
  roundness: "sharp", // 默认为直角风格
};

/** 触发浏览器下载 */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 把键盘焦点交还给画板。
 * 点过工具栏按钮后焦点还留在按钮上，此时按 Ctrl+Z 不会送进 Excalidraw。
 */
function refocusCanvas() {
  document.querySelector<HTMLElement>(".excalidraw")?.focus();
}

/** 时间戳文件名 */
function stamp(prefix: string, ext: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}-${ts}.${ext}`;
}

export default function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialData, setInitialData] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const drawStyleRef = useRef<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [styleReady, setStyleReady] = useState(false);
  const [smartShapeActive, setSmartShapeActive] = useState(false);
  const [activePen, setActivePen] = useState<PenType | null>(null);
  const activePenRef = useRef<PenType | null>(null);
  // 更多画笔的笔尖粗细档位（与智能画笔的 strokeWidthKey 相互独立）
  const [penWidthKey, setPenWidthKey] = useState<StrokeWidthKey>("medium");
  const penWidthRef = useRef<StrokeWidthKey>("medium");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const smartShapePointsRef = useRef<Point[]>([]);
  const smartShapeDrawingRef = useRef(false);
  const smartShapePreviewRef = useRef<ExcalidrawElement | null>(null);
  const smartShapePendingPointsRef = useRef<Point[]>([]);
  const smartShapeRafRef = useRef<number | null>(null);
  // 多笔刷绘制状态（与智能画笔互斥，共用同一套 pointer 回调）
  const penDrawingRef = useRef(false);
  const penPointsRef = useRef<Point[]>([]);
  const penPendingPointsRef = useRef<Point[]>([]);
  const penPreviewRef = useRef<ExcalidrawElement | null>(null);
  const penRafRef = useRef<number | null>(null);
  // 铅笔 / 蜡笔笔画种子：预览与最终元素共用，保证颗粒一致
  const penSeedRef = useRef<number>(0);

  // 读取本地自动保存的场景
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setInitialData(JSON.parse(raw));
    } catch {
      /* 忽略损坏的本地数据 */
    }
  }, []);

  // 自动保存到 localStorage(防抖)
  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      // 用户在 Excalidraw 原生工具栏选了别的工具 → 自动退出自研模式，保持互斥
      if (smartShapeActive && !isSmartShapeTool(appState.activeTool)) {
        setSmartShapeActive(false);
      }
      if (activePenRef.current && !isPenTool(appState.activeTool)) {
        activePenRef.current = null;
        setActivePen(null);
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          const json = serializeAsJSON(elements, appState, files, "local");
          localStorage.setItem(STORAGE_KEY, json);
        } catch {
          /* 忽略写入错误 */
        }
      }, 600);
    },
    [smartShapeActive],
  );

  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    excalidrawAPI?.setToast({ message, closable: true } as never);
    // 失败时用 console 兜底
    if (type === "error") console.error(message);
  }, [excalidrawAPI]);

  // 新建空白画布
  const handleNew = useCallback(() => {
    if (!excalidrawAPI) return;
    // IMMEDIATELY：整场景替换必须进 undo 栈，否则一键就把内容全毁了且撤不回来
    excalidrawAPI.updateScene({
      elements: [],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    refocusCanvas();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
    toast("已新建空白画布");
  }, [excalidrawAPI, toast]);

  // 打开 .excalidraw 文件
  const handleOpen = useCallback(
    async (file: File) => {
      if (!excalidrawAPI) return;
      try {
        const data = await loadFromBlob(
          file,
          excalidrawAPI.getAppState(),
          excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[],
        );
        // 图片等二进制资源不走 updateScene（SceneData 没有 files 字段），
        // 必须单独 addFiles，否则图片元素在但数据不在，打开后图片是空白。
        const files = Object.values(data.files ?? {}) as BinaryFileData[];
        if (files.length) {
          excalidrawAPI.addFiles(files);
        }
        excalidrawAPI.updateScene({
          elements: data.elements,
          appState: data.appState,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        refocusCanvas();
        const api = excalidrawAPI as any;
        if (typeof api.scrollToContent === "function") {
          api.scrollToContent(undefined, { fitToContent: true, animate: true });
        }
        toast(`已打开 ${file.name}`);
      } catch (err) {
        console.error(err);
        toast("打开失败,请确认文件格式", "error");
      }
    },
    [excalidrawAPI, toast],
  );

  // 保存为 .excalidraw 文件
  const handleSave = useCallback(async () => {
    if (!excalidrawAPI) return;
    setSaving(true);
    try {
      const json = serializeAsJSON(
        excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[],
        excalidrawAPI.getAppState(),
        excalidrawAPI.getFiles(),
        "local",
      );
      const blob = new Blob([json], { type: "application/json" });
      download(blob, stamp("painter", "excalidraw"));
      toast("已保存为 .excalidraw 文件");
    } catch (err) {
      console.error(err);
      toast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  }, [excalidrawAPI, toast]);

  // 导出 PNG
  const handleExportPng = useCallback(async () => {
    if (!excalidrawAPI) return;
    try {
      const blob = await exportToBlob({
        elements: excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[],
        appState: {
          ...excalidrawAPI.getAppState(),
          exportBackground: true,
          exportEmbedScene: false,
        },
        files: excalidrawAPI.getFiles(),
        mimeType: "image/png",
      });
      download(blob, stamp("painter", "png"));
      toast("已导出 PNG");
    } catch (err) {
      console.error(err);
      toast("导出 PNG 失败", "error");
    }
  }, [excalidrawAPI, toast]);

  // 导出 SVG
  const handleExportSvg = useCallback(async () => {
    if (!excalidrawAPI) return;
    try {
      const svg = await exportToSvg({
        elements: excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[],
        appState: {
          ...excalidrawAPI.getAppState(),
          exportBackground: true,
          exportEmbedScene: false,
        },
        files: excalidrawAPI.getFiles(),
      });
      const svgStr = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      download(blob, stamp("painter", "svg"));
      toast("已导出 SVG");
    } catch (err) {
      console.error(err);
      toast("导出 SVG 失败", "error");
    }
  }, [excalidrawAPI, toast]);

  // 清空画布
  const handleClear = useCallback(() => {
    if (!excalidrawAPI) return;
    const ok = window.confirm("确定清空当前画布吗?此操作可通过撤销(Ctrl+Z)恢复。");
    if (!ok) return;
    // 必须带 IMMEDIATELY：不带 captureUpdate 时 updateScene 只发 ephemeral 增量，
    // 不进 undo 栈，Ctrl+Z 撤不回来（确认框里承诺的可恢复就没兑现）。
    excalidrawAPI.updateScene({
      elements: [],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    refocusCanvas();
    toast("已清空画布（Ctrl+Z 可恢复）");
  }, [excalidrawAPI, toast]);

  // 切换主题
  const handleToggleTheme = useCallback(() => setIsDark((v) => !v), []);

  // 从 Excalidraw 当前 appState 同步风格面板初始值（支持 localStorage 恢复）
  useEffect(() => {
    const api = excalidrawAPIRef.current;
    if (!api || !ready || styleReady) return;
    const appState = api.getAppState();
    const pick = <T,>(
      allowed: readonly T[],
      value: unknown,
      fallback: T,
    ): T => (allowed.includes(value as T) ? (value as T) : fallback);
    setDrawStyle({
      strokeColor: (appState.currentItemStrokeColor as string) || DEFAULT_DRAW_STYLE.strokeColor,
      backgroundColor: (appState.currentItemBackgroundColor as string) || DEFAULT_DRAW_STYLE.backgroundColor,
      fillStyle: pick<FillStyle>(["hachure", "cross-hatch", "solid"], appState.currentItemFillStyle, DEFAULT_DRAW_STYLE.fillStyle),
      strokeWidthKey: pick<StrokeWidthKey>(["thin", "medium", "bold"], appState.currentItemStrokeWidthKey, DEFAULT_DRAW_STYLE.strokeWidthKey),
      strokeStyle: pick<StrokeStyle>(["solid", "dashed", "dotted"], appState.currentItemStrokeStyle, DEFAULT_DRAW_STYLE.strokeStyle),
      roughness: pick<Roughness>([0, 1, 2], appState.currentItemRoughness, DEFAULT_DRAW_STYLE.roughness),
      roundness: drawStyleRef.current.roundness, // 从 ref 读取上次保存的 roundness
    });
    setStyleReady(true);
  }, [ready, styleReady]);

  // 风格面板变动时回写 Excalidraw appState
  const handleStyleChange = useCallback((patch: Partial<DrawStyle>) => {
    setDrawStyle((prev) => {
      const next = { ...prev, ...patch };
      // 同步更新 ref，供 handlePointerUp 等回调使用
      drawStyleRef.current = next;
      const api = excalidrawAPIRef.current;
      if (api) {
        // 只传要改的字段：updateScene 是浅合并，整包回写 getAppState()
        // 会把尚未落地的 activeTool 冲掉，导致自定义画笔被退回选择工具。
        api.updateScene({
          appState: {
            currentItemStrokeColor: next.strokeColor as any,
            currentItemBackgroundColor: next.backgroundColor as any,
            currentItemFillStyle: next.fillStyle as any,
            currentItemStrokeWidthKey: next.strokeWidthKey as any,
            currentItemStrokeStyle: next.strokeStyle as any,
            currentItemRoughness: next.roughness as any,
          },
        });
      }
      return next;
    });
  }, []);

  // 画笔面板：颜色走同一套 drawStyle，粗细只影响笔尖缩放，不与智能画笔共享
  const handlePenStyleChange = useCallback(
    (patch: Partial<DrawStyle>) => {
      if (patch.strokeWidthKey !== undefined) {
        penWidthRef.current = patch.strokeWidthKey;
        setPenWidthKey(patch.strokeWidthKey);
      }
      if (patch.strokeColor !== undefined) {
        handleStyleChange({ strokeColor: patch.strokeColor });
      }
    },
    [handleStyleChange],
  );

  // 启用智能画笔：手绘后松手自动识别为形状
  const handleSmartShape = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    // 再次点击 = 退出智能画笔，切回选择工具
    if (smartShapeActive) {
      setSmartShapeActive(false);
      api.setActiveTool({ type: "selection" });
      toast("已退出智能画笔");
      return;
    }
    // 与多笔刷互斥
    activePenRef.current = null;
    setActivePen(null);
    setSmartShapeActive(true);
    api.setActiveTool(
      { type: "custom", customType: SMART_SHAPE_TOOL, locked: true },
    );
    toast("智能画笔已启用：画出三角形、五角星等图形后松手自动识别");
  }, [toast, smartShapeActive]);

  // 退出多笔刷模式
  const handleExitPen = useCallback(() => {
    const api = excalidrawAPIRef.current;
    activePenRef.current = null;
    setActivePen(null);
    api?.setActiveTool({ type: "selection" });
  }, []);

  // 选择某支笔：进入自研绘制模式；再点同一支笔则退出
  const handleSelectPen = useCallback(
    (type: PenType) => {
      const api = excalidrawAPIRef.current;
      if (!api) return;
      if (activePenRef.current === type) {
        handleExitPen();
        return;
      }
      const preset = PEN_PRESETS[type];
      // 与智能画笔互斥
      setSmartShapeActive(false);
      activePenRef.current = type;
      setActivePen(type);
      api.setActiveTool({ type: "custom", customType: PEN_TOOL, locked: true });

      // 荧光笔这类笔在默认墨色下看不出效果，自动换成推荐色
      const appState = api.getAppState();
      let colorChanged = false;
      if (preset.suggestColor && isDefaultInk(appState.currentItemStrokeColor)) {
        // 注意：updateScene 的 appState 是浅合并进 Excalidraw state 的，
        // 这里只能传要改的字段。若把 getAppState() 整包回写，
        // 会把上面 setActiveTool 尚未落地的 activeTool 冲掉（自定义工具退回选择工具）。
        api.updateScene({
          appState: { currentItemStrokeColor: preset.suggestColor },
        });
        colorChanged = true;
        // 面板色卡要跟着推荐色走，否则面板显示的和真正画出来的不是同一个颜色
        setDrawStyle((prev) => {
          const next = { ...prev, strokeColor: preset.suggestColor! };
          drawStyleRef.current = next;
          return next;
        });
      }
      toast(
        `已切换到${preset.name}${colorChanged ? "（并自动换成推荐色）" : ""}：在画布上直接书写`,
      );
    },
    [toast, handleExitPen],
  );

  // Shift+X 激活智能画笔
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "X" || e.key === "x")) {
        e.preventDefault();
        handleSmartShape();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSmartShape]);

  // 自研智能画笔：完全自己采集轨迹，不经过 Excalidraw 的 freedraw/autoshape
  const handlePointerDown = useCallback(
    (activeTool: ActiveTool, pointerDownState: PointerDownState) => {
      if (
        activeTool.type === "custom" &&
        activeTool.customType === SMART_SHAPE_TOOL
      ) {
        smartShapeDrawingRef.current = true;
        const points = [
          { x: pointerDownState.origin.x, y: pointerDownState.origin.y },
        ];
        smartShapePointsRef.current = points;
        smartShapePendingPointsRef.current = points;
        const api = excalidrawAPIRef.current;
        if (api) {
          const previewId = `smart-preview-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          const preview = buildPreviewPolyline(
            points,
            api.getAppState(),
            previewId,
          );
          smartShapePreviewRef.current = preview;
          const elements = api.getSceneElements();
          api.updateScene({
            elements: [...elements, preview],
            captureUpdate: CaptureUpdateAction.EVENTUALLY,
          });
        }
      }

      // 多笔刷：自己采集轨迹并实时预览笔触
      // 荧光笔直接用平头轮廓元素预览（预览即最终效果），其余笔走 freedraw
      if (isPenTool(activeTool) && activePenRef.current) {
        const pen = scalePenPreset(
          PEN_PRESETS[activePenRef.current],
          penWidthRef.current,
        );
        penDrawingRef.current = true;
        const points = [
          { x: pointerDownState.origin.x, y: pointerDownState.origin.y },
        ];
        penPointsRef.current = points;
        penPendingPointsRef.current = points;
        const api = excalidrawAPIRef.current;
        if (api) {
          if (isGrainPen(activePenRef.current)) {
            penSeedRef.current = Math.floor(Math.random() * 2 ** 31);
          }
          const customData = isGrainPen(activePenRef.current)
            ? { grainKind: activePenRef.current, grainSeed: penSeedRef.current }
            : undefined;
          const preview =
            activePenRef.current === "highlighter"
              ? buildHighlighterStrokeElement(
                  points,
                  api.getAppState(),
                  pen,
                  randomPenId(),
                )
              : buildFreedrawElement(
                  points,
                  api.getAppState(),
                  pen,
                  randomPenId(),
                  undefined,
                  customData,
                );
          penPreviewRef.current = preview;
          if (preview) {
            api.updateScene({
              elements: [...api.getSceneElements(), preview],
              captureUpdate: CaptureUpdateAction.EVENTUALLY,
            });
          }
        }
      }
    },
    [],
  );

  const handlePointerUpdate = useCallback(
    (payload: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "down" | "up";
    }) => {
      if (smartShapeDrawingRef.current && payload.button === "down") {
        smartShapePointsRef.current.push({
          x: payload.pointer.x,
          y: payload.pointer.y,
        });
        smartShapePendingPointsRef.current = smartShapePointsRef.current;
        if (smartShapeRafRef.current == null) {
          smartShapeRafRef.current = requestAnimationFrame(() => {
            smartShapeRafRef.current = null;
            const api = excalidrawAPIRef.current;
            const preview = smartShapePreviewRef.current;
            if (!api || !preview) return;
            const next = buildPreviewPolyline(
              smartShapePendingPointsRef.current,
              api.getAppState(),
              preview.id,
            );
            smartShapePreviewRef.current = next;
            const elements = api.getSceneElements();
            api.updateScene({
              elements: [
                ...elements.filter((el) => el.id !== next.id),
                next,
              ],
              captureUpdate: CaptureUpdateAction.EVENTUALLY,
            });
          });
        }
      }

      // 多笔刷：追加采样点并节流重建预览
      if (penDrawingRef.current && payload.button === "down" && activePenRef.current) {
        penPointsRef.current.push({ x: payload.pointer.x, y: payload.pointer.y });
        penPendingPointsRef.current = penPointsRef.current;
        if (penRafRef.current == null) {
          penRafRef.current = requestAnimationFrame(() => {
            penRafRef.current = null;
            const api = excalidrawAPIRef.current;
            const preview = penPreviewRef.current;
            const pen = activePenRef.current;
            if (!api || !preview || !pen) return;
            const penPreset = scalePenPreset(PEN_PRESETS[pen], penWidthRef.current);
            const next =
              pen === "highlighter"
                ? buildHighlighterStrokeElement(
                    penPendingPointsRef.current,
                    api.getAppState(),
                    penPreset,
                    preview.id,
                  )
                : buildFreedrawElement(
                    penPendingPointsRef.current,
                    api.getAppState(),
                    penPreset,
                    preview.id,
                    undefined,
                    isGrainPen(pen)
                      ? {
                          grainKind: pen,
                          grainSeed: penSeedRef.current,
                        }
                      : undefined,
                  );
            if (!next) return;
            penPreviewRef.current = next;
            api.updateScene({
              elements: [
                ...api.getSceneElements().filter((el) => el.id !== next.id),
                next,
              ],
              captureUpdate: CaptureUpdateAction.EVENTUALLY,
            });
          });
        }
      }
    },
    [],
  );

  const handlePointerUp = useCallback(
    (activeTool: ActiveTool) => {
      if (
        !smartShapeDrawingRef.current ||
        activeTool.type !== "custom" ||
        activeTool.customType !== SMART_SHAPE_TOOL
      ) {
        return;
      }
      smartShapeDrawingRef.current = false;
      if (smartShapeRafRef.current != null) {
        cancelAnimationFrame(smartShapeRafRef.current);
        smartShapeRafRef.current = null;
      }
      const points = smartShapePointsRef.current;
      const api = excalidrawAPIRef.current;
      const preview = smartShapePreviewRef.current;
      if (!api) return;

      if (points.length < 3) {
        if (preview) {
          api.updateScene({
            elements: api
              .getSceneElements()
              .filter((el) => el.id !== preview.id),
            captureUpdate: CaptureUpdateAction.EVENTUALLY,
          });
        }
        return;
      }

      const shape = buildShapeElement(points, api.getAppState(), drawStyleRef.current.roundness);
      const elements = api.getSceneElements();
      const withoutPreview = preview
        ? elements.filter((el) => el.id !== preview.id)
        : elements;
      if (!shape) {
        // 识别失败：不生成任何元素，只移除预览轨迹
        api.updateScene({
          elements: withoutPreview,
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
        });
        return;
      }
      api.updateScene({
        elements: [...withoutPreview, shape],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      smartShapePreviewRef.current = null;
    },
    [],
  );

  // 多笔刷：松手时把整条轨迹固化成 freedraw 元素
  const handlePenPointerUp = useCallback(() => {
    if (!penDrawingRef.current) return;
    penDrawingRef.current = false;
    if (penRafRef.current != null) {
      cancelAnimationFrame(penRafRef.current);
      penRafRef.current = null;
    }
    const points = penPointsRef.current;
    const api = excalidrawAPIRef.current;
    const preview = penPreviewRef.current;
    const pen = activePenRef.current;
    if (!api) return;

    const withoutPreview = preview
      ? api.getSceneElements().filter((el) => el.id !== preview.id)
      : api.getSceneElements();

    if (!pen || points.length === 0) {
      api.updateScene({
        elements: withoutPreview,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
      penPreviewRef.current = null;
      return;
    }

    // 荧光笔：平头轮廓元素（预览阶段已是同构元素，这里重建最终轮廓收尾）；
    // 其余笔：整条轨迹固化成 freedraw 元素
    const preset = scalePenPreset(PEN_PRESETS[pen], penWidthRef.current);
    const baseElement =
      pen === "highlighter"
        ? buildHighlighterStrokeElement(
            points,
            api.getAppState(),
            preset,
            randomPenId(),
          )
        : buildFreedrawElement(points, api.getAppState(), preset, randomPenId());
    if (!baseElement) {
      api.updateScene({
        elements: withoutPreview,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
      penPreviewRef.current = null;
      return;
    }
    const finalElement = isGrainPen(pen)
      ? {
          ...baseElement,
          customData: {
            grainKind: pen,
            grainSeed: penSeedRef.current,
          },
        }
      : baseElement;
    api.updateScene({
      elements: [...withoutPreview, finalElement],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    penPreviewRef.current = null;
  }, []);

  // 统一的 pointerUp：先处理多笔刷，再处理智能画笔
  const handlePointerUpCombined = useCallback(
    (activeTool: ActiveTool) => {
      handlePenPointerUp();
      handlePointerUp(activeTool);
    },
    [handlePenPointerUp, handlePointerUp],
  );

  const actions = useMemo(
    () => ({
      onNew: handleNew,
      onOpen: handleOpen,
      onSave: handleSave,
      onExportPng: handleExportPng,
      onExportSvg: handleExportSvg,
      onClear: handleClear,
      onToggleTheme: handleToggleTheme,
      onSmartShape: handleSmartShape,
      smartShapeActive,
      onSelectPen: handleSelectPen,
      activePen,
      isDark,
    }),
    [handleNew, handleOpen, handleSave, handleExportPng, handleExportSvg, handleClear, handleToggleTheme, handleSmartShape, smartShapeActive, handleSelectPen, activePen, isDark],
  );

  // 把属性面板挂到项目自有的 .workspace 容器（绝对定位浮层），
  // 视觉上与原生 Draw to shape 面板同位置同风格。
  // 为什么不挂进 .App-menu_top__left：Excalidraw 的画布在该容器之上
  // 拦截 pointer-events，会让面板"看得见点不到"。
  const panelHost = useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.querySelector(".workspace") ?? document.body;
  }, [ready, activePen, smartShapeActive]);

  return (
    <div
      className={`app${smartShapeActive ? " smart-shape-active" : ""}${
        activePen ? " pen-active" : ""
      }`}
      data-theme={isDark ? "dark" : "light"}
      style={{ "--pen-cursor": penCursor(activePen) } as React.CSSProperties}
    >
      <Toolbar {...actions} saving={saving} />
      <div className="workspace">
        {(smartShapeActive || activePen) &&
          panelHost &&
          createPortal(
            <StylePanel
              mode={activePen ? "pen" : "shape"}
              style={
                activePen ? { ...drawStyle, strokeWidthKey: penWidthKey } : drawStyle
              }
              onChange={activePen ? handlePenStyleChange : handleStyleChange}
              isDark={isDark}
              penType={activePen}
              onPenTypeChange={handleSelectPen}
              nativeHost={false}
            />,
            panelHost,
          )}
        <main className="canvas-wrap">
          {!ready && (
            <div className="loading">
              <span className="spinner" />
              画板加载中…
            </div>
          )}
          <Excalidraw
          onExcalidrawAPI={(api) => {
            excalidrawAPIRef.current = api;
            setExcalidrawAPI(api);
            setReady(true);
          }}
          initialData={initialData}
          onChange={handleChange}
          onPointerDown={handlePointerDown}
          onPointerUpdate={handlePointerUpdate}
          onPointerUp={handlePointerUpCombined}
          theme={isDark ? THEME.DARK : THEME.LIGHT}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: { saveFileToDisk: true },
              toggleTheme: false,
            },
            tools: {
              // 图片工具默认已启用,无需额外配置
              image: true,
            },
          }}
          langCode="zh-CN"
        />
      </main>
    </div>
  </div>
  );
}
