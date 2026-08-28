import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  BinaryFiles,
  ActiveTool,
  PointerDownState,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
} from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import Toolbar from "./components/Toolbar";
import StylePanel, {
  type DrawStyle,
  type StrokeStyle,
  type StrokeWidthKey,
  type Roughness,
} from "./components/StylePanel";
import { buildShapeElement, buildFreedrawPreview } from "./lib/buildShapeElement";
import type { Point } from "./lib/shapeRecognition";
import "./App.css";

const STORAGE_KEY = "painter:scene:v1";
const SMART_SHAPE_TOOL = "smart-shape";

const DEFAULT_DRAW_STYLE: DrawStyle = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  strokeWidthKey: "regular",
  strokeStyle: "solid",
  roughness: 1,
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
  const [styleReady, setStyleReady] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const smartShapePointsRef = useRef<Point[]>([]);
  const smartShapeDrawingRef = useRef(false);
  const smartShapePreviewRef = useRef<ExcalidrawFreeDrawElement | null>(null);
  const smartShapePendingPointsRef = useRef<Point[]>([]);
  const smartShapeRafRef = useRef<number | null>(null);

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
    [],
  );

  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    excalidrawAPI?.setToast({ message, closable: true } as never);
    // 失败时用 console 兜底
    if (type === "error") console.error(message);
  }, [excalidrawAPI]);

  // 新建空白画布
  const handleNew = useCallback(() => {
    if (!excalidrawAPI) return;
    excalidrawAPI.updateScene({ elements: [] });
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
        excalidrawAPI.updateScene({
          elements: data.elements,
          appState: data.appState,
        });
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
    excalidrawAPI.updateScene({ elements: [] });
    toast("已清空画布");
  }, [excalidrawAPI, toast]);

  // 切换主题
  const handleToggleTheme = useCallback(() => setIsDark((v) => !v), []);

  // 从 Excalidraw 当前 appState 同步风格面板初始值（支持 localStorage 恢复）
  useEffect(() => {
    const api = excalidrawAPIRef.current;
    if (!api || !ready || styleReady) return;
    const appState = api.getAppState();
    setDrawStyle({
      strokeColor: (appState.currentItemStrokeColor as string) || DEFAULT_DRAW_STYLE.strokeColor,
      backgroundColor: (appState.currentItemBackgroundColor as string) || DEFAULT_DRAW_STYLE.backgroundColor,
      strokeWidthKey:
        ((appState.currentItemStrokeWidthKey as string) as StrokeWidthKey) ||
        DEFAULT_DRAW_STYLE.strokeWidthKey,
      strokeStyle:
        ((appState.currentItemStrokeStyle as string) as StrokeStyle) ||
        DEFAULT_DRAW_STYLE.strokeStyle,
      roughness:
        (Number(appState.currentItemRoughness) as Roughness) ??
        DEFAULT_DRAW_STYLE.roughness,
    });
    setStyleReady(true);
  }, [ready, styleReady]);

  // 风格面板变动时回写 Excalidraw appState
  const handleStyleChange = useCallback((patch: Partial<DrawStyle>) => {
    setDrawStyle((prev) => {
      const next = { ...prev, ...patch };
      const api = excalidrawAPIRef.current;
      if (api) {
        api.updateScene({
          appState: {
            ...api.getAppState(),
            currentItemStrokeColor: next.strokeColor as any,
            currentItemBackgroundColor: next.backgroundColor as any,
            currentItemStrokeWidthKey: next.strokeWidthKey as any,
            currentItemStrokeStyle: next.strokeStyle as any,
            currentItemRoughness: next.roughness as any,
          },
        });
      }
      return next;
    });
  }, []);

  // 启用智能画笔：手绘后松手自动识别为形状
  const handleSmartShape = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    api.setActiveTool(
      { type: "custom", customType: SMART_SHAPE_TOOL, locked: true },
    );
    toast("智能画笔已启用：画出三角形、五角星等图形后松手自动识别");
  }, [toast]);

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
          const preview = buildFreedrawPreview(
            points,
            api.getAppState(),
            previewId,
          );
          smartShapePreviewRef.current = preview;
          const elements = api.getSceneElements();
          api.updateScene({
            elements: [...elements, preview],
            captureUpdate: CaptureUpdateAction.NEVER,
          });
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
            const next = buildFreedrawPreview(
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
              captureUpdate: CaptureUpdateAction.NEVER,
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
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        }
        return;
      }

      const shape = buildShapeElement(points, api.getAppState());
      const elements = api.getSceneElements();
      const withoutPreview = preview
        ? elements.filter((el) => el.id !== preview.id)
        : elements;
      if (!shape) {
        // 识别失败：不生成任何元素，只移除预览轨迹
        api.updateScene({
          elements: withoutPreview,
          captureUpdate: CaptureUpdateAction.NEVER,
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
      isDark,
    }),
    [handleNew, handleOpen, handleSave, handleExportPng, handleExportSvg, handleClear, handleToggleTheme, handleSmartShape, isDark],
  );

  return (
    <div className="app" data-theme={isDark ? "dark" : "light"}>
      <Toolbar {...actions} saving={saving} />
      <div className="workspace">
        <StylePanel style={drawStyle} onChange={handleStyleChange} />
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
          onPointerUp={handlePointerUp}
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
