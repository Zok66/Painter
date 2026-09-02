import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Excalidraw,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
  loadFromBlob,
  restoreElements,
  THEME,
  CaptureUpdateAction,
  MainMenu,
  languages,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFileData,
  BinaryFiles,
  ActiveTool,
  PointerDownState,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
  Theme,
} from "@excalidraw/excalidraw/element/types";
import type { GlobalPoint } from "@excalidraw/math";
import { computeBucketFillPolygon } from "@excalidraw/element";
import "@excalidraw/excalidraw/index.css";
import Toolbar from "./components/Toolbar";
import StylePanel, {
  type DrawStyle,
  type FillStyle,
  type StrokeStyle,
  type StrokeWidthKey,
  type Roughness,
} from "./components/StylePanel";
import FillStyleBar from "./components/FillStyleBar";
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
import {
  buildFillElements,
  hitFillGroup,
  restyleFillGroup,
  type FillKind,
} from "./lib/fillStrokes";
import { installGrainElementRenderer } from "./lib/grainElementRenderer";
import {
  installPaperTextureRenderer,
  setPaperDark,
  setPaperTemplate,
} from "./lib/paperTexture";
import {
  activePage,
  createNotebook,
  createPage,
  deletePageScene,
  findPage,
  loadNotebookState,
  loadPageScene,
  saveNotebookState,
  savePageScene,
  PAPER_LABELS,
  type NotebookState,
  type PaperTemplate,
} from "./lib/notebook";
import NotebookPanel from "./components/NotebookPanel";
import ExportSvgDialog from "./components/ExportSvgDialog";
import type { Point } from "./lib/shapeRecognition";
import { installPainterTextFormat, painterMeasureText } from "./lib/textFormat";
import type { TextDirection, TextFormatCustomData } from "./lib/textFormat";
import TextFormatControls from "./components/TextFormatControls";
import "./App.css";
import "./nativeColorPatch";

// 注册场景内渲染钩子（必须在 Excalidraw 渲染前完成）
installGrainElementRenderer();
installPaperTextureRenderer();
installPainterTextFormat();
const SMART_SHAPE_TOOL = "smart-shape";
const PEN_TOOL = "pen-brush";
const FILL_TOOL = "fill-bucket";
const FILL_KIND_KEY = "painter-fill-kind-v1";

const FILL_KINDS: FillKind[] = [
  "solid",
  "ballpoint",
  "fountain",
  "pencil",
  "crayon",
  "highlighter",
];

/** 判断工具是否为智能画笔（自研自定义工具） */
function isSmartShapeTool(tool: ActiveTool): boolean {
  return tool.type === "custom" && tool.customType === SMART_SHAPE_TOOL;
}

/** 判断工具是否为自研多笔刷 */
function isPenTool(tool: ActiveTool): boolean {
  return tool.type === "custom" && tool.customType === PEN_TOOL;
}

/** 判断工具是否为自研油漆桶（笔迹填充） */
function isFillTool(tool: ActiveTool): boolean {
  return tool.type === "custom" && tool.customType === FILL_TOOL;
}

/** 从 localStorage 恢复填充风格选择 */
function loadFillKind(): FillKind {
  try {
    const raw = localStorage.getItem(FILL_KIND_KEY);
    if (raw && FILL_KINDS.includes(raw as FillKind)) return raw as FillKind;
  } catch {
    /* 忽略 */
  }
  return "solid";
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
  // 主题：三态（light/dark/system）。Excalidraw 的 Excalidraw 组件 theme prop 只接
  // "light"|"dark"，"system" 是宿主层标记，需要自己用 matchMedia 解析为 realTheme 再喂回去。
  type ThemeMode = Theme | "system";
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  // 监听系统主题变化（仅 system 模式下生效）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // 派生真实主题：system 模式按系统偏好解析，其它模式直接用
  const realTheme: Theme =
    themeMode === "system"
      ? (systemPrefersDark ? THEME.DARK : THEME.LIGHT)
      : themeMode;
  const isDark = realTheme === THEME.DARK;
  // 语言：库内置 languages 数组（>=85% 完成度的约 42 种，按 label 字母排序）；
  // 改 langCode 会触发 Excalidraw.updateLanguage() 自动加载对应 locales/<code>.json
  const [langCode, setLangCode] = useState<string>("zh-CN");
  const [saving, setSaving] = useState(false);
  // 导出 SVG 前的背景选择弹窗：开关 + 供预览的当前画布背景色
  const [svgDialogOpen, setSvgDialogOpen] = useState(false);
  const [svgBgColor, setSvgBgColor] = useState("#ffffff");
  const [initialData, setInitialData] = useState<any>(null);
  const [ready, setReady] = useState(false);
  // 笔记本：索引 + 每页场景。ref 与 state 同步，供防抖保存 / 切页时取当前页
  const [notebookState, setNotebookState] = useState<NotebookState>(loadNotebookState);
  const notebookStateRef = useRef<NotebookState>(notebookState);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [newPageTemplate, setNewPageTemplate] = useState<PaperTemplate>("blank");
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const drawStyleRef = useRef<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [styleReady, setStyleReady] = useState(false);
  const [smartShapeActive, setSmartShapeActive] = useState(false);
  const [activePen, setActivePen] = useState<PenType | null>(null);
  const activePenRef = useRef<PenType | null>(null);
  // 油漆桶（笔迹填充）：激活状态 + 填充风格（localStorage 持久化）
  const [fillActive, setFillActive] = useState(false);
  const [fillKind, setFillKind] = useState<FillKind>(loadFillKind);
  // 更多画笔的笔尖粗细档位（与智能画笔的 strokeWidthKey 相互独立）
  const [penWidthKey, setPenWidthKey] = useState<StrokeWidthKey>("medium");
  const penWidthRef = useRef<StrokeWidthKey>("medium");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 文字格式化：选中单个文字元素时记录其格式，供原生面板内的控件读写
  const [textFormat, setTextFormat] = useState<{
    id: string;
    textDirection: TextDirection;
    lineHeight: number;
    letterSpacing: number;
  } | null>(null);
  // 注入原生文字面板（.selected-shape-actions-container）的宿主节点
  const textFormatHostRef = useRef<HTMLDivElement | null>(null);
  if (textFormatHostRef.current === null && typeof document !== "undefined") {
    const el = document.createElement("div");
    el.className = "painter-text-format";
    textFormatHostRef.current = el;
  }
  const lastTextFmtRef = useRef<string>("");
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

  // 启动时载入上次打开的页面（首次进入会顺带把旧版单场景迁成第一页）
  useEffect(() => {
    const state = notebookStateRef.current;
    const scene = loadPageScene(state.activePageId);
    if (scene) setInitialData(scene);
    setPaperTemplate(activePage(state).template);
  }, []);

  // 文字格式化：把控件宿主挂进原生文字面板容器（.selected-shape-actions-container），
  // 与原生字体/字号/对齐共处同一面板。用 MutationObserver 应对面板延迟渲染、
  // 或 Excalidraw 重渲染时容器节点被替换的情况。
  useEffect(() => {
    const host = textFormatHostRef.current;
    if (!host) return;
    if (!textFormat) {
      if (host.parentNode) host.parentNode.removeChild(host);
      return;
    }
    // 把宿主挂到原生字号 fieldset 之后、文本对齐 fieldset 之前，
    // 让文字方向 / 行距 / 字体间距在原生面板里保持「字号 → 自研 → 对齐」的阅读顺序。
    // 锚点选字号（data-testid="fontSize-small"），找不到再退回到容器末尾。
    const tryAppend = () => {
      const container = document.querySelector(
        ".selected-shape-actions:not(.zen-mode-transition)",
      );
      if (!container) return;
      const fontSizeFieldset = container.querySelector(
        'input[data-testid="fontSize-small"]',
      )?.closest("fieldset");
      // 期望位置：fontSizeFieldset 之后。判定方式是 fontSizeFieldset.nextSibling === host。
      const inCorrectSpot =
        fontSizeFieldset && fontSizeFieldset.nextSibling === host;
      if (inCorrectSpot) return;
      if (fontSizeFieldset) {
        if (host.parentNode) host.parentNode.removeChild(host);
        fontSizeFieldset.parentNode.insertBefore(
          host,
          fontSizeFieldset.nextSibling,
        );
      } else {
        // 退路：原生面板还没渲染出字号锚点（用户可能正在切换选中元素），先附加到容器末尾
        if (host.parentNode !== container) {
          container.appendChild(host);
        }
      }
    };
    tryAppend();
    const observer = new MutationObserver(() => tryAppend());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (host.parentNode) host.parentNode.removeChild(host);
    };
  }, [textFormat !== null, ready]);

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
      if (fillActive && !isFillTool(appState.activeTool)) {
        setFillActive(false);
      }
      // 文字格式化：检测是否选中单个文字元素，更新面板状态（用签名去重，避免每次变更都重渲染）
      {
        const selIds = Object.keys(appState.selectedElementIds || {});
        let next: {
          id: string;
          textDirection: TextDirection;
          lineHeight: number;
          letterSpacing: number;
        } | null = null;
        if (selIds.length === 1) {
          const el = elements.find((e) => e.id === selIds[0]);
          if (el && el.type === "text") {
            const cd = (el as unknown as { customData?: TextFormatCustomData })
              .customData;
            next = {
              id: el.id,
              textDirection: (cd?.textDirection as TextDirection) || "horizontal",
              lineHeight:
                (el as unknown as { lineHeight?: number }).lineHeight ?? 1.25,
              letterSpacing: cd?.letterSpacing ?? 0,
            };
          }
        }
        const sig = next ? JSON.stringify(next) : "null";
        if (sig !== lastTextFmtRef.current) {
          lastTextFmtRef.current = sig;
          setTextFormat(next);
        }
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        try {
          const json = serializeAsJSON(elements, appState, files, "local");
          savePageScene(notebookStateRef.current.activePageId, json);
        } catch {
          /* 忽略写入错误 */
        }
      }, 600);
    },
    [smartShapeActive, fillActive],
  );

  /** 应用文字格式化变更：合并 customData + lineHeight，重算包围盒后写回场景 */
  const applyTextFormat = useCallback(
    (patch: {
      textDirection?: TextDirection;
      lineHeight?: number;
      letterSpacing?: number;
    }) => {
      const api = excalidrawAPIRef.current;
      const targetId = textFormat?.id;
      if (!api || !targetId) return;
      const elements = api.getSceneElements() as ExcalidrawElement[];
      const idx = elements.findIndex((e) => e.id === targetId);
      if (idx < 0) return;
      const prev = elements[idx] as ExcalidrawElement & {
        customData?: TextFormatCustomData;
        lineHeight?: number;
        text?: string;
        fontSize?: number;
        fontFamily?: number;
      };
      const nextCd: TextFormatCustomData = {
        ...(prev.customData ?? {}),
        ...(patch.textDirection !== undefined
          ? { textDirection: patch.textDirection }
          : {}),
        ...(patch.letterSpacing !== undefined
          ? { letterSpacing: patch.letterSpacing }
          : {}),
      };
      const nextLineHeight = patch.lineHeight ?? prev.lineHeight ?? 1.25;
      const nextEl = {
        ...prev,
        lineHeight: nextLineHeight,
        customData: nextCd,
      } as ExcalidrawElement;
      // 重算包围盒（竖排 / 字距会改变宽高，保证选中框与导出尺寸精确）
      const measured = painterMeasureText({
        text: prev.text ?? "",
        fontSize: prev.fontSize ?? 16,
        lineHeight: nextLineHeight,
        fontFamily: prev.fontFamily ?? 1,
        customData: nextCd,
      });
      (nextEl as unknown as { width: number; height: number }).width =
        measured.width;
      (nextEl as unknown as { width: number; height: number }).height =
        measured.height;
      const updated = elements.map((e) => (e.id === targetId ? nextEl : e));
      api.updateScene({
        elements: updated,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setTextFormat((prevState) =>
        prevState ? { ...prevState, ...patch } : prevState,
      );
    },
    [textFormat?.id],
  );

  const toast = useCallback((message: string, type: "success" | "error" = "success") => {
    excalidrawAPI?.setToast({ message, closable: true } as never);
    // 失败时用 console 兜底
    if (type === "error") console.error(message);
  }, [excalidrawAPI]);

  // —— 笔记本 ——

  /** 统一改索引：ref、state、localStorage 一起更新 */
  const applyNotebookState = useCallback((next: NotebookState) => {
    notebookStateRef.current = next;
    setNotebookState(next);
    saveNotebookState(next);
  }, []);

  /**
   * 立刻把当前场景写回当前页。
   * 自动保存有 600ms 防抖，切页 / 新建 / 删除前必须手动落盘，
   * 否则队列里的改动会随页面切换一起丢掉。
   */
  const flushCurrentPage = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    try {
      const json = serializeAsJSON(
        api.getSceneElements() as readonly ExcalidrawElement[],
        api.getAppState(),
        api.getFiles(),
        "local",
      );
      savePageScene(notebookStateRef.current.activePageId, json);
    } catch {
      /* 忽略写入错误 */
    }
  }, []);

  /** 把某一页的场景灌进画布（只管加载，不碰索引状态） */
  const loadPageById = useCallback(
    (pageId: string, template: PaperTemplate, title?: string) => {
      const api = excalidrawAPIRef.current;
      if (!api) return;
      setPaperTemplate(template);
      const scene = loadPageScene(pageId) as {
        elements?: ExcalidrawElement[];
        files?: Record<string, BinaryFileData>;
      } | null;
      // 存的是序列化格式，取出来必须 restore 才能安全回灌
      const elements = scene?.elements
        ? restoreElements(scene.elements, null, { repairBindings: true })
        : [];
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      const files = Object.values(scene?.files ?? {}) as BinaryFileData[];
      if (files.length) api.addFiles(files);
      api.refresh();
      if (title) document.title = `${title} – Painter 画板`;
    },
    [],
  );

  const handleSelectPage = useCallback(
    (notebookId: string, pageId: string) => {
      const current = notebookStateRef.current;
      if (current.activeNotebookId === notebookId && current.activePageId === pageId) {
        return;
      }
      flushCurrentPage();
      applyNotebookState({
        ...current,
        activeNotebookId: notebookId,
        activePageId: pageId,
      });
      const page = findPage(current, pageId);
      loadPageById(pageId, page?.template ?? "blank", page?.title);
      refocusCanvas();
    },
    [applyNotebookState, flushCurrentPage, loadPageById],
  );

  const handleCreateNotebook = useCallback(
    (title: string) => {
      const current = notebookStateRef.current;
      flushCurrentPage();
      const notebook = createNotebook(title, current.notebooks.length);
      applyNotebookState({
        ...current,
        notebooks: [...current.notebooks, notebook],
        activeNotebookId: notebook.id,
        activePageId: notebook.pages[0].id,
      });
      loadPageById(notebook.pages[0].id, notebook.pages[0].template, notebook.pages[0].title);
      toast(`已创建笔记本「${title}」`);
    },
    [applyNotebookState, flushCurrentPage, loadPageById, toast],
  );

  const handleRenameNotebook = useCallback(
    (id: string, title: string) => {
      const current = notebookStateRef.current;
      applyNotebookState({
        ...current,
        notebooks: current.notebooks.map((nb) =>
          nb.id === id ? { ...nb, title, updatedAt: Date.now() } : nb,
        ),
      });
    },
    [applyNotebookState],
  );

  const handleDeleteNotebook = useCallback(
    (id: string) => {
      const current = notebookStateRef.current;
      const target = current.notebooks.find((nb) => nb.id === id);
      if (!target || current.notebooks.length <= 1) return;
      target.pages.forEach((p) => deletePageScene(p.id));
      const notebooks = current.notebooks.filter((nb) => nb.id !== id);
      const isCurrent = target.pages.some((p) => p.id === current.activePageId);
      if (isCurrent) {
        const nb = notebooks[0];
        const page = nb.pages[0];
        applyNotebookState({
          ...current,
          notebooks,
          activeNotebookId: nb.id,
          activePageId: page.id,
        });
        loadPageById(page.id, page.template, page.title);
      } else {
        applyNotebookState({ ...current, notebooks });
      }
      toast(`已删除笔记本「${target.title}」`);
    },
    [applyNotebookState, loadPageById, toast],
  );

  const handleCreatePage = useCallback(
    (notebookId: string, template: PaperTemplate) => {
      const current = notebookStateRef.current;
      flushCurrentPage();
      const notebook = current.notebooks.find((nb) => nb.id === notebookId);
      if (!notebook) return;
      const page = createPage(`第 ${notebook.pages.length + 1} 页`, template);
      applyNotebookState({
        ...current,
        activeNotebookId: notebookId,
        activePageId: page.id,
        notebooks: current.notebooks.map((nb) =>
          nb.id === notebookId
            ? { ...nb, pages: [...nb.pages, page], updatedAt: Date.now() }
            : nb,
        ),
      });
      loadPageById(page.id, page.template, page.title);
      toast(`已新建${PAPER_LABELS[template]}页面`);
    },
    [applyNotebookState, flushCurrentPage, loadPageById, toast],
  );

  const handleRenamePage = useCallback(
    (id: string, title: string) => {
      const current = notebookStateRef.current;
      applyNotebookState({
        ...current,
        notebooks: current.notebooks.map((nb) => ({
          ...nb,
          pages: nb.pages.map((p) =>
            p.id === id ? { ...p, title, updatedAt: Date.now() } : p,
          ),
        })),
      });
    },
    [applyNotebookState],
  );

  const handleDeletePage = useCallback(
    (pageId: string) => {
      const current = notebookStateRef.current;
      const notebook = current.notebooks.find((nb) => nb.id === current.activeNotebookId);
      if (!notebook || notebook.pages.length <= 1) return;
      const target = notebook.pages.find((p) => p.id === pageId);
      if (!target) return;
      deletePageScene(pageId);
      const pages = notebook.pages.filter((p) => p.id !== pageId);
      const notebooks = current.notebooks.map((nb) =>
        nb.id === notebook.id ? { ...nb, pages, updatedAt: Date.now() } : nb,
      );
      if (current.activePageId === pageId) {
        // 删的是当前页：落到原位置的相邻页（删尾页时退到最后一页）
        const index = notebook.pages.findIndex((p) => p.id === pageId);
        const nextPage = pages[Math.min(index, pages.length - 1)];
        applyNotebookState({ ...current, notebooks, activePageId: nextPage.id });
        loadPageById(nextPage.id, nextPage.template, nextPage.title);
      } else {
        applyNotebookState({ ...current, notebooks });
      }
      toast(`已删除页面「${target.title}」`);
    },
    [applyNotebookState, loadPageById, toast],
  );

  /**
   * 强制 Excalidraw 走一次完整渲染管线。
   * refresh() 在 0.18 只刷新 UI 层，不触发 canvas 重绘；纸张纹理是外部状态，
   * Excalidraw 不知道它变了，必须用一次 updateScene 才能重绘。
   * 这里回写当前元素（内容不变，仅换新数组引用），无视觉副作用，也不污染 appState。
   */
  const requestExcalidrawRedraw = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted(),
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    });
  }, []);

  /** 换纸张：改索引 + 应用到渲染钩子，当前页才需要重绘 */
  const handleChangeTemplate = useCallback(
    (pageId: string, template: PaperTemplate) => {
      const current = notebookStateRef.current;
      applyNotebookState({
        ...current,
        notebooks: current.notebooks.map((nb) => ({
          ...nb,
          pages: nb.pages.map((p) =>
            p.id === pageId ? { ...p, template, updatedAt: Date.now() } : p,
          ),
        })),
      });
      if (current.activePageId === pageId) {
        setPaperTemplate(template);
        requestExcalidrawRedraw();
      }
    },
    [applyNotebookState, requestExcalidrawRedraw],
  );

  const handleToggleNotebook = useCallback(() => setNotebookOpen((v) => !v), []);

  // 主题切换后纹理配色要跟着换，并重绘一次
  useEffect(() => {
    setPaperDark(realTheme === THEME.DARK);
    requestExcalidrawRedraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realTheme]);

  // 新建 = 在当前笔记本里新增一页，保留旧页。
  // 与面板「新页面」完全同步，只是入口在工具栏上。
  const handleNew = useCallback(() => {
    const current = notebookStateRef.current;
    handleCreatePage(current.activeNotebookId, newPageTemplate);
  }, [handleCreatePage, newPageTemplate]);

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

  // 导出 PNG：动态选择导出倍率，让长边达到 4K（3840px）。
  // Excalidraw 导出管线是矢量重栅格化（笔迹/文字按 scale 重新绘制），
  // 之前不传缩放参数 = 固定 1x，是清晰度不够的根因。
  const handleExportPng = useCallback(async () => {
    if (!excalidrawAPI) return;
    try {
      let outW = 0;
      let outH = 0;
      let outScale = 1;
      const blob = await exportToBlob({
        elements: excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[],
        appState: {
          ...excalidrawAPI.getAppState(),
          exportBackground: true,
          exportEmbedScene: false,
        },
        files: excalidrawAPI.getFiles(),
        mimeType: "image/png",
        getDimensions: (width: number, height: number) => {
          const TARGET_4K = 3840;
          const MAX_SCALE = 8;
          // 浏览器 canvas 安全上限：单边 16384px、总面积约 1.34 亿像素，
          // 超过会导致导出白屏/失败（Excalidraw 原生同样按此处理）
          const MAX_SIDE = 16384;
          const MAX_AREA = 2 ** 27;
          let scale = TARGET_4K / Math.max(width, height);
          // 只放大不缩小：小图拉到 4K，大图保持原始尺寸
          scale = Math.max(1, scale);
          scale = Math.min(scale, MAX_SCALE);
          scale = Math.min(scale, MAX_SIDE / Math.max(width, height));
          scale = Math.min(scale, Math.sqrt(MAX_AREA / (width * height)));
          scale = Math.max(1, scale);
          outW = Math.round(width * scale);
          outH = Math.round(height * scale);
          outScale = Math.round(scale * 100) / 100;
          return { width: outW, height: outH, scale };
        },
      });
      download(blob, stamp("painter", "png"));
      toast(`已导出 PNG（${outW}×${outH}，${outScale}x）`);
    } catch (err) {
      console.error(err);
      toast("导出 PNG 失败", "error");
    }
  }, [excalidrawAPI, toast]);

  // 导出 SVG：先弹窗选背景，确认后再真正导出
  const handleExportSvg = useCallback(() => {
    if (!excalidrawAPI) return;
    // 打开前取一次底色：弹窗里的「带背景」预览要用真实画布颜色
    setSvgBgColor(excalidrawAPI.getAppState().viewBackgroundColor || "#ffffff");
    setSvgDialogOpen(true);
  }, [excalidrawAPI]);

  const handleCloseSvgDialog = useCallback(() => {
    setSvgDialogOpen(false);
    refocusCanvas();
  }, []);

  /**
   * 真正执行 SVG 导出。
   * exportBackground 是唯一开关：true 时 Excalidraw 在 SVG 根节点里
   * 补一层 viewBackgroundColor 的矩形，false 时什么都不画，即透明底。
   */
  const doExportSvg = useCallback(
    async (withBackground: boolean) => {
      if (!excalidrawAPI) return;
      setSvgDialogOpen(false);
      try {
        const svg = await exportToSvg({
          elements: excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[],
          appState: {
            ...excalidrawAPI.getAppState(),
            exportBackground: withBackground,
            exportEmbedScene: false,
          },
          files: excalidrawAPI.getFiles(),
        });
        const svgStr = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        download(blob, stamp("painter", "svg"));
        toast(withBackground ? "已导出 SVG" : "已导出 SVG（透明底）");
      } catch (err) {
        console.error(err);
        toast("导出 SVG 失败", "error");
      }
      refocusCanvas();
    },
    [excalidrawAPI, toast],
  );

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

  // Toolbar 右上角 2 态快捷按钮：在 light/dark 之间翻转，system 模式则退出到 light
  const handleToggleTheme = useCallback(
    () => setThemeMode((m) => (m === THEME.DARK ? THEME.LIGHT : THEME.DARK)),
    [],
  );

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

  // 启用油漆桶（笔迹填充）：点击画布封闭区域铺满所选笔迹；再次点击退出
  const handleFillBucket = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    if (fillActive) {
      setFillActive(false);
      api.setActiveTool({ type: "selection" });
      toast("已退出油漆桶");
      return;
    }
    // 与智能画笔 / 多笔刷互斥
    setSmartShapeActive(false);
    activePenRef.current = null;
    setActivePen(null);
    setFillActive(true);
    api.setActiveTool({ type: "custom", customType: FILL_TOOL, locked: true });
    toast("油漆桶已启用：点选封闭区域，用所选笔迹风格填充");
  }, [toast, fillActive]);

  // 切换填充风格并持久化
  const handleFillKindChange = useCallback((kind: FillKind) => {
    setFillKind(kind);
    try {
      localStorage.setItem(FILL_KIND_KEY, kind);
    } catch {
      /* 忽略 */
    }
  }, []);

  // 油漆桶点击：命中已有填充组 → 换色；否则计算封闭区域 → 生成笔迹填充组
  const handleFillClick = useCallback((x: number, y: number) => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    // 完整数组（含 deleted）用于 z 序回写；存活元素用于几何计算
    const all = api.getSceneElementsIncludingDeleted() as ExcalidrawElement[];
    const live = all.filter((el) => !el.isDeleted);
    const color = drawStyleRef.current.strokeColor;

    // 1. 点击已有填充组成员 → 全组换当前色，不重新生成、不叠加
    const hitGroup = hitFillGroup(x, y, live);
    if (hitGroup) {
      api.updateScene({
        elements: restyleFillGroup(hitGroup, color, all),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      return;
    }

    // 2. 计算点击处的封闭区域（原生公开算法）
    const elementsMap = new Map(
      (live as NonDeletedExcalidrawElement[]).map((el) => [el.id, el as ExcalidrawElement]),
    );
    const result = computeBucketFillPolygon({
      point: [x, y] as GlobalPoint,
      elements: live as readonly NonDeletedExcalidrawElement[],
      elementsMap,
    });
    if (!result.ok) {
      if (result.reason === "too_complex") {
        toast("区域过于复杂，无法填充", "error");
      } else {
        toast("未找到可填充的封闭区域", "error");
      }
      return;
    }

    // 3. 生成填充元素组（keyhole 单环 → 排线/多边形）
    const groupId = `fillgrp-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const newElements = buildFillElements({
      scenePoints: result.scenePoints,
      kind: fillKind,
      color,
      groupId,
      seed: Math.floor(Math.random() * 2 ** 31),
      appState: api.getAppState(),
    });
    if (newElements.length === 0) return; // 退化区域：静默返回，不提交空组

    // 4. 按原生 insertion 锚点解析 z 序（above = 锚点后一位）
    const anchorIndex = all.findIndex((el) => el.id === result.insertion.elementId);
    const insertAt =
      anchorIndex >= 0
        ? result.insertion.placement === "above"
          ? anchorIndex + 1
          : anchorIndex
        : all.length;
    const next = [
      ...all.slice(0, insertAt),
      ...newElements,
      ...all.slice(insertAt),
    ];
    api.updateScene({
      elements: next,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, [fillKind, toast]);

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
      // 油漆桶：单击即填充，不拖拽采集
      if (isFillTool(activeTool)) {
        handleFillClick(pointerDownState.origin.x, pointerDownState.origin.y);
        return;
      }

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
    [handleFillClick],
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
      onFillBucket: handleFillBucket,
      fillActive,
      fillKind,
      onFillKindChange: handleFillKindChange,
      notebookOpen,
      onToggleNotebook: handleToggleNotebook,
      isDark,
    }),
    [handleNew, handleOpen, handleSave, handleExportPng, handleExportSvg, handleClear, handleToggleTheme, handleSmartShape, smartShapeActive, handleSelectPen, activePen, handleFillBucket, fillActive, fillKind, handleFillKindChange, notebookOpen, handleToggleNotebook, isDark],
  );

  // 把属性面板挂到项目自有的 .workspace 容器（绝对定位浮层），
  // 视觉上与原生 Draw to shape 面板同位置同风格。
  // 为什么不挂进 .App-menu_top__left：Excalidraw 的画布在该容器之上
  // 拦截 pointer-events，会让面板"看得见点不到"。
  const panelHost = useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.querySelector(".workspace") ?? document.body;
  }, [ready, activePen, smartShapeActive, fillActive]);

  return (
    <div
      className={`app${smartShapeActive ? " smart-shape-active" : ""}${
        activePen ? " pen-active" : ""
      }${fillActive ? " fill-bucket-active" : ""}`}
      data-theme={realTheme}
      style={{ "--pen-cursor": penCursor(activePen) } as React.CSSProperties}
    >
      <Toolbar {...actions} saving={saving} />
      <div className="workspace">
        {notebookOpen && (
          <NotebookPanel
            state={notebookState}
            newPageTemplate={newPageTemplate}
            onNewPageTemplateChange={setNewPageTemplate}
            onSelectPage={handleSelectPage}
            onCreateNotebook={handleCreateNotebook}
            onRenameNotebook={handleRenameNotebook}
            onDeleteNotebook={handleDeleteNotebook}
            onCreatePage={handleCreatePage}
            onRenamePage={handleRenamePage}
            onDeletePage={handleDeletePage}
            onChangeTemplate={handleChangeTemplate}
            onClose={handleToggleNotebook}
          />
        )}
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
        {fillActive &&
          panelHost &&
          createPortal(
            <FillStyleBar kind={fillKind} onChange={handleFillKindChange} />,
            panelHost,
          )}
        {textFormat && textFormatHostRef.current &&
          createPortal(
            <TextFormatControls
              value={{
                textDirection: textFormat.textDirection,
                lineHeight: textFormat.lineHeight,
                letterSpacing: textFormat.letterSpacing,
              }}
              onChange={applyTextFormat}
            />,
            textFormatHostRef.current,
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
            (window as unknown as Record<string, unknown>).__painterAPI = api;
          }}
          initialData={initialData}
          onChange={handleChange}
          onPointerDown={handlePointerDown}
          onPointerUpdate={handlePointerUpdate}
          onPointerUp={handlePointerUpCombined}
          theme={realTheme}
          // onThemeChange 是 3 态主题切换的唯一通路：MainMenu.DefaultItems.ToggleTheme
          // 内部会强制走这个回调（不传就 console.warn，参考
          // node_modules/@excalidraw/excalidraw/dist/dev/index.js:29969-29975）。
          // 收到 value 后回写到 themeMode，由 realTheme 派生给 Excalidraw.theme。
          onThemeChange={(value) => setThemeMode(value as ThemeMode)}
          langCode={langCode}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: { saveFileToDisk: true },
              // 必须 true：让库注册 actionToggleTheme（含 Alt+Shift+D 快捷键），
              // MainMenu.DefaultItems.ToggleTheme 内部会检查 isActionEnabled，
              // 不注册直接返回 null 看不见。实际行为通过 onThemeChange 接管，
              // 不会改 Excalidraw 自带的 appState.theme。
              toggleTheme: true,
            },
            tools: {
              // 图片工具默认已启用,无需额外配置
              image: true,
            },
          }}
        >
          {/* 自定义 MainMenu：传 children 后 Excalidraw 会自动隐藏 DefaultMainMenu
              （fallback 版的 preferHost 机制，见 index.js:29679-29686）。
              这里手动复刻 13 个 DefaultItems，再在 ChangeCanvasBackground 之前插入：
              1. 主题切换（3 态）
              2. 语言切换（库内置 languages 数组） */}
          <MainMenu>
            <MainMenu.DefaultItems.LoadScene />
            <MainMenu.DefaultItems.SaveToActiveFile />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.Group title="Excalidraw links">
              <MainMenu.DefaultItems.Socials />
            </MainMenu.Group>
            <MainMenu.Separator />

            {/* 画布行为首选项：9 项默认 toggle 全部由库提供（不动 children 走默认）
                —— Select on (Wrap/Overlap 单选) / 工具锁 / 吸附至对象 / 网格 /
                禅模式 / 查看模式 / 画布与形状属性 / 箭头绑定 / 吸附到中点。
                结构对齐 Excalidraw.com 截图：Preferences 作为一级项展开，主题与语言
                仍是主菜单的独立项（不进 Preferences 子菜单）。 */}
            <MainMenu.DefaultItems.Preferences />

            {/* 主题切换：3 态（sun/moon/monitor），通过 onThemeChange 同步到 themeMode */}
            <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={themeMode} />

            {/* 语言切换：遍历库内置 languages 数组（>=85% 完成度的 42 种） */}
            <MainMenu.Sub>
              <MainMenu.Sub.Trigger>
                {languages.find((l) => l.code === langCode)?.label ?? langCode}
              </MainMenu.Sub.Trigger>
              <MainMenu.Sub.Content>
                {languages.map((lang) => (
                  <MainMenu.Item
                    key={lang.code}
                    selected={lang.code === langCode}
                    onSelect={() => setLangCode(lang.code)}
                  >
                    {lang.label}
                  </MainMenu.Item>
                ))}
              </MainMenu.Sub.Content>
            </MainMenu.Sub>

            {/* 画布背景 */}
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>
      </main>
    </div>
      {/* SVG 导出前的背景选择弹窗：渲染在 .app 内，才能继承 .app 上的
          Excalidraw 同源 token（暗色由 .app[data-theme="dark"] 覆盖） */}
      <ExportSvgDialog
        open={svgDialogOpen}
        backgroundColor={svgBgColor}
        onPick={doExportSvg}
        onClose={handleCloseSvgDialog}
      />
  </div>
  );
}
