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
import { computeBucketFillPolygon, redrawTextBoundingBox } from "@excalidraw/element";
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
import AnimationTimeline from "./components/AnimationTimeline";
import {
  applyProps,
  buildSceneAtTime,
  deleteProject,
  deleteTrack,
  loadBaseScene,
  loadProject,
  propsFromElement,
  removeKeyframe,
  sampleTrack,
  saveBaseScene,
  saveProject,
  setKeyframeEasing,
  upsertKeyframe,
  type AnimProject,
  type AnimProps,
  type EasingType,
} from "./lib/keyframeAnim";
import {
  composeSceneWithOnion,
  stripOnionElements,
  type OnionConfig,
} from "./lib/onionSkin";
import { downloadBlob, exportAnimationToGif } from "./lib/gifExport";
import type { Point } from "./lib/shapeRecognition";
import { installPainterTextFormat, painterMeasureText } from "./lib/textFormat";
import type {
  TextDirection,
  TextFormatCustomData,
  TextVerticalAlign,
} from "./lib/textFormat";
import { DEFAULT_VERTICAL_ALIGN } from "./lib/textFormat";
import TextFormatControls from "./components/TextFormatControls";
import "./App.css";
import "./nativeColorPatch";

// 固定配置：传给 <Excalidraw> 的 UIOptions 必须是稳定引用，否则每次父组件
// 重渲染都会生成新对象，导致 Excalidraw 反复重渲染并重新 emit onChange，
// 在动画自动关键帧等路径上可能触发无限 setState（白屏）。
const EXCALIDRAW_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: { saveFileToDisk: true },
    toggleTheme: true,
  },
  tools: {
    image: true,
  },
};

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
  // ── 帧动画（关键帧补间）─────────────────────────────────────
  // 数据挂在「当前笔记本页」上：切页整条工程跟着换。
  // 基准场景 = 进入动画面板时抓取的画布内容；关键帧记录属性差异，播放/导出时插值。
  const [animProject, setAnimProject] = useState<AnimProject>(() =>
    loadProject(notebookState.activePageId),
  );
  const animProjectRef = useRef<AnimProject>(animProject);
  const [animOpen, setAnimOpen] = useState(false);
  const [animPlaying, setAnimPlaying] = useState(false);
  const animPlayingRef = useRef(false);
  useEffect(() => {
    animPlayingRef.current = animPlaying;
  }, [animPlaying]);
  useEffect(() => {
    animOpenRef.current = animOpen;
  }, [animOpen]);
  const [playheadT, setPlayheadT] = useState(0);
  const playheadRef = useRef(0);
  const [playMode, setPlayMode] = useState<"once" | "loop">("loop");
  const playModeRef = useRef<"once" | "loop">("loop");
  useEffect(() => {
    playModeRef.current = playMode;
  }, [playMode]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [onion, setOnion] = useState<OnionConfig>({ enabled: true, before: 1, after: 1, opacity: 30 });
  const animApplyingRef = useRef(false);
  /** 上次 applyProjectToCanvas 触发 Excalidraw 归一化回声的时间戳。
   *  在 ~300ms 免疫期内，handleChange 只同步刷新「上次铺到画布的快照」但不录帧，
   *  避免「拖动时间条 = 自动打帧」的 bug（Excalidraw 接到 elements 后归一化 width/height、
   *  points 等字段造成的浮点抖动会反复触发签名比较）。 */
  const animAppliedAtRef = useRef(0);
  // ── 动画专属撤销/重做栈（面板打开时接管 Ctrl+Z / Ctrl+Shift+Z）──────────
  // 根因：动画工程存 localStorage，完全在 Excalidraw 自己的撤销栈之外，导致
  // 「添加帧撤不回」「撤画布后关键帧停留在旧值 → 不同步」。这里把画布场景快照
  // 与动画工程打包成一步，面板打开时统一回退/前进，保证画面与帧一致。
  type DocSnapshot = {
    els: ExcalidrawElement[];
    appState: AppState;
    project: AnimProject;
  };
  const animUndoStack = useRef<DocSnapshot[]>([]);
  const animRedoStack = useRef<DocSnapshot[]>([]);
  const applyingUndoRef = useRef(false);
  // 一次拖拽手势 = 一个撤销步：pointerDown 时存「手势起点快照」，真正录到关键帧
  // 的那次 onChange 才把它压栈，pointerUp 清空；避免每次 pointermove 都压一个步。
  const animOpenRef = useRef(false);
  // 自动打帧分支用：「变更前」组合快照 + 本次变动是否已压栈。pointerDown 与「稳定态」
  // 都会刷新它，真正录到关键帧的那次 onChange 才把它压入撤销栈（一次拖拽只压一个步）。
  const pendingUndoSnapRef = useRef<DocSnapshot | null>(null);
  const pendingUndoConsumedRef = useRef(false);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ done: 0, total: 0 });
  /** 画布内容每次落盘递增，供时间轴刷新缩略图 */
  const [sceneVersion, setSceneVersion] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 文字格式化：选中单个文字元素时记录其格式，供原生面板内的控件读写
  const [textFormat, setTextFormat] = useState<{
    id: string;
    textDirection: TextDirection;
    lineHeight: number;
    letterSpacing: number;
    verticalAlign: TextVerticalAlign;
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
      if (fontSizeFieldset?.parentNode) {
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
      // 画布上删除了元素 → 同步清理它在动画工程里的轨道与基准场景，
      // 避免「物体都删了，动画面板数据还在」。否则被删元素会在拖时间条/播放时重新冒出来。
      {
        const liveIds = new Set(elements.map((e) => e.id));
        const project = animProjectRef.current;
        const deadIds = project.tracks
          .map((t) => t.elementId)
          .filter((id) => !liveIds.has(id));
        if (deadIds.length > 0) {
          let next = project;
          for (const id of deadIds) next = deleteTrack(next, id);
          saveProject(notebookStateRef.current.activePageId, next);
          animProjectRef.current = next;
          setAnimProject(next);
          setSceneVersion((v) => v + 1);
          // 基准场景里同样移除死元素（基准是它的原始快照，停面板后重新打开会再抓，
          // 但这里提前清掉可避免播放/拖时间条把已删元素又铺回画布）
          baseElementsRef.current = baseElementsRef.current.filter((e) =>
            liveIds.has(e.id),
          );
          // 把清理后的基准场景落盘，避免刷新后已删元素从旧基准 JSON 复活
          try {
            const baseJson = serializeAsJSON(
              baseElementsRef.current,
              appState,
              files,
              "local",
            );
            saveBaseScene(notebookStateRef.current.activePageId, baseJson);
          } catch {
            /* 忽略写入错误 */
          }
          for (const id of deadIds) lastShownPropsRef.current.delete(id);
        }
      }
      // 文字格式化：检测是否选中单个文字元素，更新面板状态（用签名去重，避免每次变更都重渲染）
      {
        const selIds = Object.keys(appState.selectedElementIds || {});
        let next: {
          id: string;
          textDirection: TextDirection;
          lineHeight: number;
          letterSpacing: number;
          verticalAlign: TextVerticalAlign;
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
              verticalAlign: cd?.verticalAlign ?? DEFAULT_VERTICAL_ALIGN,
            };
          }
        }
        const sig = next ? JSON.stringify(next) : "null";
        if (sig !== lastTextFmtRef.current) {
          lastTextFmtRef.current = sig;
          setTextFormat(next);
        }
      }
      // 动画面板打开时：记录选中元素，并把用户在画布上的改动即时录成关键帧
      // （剪映式自动关键帧：在播放头处拖动元素 = 更新该时刻关键帧）
      if (animOpen && !animPlayingRef.current && !animApplyingRef.current) {
        const selIds = Object.keys(appState.selectedElementIds || {});
        const selId = selIds.length === 1 ? selIds[0] : null;
        selectedElementIdRef.current = selId;
        setSelectedElementId(selId);
        if (selId) {
          const cur = elements.find((e) => e.id === selId);
          const prev = lastShownPropsRef.current.get(selId);
          if (cur && prev) {
            const now = propsFromElement(cur, elements.indexOf(cur));
            // 在 applyProjectToCanvas 写下的回声窗口内，Excalidraw 接收我们推上去的
            // elements 后会做归一化（重算 width/height、normalize points 等），产生
            // 微小的浮点抖动。这里只刷新快照、不录帧，避免「拖时间条 = 自动打帧」。
            // 窗口外才视为真改动并 upsert 关键帧。
            const inAppliedImmune =
              Date.now() - animAppliedAtRef.current < 300;
            if (JSON.stringify(now) === JSON.stringify(prev)) {
              // 稳定态：记录「变更前」组合快照，作为下一步撤销的目标；
              // 同时复位「本次变动已压栈」标记，等待下一次真正变动。
              if (!applyingUndoRef.current) {
                pendingUndoSnapRef.current = captureAnimSnapshot();
                pendingUndoConsumedRef.current = false;
              }
              lastShownPropsRef.current.set(selId, now);
            } else if (inAppliedImmune) {
              lastShownPropsRef.current.set(selId, now);
            } else {
              // 真正变动：若这次变动还没压过栈，用「变更前快照」压一个撤销步
              // （一次拖拽 = 一个步，避免每个 pointermove 都压一个步）。
              if (
                !pendingUndoConsumedRef.current &&
                pendingUndoSnapRef.current &&
                animOpenRef.current
              ) {
                animUndoStack.current.push(pendingUndoSnapRef.current);
                animRedoStack.current = [];
                pendingUndoConsumedRef.current = true;
              }
              // 拖动过程中录关键帧：只更新工程与内存，不重铺画布（避免和拖拽打架）
              const next = upsertKeyframe(
                animProjectRef.current,
                selId,
                playheadRef.current,
                now,
              );
              saveProject(notebookStateRef.current.activePageId, next);
              animProjectRef.current = next;
              setAnimProject(next);
              setSceneVersion((v) => v + 1);
              // 关键：同步刷新「上次铺到画布的快照」，否则 App 重渲染导致 Excalidraw
              // 因 props 不稳定而重渲染、再次 emit onChange 时，会把同一位置误判为「又变了」，
              // 进而无限 setState（Maximum update depth → 白屏）。
              lastShownPropsRef.current.set(selId, now);
            }
          }
        }
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // 播放中 updateScene 也会触发 onChange，但那不是编辑内容，不能落盘
        if (animPlayingRef.current) return;
        try {
          // 剥掉洋葱皮幽灵再落盘：幽灵是临时参考物，不能混进页快照和帧快照
          const json = serializeAsJSON(
            stripOnionElements(elements),
            appState,
            files,
            "local",
          );
          savePageScene(notebookStateRef.current.activePageId, json);
          setSceneVersion((v) => v + 1);
        } catch {
          /* 忽略写入错误 */
        }
      }, 600);
    },
    [smartShapeActive, fillActive, animOpen],
  );

  /** 应用文字格式化变更：合并 customData + lineHeight，重算包围盒后写回场景 */
  const applyTextFormat = useCallback(
    (patch: {
      textDirection?: TextDirection;
      lineHeight?: number;
      letterSpacing?: number;
      verticalAlign?: TextVerticalAlign;
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
        ...(patch.verticalAlign !== undefined
          ? { verticalAlign: patch.verticalAlign }
          : {}),
      };
      const nextLineHeight = patch.lineHeight ?? prev.lineHeight ?? 1.25;
      const nextEl = {
        ...prev,
        lineHeight: nextLineHeight,
        customData: nextCd,
      } as ExcalidrawElement;
      // 重算包围盒
      if (nextCd.textDirection === "vertical") {
        // 竖排：尺寸由自研 painterMeasureText 计算（列宽 / 列高含字距）
        const measured = painterMeasureText({
          text: prev.text ?? "",
          fontSize: prev.fontSize ?? 16,
          lineHeight: nextLineHeight,
          fontFamily: prev.fontFamily ?? 1,
          customData: nextCd,
        });
        (nextEl as unknown as { width: number; height: number }).width =
          measured.width;
        // 用户拖过上下手柄设定过框高度时保留它，但不小于内容高度，避免文字被裁切
        const fixedH = nextCd.fixedHeight;
        (nextEl as unknown as { width: number; height: number }).height =
          typeof fixedH === "number"
            ? Math.max(fixedH, measured.height)
            : measured.height;
      } else {
        // 横排（含字距）：调用 Excalidraw 原生 redrawTextBoundingBox，它内部用打过补丁的
        // wrapText（字距感知）重新折行，并把结果写回 element.text / height。
        // 这样渲染态画的折行与编辑态 textarea 的原生折行完全一致，
        // 修复「进入编辑后文字被字距挤压错位」的问题。
        const container = (prev as unknown as { containerId?: string }).containerId
          ? (elements.find(
              (e) =>
                e.id === (prev as unknown as { containerId?: string }).containerId,
            ) as ExcalidrawElement | undefined) ?? null
          : null;
        const shimScene = {
          getNonDeletedElementsMap: () => new Map<string, ExcalidrawElement>(),
          mutateElement: (el: ExcalidrawElement, props: Partial<ExcalidrawElement>) =>
            Object.assign(el, props),
        };
        redrawTextBoundingBox(nextEl as never, container as never, shimScene as never);
        // redrawTextBoundingBox 已把字距感知折行写回 nextEl.text（autoResize=false 时）并设置宽度；
        // 但其内部的 measureText 用的是折行【前】的旧 text，导致高度按旧行数算。
        // 故这里用 painterMeasureText 对【折行后】的文本二次测量高度，避免框太矮把文字裁切。
        const m2 = painterMeasureText({
          text: (nextEl as unknown as { text: string }).text ?? "",
          fontSize: prev.fontSize ?? 16,
          lineHeight: nextLineHeight,
          fontFamily: prev.fontFamily ?? 1,
          customData: nextCd,
        });
        // 用户拖过上下手柄设定过框高度时保留它，但不小于内容高度，避免文字被裁切
        const fixedH = nextCd.fixedHeight;
        (nextEl as unknown as { height: number }).height =
          typeof fixedH === "number" ? Math.max(fixedH, m2.height) : m2.height;
      }
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

  // —— 帧动画（关键帧补间 · 剪映逻辑）——
  // 基准场景 = 进入动画面板时抓取的画布真实内容；关键帧记录属性差异，播放/导出时插值。

  /** 内存里的基准场景：进入动画时抓取一次，重铺 / 播放 / 导出都基于它 */
  const baseElementsRef = useRef<ExcalidrawElement[]>([]);
  /** 最近一次铺到画布上的元素属性（按 id），用于在 onChange 里识别用户是否真改了东西 */
  const lastShownPropsRef = useRef<Map<string, AnimProps>>(new Map());
  /** 画布当前选中的单个元素 id（同步写，避免 handleChange 闭包拿到旧值） */
  const selectedElementIdRef = useRef<string | null>(null);

  /** 把工程落到画布：buildSceneAtTime 插值 + 洋葱皮，写到 Excalidraw。
   *  apply=false 时只更新内存/state 与属性快照，不重铺（拖拽过程中调用，避免和拖拽打架）。 */
  const applyProjectToCanvas = useCallback(
    (t: number, opts?: { apply?: boolean }) => {
      const apply = opts?.apply !== false;
      const p = animProjectRef.current;
      const scene = buildSceneAtTime(p, baseElementsRef.current, t);
      // 先按「基准插值场景」(scene) 播种一份快照（拖拽过程中 apply=false 复用此路径）
      const shown = new Map<string, AnimProps>();
      scene.forEach((el, i) => shown.set(el.id, propsFromElement(el, i)));
      if (!apply) {
        lastShownPropsRef.current = shown;
        return;
      }
      const api = excalidrawAPIRef.current;
      if (!api) return;
      // 标记回声窗口：Excalidraw 接收我们推上去的 elements 后会归一化（重算 width/height、
      // normalize points）并异步触发几次 onChange，这里告诉 handleChange 在 300ms 内
      // 不要把这些「同位置抖动」当成用户编辑来录关键帧。
      animAppliedAtRef.current = Date.now();
      animApplyingRef.current = true;
      let pushed = scene;
      if (onion.enabled) {
        const stepT = 1 / Math.max(1, p.fps);
        const before: ExcalidrawElement[][] = [];
        const after: ExcalidrawElement[][] = [];
        for (let d = onion.before; d >= 1; d--) {
          const tt = t - d * stepT;
          if (tt < 0) continue;
          before.unshift(buildSceneAtTime(p, baseElementsRef.current, tt));
        }
        for (let d = 1; d <= onion.after; d++) {
          const tt = t + d * stepT;
          if (tt > p.durationSec) continue;
          after.push(buildSceneAtTime(p, baseElementsRef.current, tt));
        }
        pushed = composeSceneWithOnion({ current: scene, before, after, config: onion });
      }
      // 关键修复：用「实际推到画布的 scene」(pushed) 的索引给 z 播种。
      // propsFromElement 把 z 算成「元素在场景数组里的索引」，这个值并不稳定——
      // 洋葱皮幽灵、选中态、场景增删都会让它漂移，导致 onChange 里 now.z 与这里
      // 播下的 prev.z 永远对不上，被 JSON 全量签名误判为「变了」→ 一停手/一开面板
      // 就自动打帧。改用 pushed 的真实索引播种后，推完之后 Excalidraw 场景索引与
      // prev.z 对齐，松手/打开面板不再误打帧；真正的层级(置顶/置底)变动仍会被正常录到。
      const shown2 = new Map<string, AnimProps>();
      pushed.forEach((el, i) => shown2.set(el.id, propsFromElement(el, i)));
      lastShownPropsRef.current = shown2;
      api.updateScene({ elements: pushed, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      api.refresh();
      setTimeout(() => { animApplyingRef.current = false; }, 0);
    },
    [onion],
  );

  /** 工程落地：存盘 + 同步 ref/state；apply=true（默认）时顺手重铺画布 */
  const commitProject = useCallback(
    (p: AnimProject, opts?: { apply?: boolean }) => {
      saveProject(notebookStateRef.current.activePageId, p);
      animProjectRef.current = p;
      setAnimProject(p);
      setSceneVersion((v) => v + 1);
      if (animOpen && (opts?.apply !== false)) applyProjectToCanvas(playheadRef.current);
    },
    [animOpen, applyProjectToCanvas],
  );

  /** 进入面板：把当前画布抓成基准场景并存盘 */
  const captureBaseScene = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const els = stripOnionElements(api.getSceneElements() as ExcalidrawElement[]);
    baseElementsRef.current = els;
    try {
      const json = serializeAsJSON(els, api.getAppState(), api.getFiles(), "local");
      saveBaseScene(notebookStateRef.current.activePageId, json);
    } catch {
      /* 忽略写入错误 */
    }
  }, []);
  // ── 动画撤销/重做（面板打开时接管 Ctrl+Z / Ctrl+Shift+Z）────────────────
  /** 抓取「画布场景 + 动画工程」组合快照，作为一步撤销的原子单位 */
  const captureAnimSnapshot = useCallback((): DocSnapshot => {
    const api = excalidrawAPIRef.current;
    const els = api
      ? (api.getSceneElements() as ExcalidrawElement[]).map((e) => ({ ...e }))
      : [];
    const appState = api ? { ...api.getAppState() } : ({} as AppState);
    return { els, appState, project: animProjectRef.current };
  }, []);

  /** 把当前快照压入撤销栈（清掉重做栈）。manual 类改动在变更前调用。 */
  const pushAnimUndo = useCallback(() => {
    if (!animOpenRef.current) return;
    const snap = captureAnimSnapshot();
    const top = animUndoStack.current[animUndoStack.current.length - 1];
    // 与栈顶相同则跳过，避免重复步
    if (
      top &&
      JSON.stringify(top.project) === JSON.stringify(snap.project) &&
      JSON.stringify(top.els.map((e) => e.id + e.x + e.y)) ===
        JSON.stringify(snap.els.map((e) => e.id + e.x + e.y))
    ) {
      return;
    }
    animUndoStack.current.push(snap);
    animRedoStack.current = [];
  }, [captureAnimSnapshot]);

  /** 真正把一份快照落到画布与工程（撤销/重做共用）。复用 Excalidraw 的
   *  normalize 免疫机制（animAppliedAtRef / animApplyingRef），让恢复后的回声
   *  只刷新快照、不误录关键帧。 */
  const applyAnimSnapshot = useCallback((snap: DocSnapshot) => {
    applyingUndoRef.current = true;
    animAppliedAtRef.current = Date.now();
    animApplyingRef.current = true;
    const api = excalidrawAPIRef.current;
    if (api) {
      api.updateScene({
        elements: snap.els,
        appState: snap.appState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      api.refresh();
    }
    animProjectRef.current = snap.project;
    setAnimProject(snap.project);
    saveProject(notebookStateRef.current.activePageId, snap.project);
    setSceneVersion((v) => v + 1);
    setTimeout(() => {
      animApplyingRef.current = false;
      applyingUndoRef.current = false;
    }, 0);
  }, []);

  /** 撤销：仅当面板打开且栈非空时接管；否则返回 false 让 Excalidraw 原生撤销处理。 */
  const animUndo = useCallback((): boolean => {
    if (!animOpenRef.current || animUndoStack.current.length === 0) return false;
    animRedoStack.current.push(captureAnimSnapshot());
    const snap = animUndoStack.current.pop()!;
    applyAnimSnapshot(snap);
    return true;
  }, [captureAnimSnapshot, applyAnimSnapshot]);

  const animRedo = useCallback((): boolean => {
    if (!animOpenRef.current || animRedoStack.current.length === 0) return false;
    animUndoStack.current.push(captureAnimSnapshot());
    const snap = animRedoStack.current.pop()!;
    applyAnimSnapshot(snap);
    return true;
  }, [captureAnimSnapshot, applyAnimSnapshot]);

  // 把最新函数挂到 ref，供全局 keydown 监听调用（避免闭包过期）
  const animUndoRef = useRef(animUndo);
  const animRedoRef = useRef(animRedo);
  animUndoRef.current = animUndo;
  animRedoRef.current = animRedo;

  // 面板打开时接管 Ctrl/Cmd+Z（撤销）与 Ctrl/Cmd+Shift+Z / Ctrl+Y（重做）。
  // 仅当动画撤销栈非空才拦截；否则放行给 Excalidraw 原生撤销（画布常规改动照常可撤）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      const undoActive = animUndoStack.current.length > 0;
      const redoActive = animRedoStack.current.length > 0;
      if (key === "z") {
        if (!animOpenRef.current) return;
        const wantRedo = e.shiftKey;
        if (wantRedo && redoActive) {
          e.preventDefault();
          e.stopPropagation();
          animRedoRef.current();
        } else if (!wantRedo && undoActive) {
          e.preventDefault();
          e.stopPropagation();
          animUndoRef.current();
        }
      } else if (key === "y") {
        if (!animOpenRef.current || !redoActive) return;
        e.preventDefault();
        e.stopPropagation();
        animRedoRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // —— 时间轴回调 ——

  /** 在播放头处为选中元素加/更关键帧（取该元素当前画布属性） */
  const handleAddKeyframe = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api || !selectedElementIdRef.current) {
      toast("先在画布选中要动画的元素", "error");
      return;
    }
    const selId = selectedElementIdRef.current;
    const sceneEls = api.getSceneElements() as ExcalidrawElement[];
    const el = sceneEls.find((e) => e.id === selId);
    if (!el) return;
    pushAnimUndo();
    commitProject(
      upsertKeyframe(
        animProjectRef.current,
        selId,
        playheadRef.current,
        propsFromElement(el, sceneEls.indexOf(el)),
      ),
    );
  }, [toast, commitProject]);

  /** 点轨道 = 在画布上选中那个元素 */
  const handleSelectTrack = useCallback((id: string) => {
    setSelectedElementId(id);
    selectedElementIdRef.current = id;
    const api = excalidrawAPIRef.current;
    if (api) {
      api.updateScene({
        appState: { selectedElementIds: { [id]: true } } as never,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
    }
  }, []);

  const handleDeleteKeyframe = useCallback(
    (elementId: string, kfId: string) => {
      pushAnimUndo();
      commitProject(removeKeyframe(animProjectRef.current, elementId, kfId));
    },
    [commitProject, pushAnimUndo],
  );

  /** 拖动关键帧菱形 = 改时间点（保留属性与缓动） */
  const handleMoveKeyframe = useCallback(
    (elementId: string, kfId: string, t: number) => {
      const p = animProjectRef.current;
      const track = p.tracks.find((tr) => tr.elementId === elementId);
      const kf = track?.keyframes.find((k) => k.id === kfId);
      if (!kf) return;
      const without = removeKeyframe(p, elementId, kfId);
      pushAnimUndo();
      commitProject(
        upsertKeyframe(
          without,
          elementId,
          Math.max(0, Math.min(t, p.durationSec)),
          kf.props,
          kf.easing,
        ),
      );
    },
    [commitProject, pushAnimUndo],
  );

  const handleSetEasing = useCallback(
    (elementId: string, kfId: string, easing: EasingType) => {
      pushAnimUndo();
      commitProject(
        setKeyframeEasing(animProjectRef.current, elementId, kfId, easing),
      );
    },
    [commitProject, pushAnimUndo],
  );

  const handleDeleteTrack = useCallback(
    (elementId: string) => {
      pushAnimUndo();
      commitProject(deleteTrack(animProjectRef.current, elementId));
    },
    [commitProject, pushAnimUndo],
  );

  const handleFpsChange = useCallback(
    (fps: number) => {
      pushAnimUndo();
      commitProject(
        { ...animProjectRef.current, fps: Math.max(1, Math.round(fps)) },
        { apply: false },
      );
    },
    [commitProject, pushAnimUndo],
  );

  const handleDurationChange = useCallback(
    (sec: number) => {
      pushAnimUndo();
      commitProject({
        ...animProjectRef.current,
        durationSec: Math.max(0.1, sec),
      });
    },
    [commitProject, pushAnimUndo],
  );

  const handleOnionChange = useCallback(
    (next: OnionConfig) => {
      setOnion(next);
      // 洋葱皮只影响显示，重铺即可，不写工程
      if (animOpen) applyProjectToCanvas(playheadRef.current);
    },
    [animOpen, applyProjectToCanvas],
  );

  /** 拖动播放头：跳到某时刻并刷新预览（播放中忽略） */
  const handlePlayheadChange = useCallback(
    (t: number) => {
      if (animPlayingRef.current) return;
      const tt = Math.max(0, Math.min(t, animProjectRef.current.durationSec));
      playheadRef.current = tt;
      setPlayheadT(tt);
      applyProjectToCanvas(tt);
    },
    [applyProjectToCanvas],
  );

  /** 停止播放：清定时器 */
  const stopPlayback = useCallback(() => {
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
    animPlayingRef.current = false;
    setAnimPlaying(false);
  }, []);

  /** 播放：按时间逐帧 buildSceneAtTime 采样，只 updateScene 不碰磁盘 */
  const startPlayback = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;
    const p = animProjectRef.current;
    if (p.tracks.length === 0) {
      toast("先添加关键帧再播放", "error");
      return;
    }
    const fps = Math.max(1, p.fps);
    const total = Math.max(1, Math.round(p.durationSec * fps));
    const perFrameMs = 1000 / fps;
    setAnimPlaying(true);
    animPlayingRef.current = true;
    let i = 0;
    const step = () => {
      if (!animPlayingRef.current) return;
      if (i > total) {
        if (playModeRef.current === "loop") {
          i = 0;
        } else {
          stopPlayback();
          playheadRef.current = 0;
          setPlayheadT(0);
          applyProjectToCanvas(0);
          return;
        }
      }
      const t = i / fps;
      const scene = buildSceneAtTime(p, baseElementsRef.current, t);
      api.updateScene({ elements: scene, captureUpdate: CaptureUpdateAction.EVENTUALLY });
      playheadRef.current = t;
      setPlayheadT(t);
      i += 1;
      playTimerRef.current = setTimeout(step, perFrameMs);
    };
    step();
  }, [toast, stopPlayback, applyProjectToCanvas]);

  const handleTogglePlay = useCallback(() => {
    if (animPlaying) {
      stopPlayback();
      applyProjectToCanvas(playheadRef.current);
    } else {
      startPlayback();
    }
  }, [animPlaying, stopPlayback, applyProjectToCanvas, startPlayback]);

  const handleExportGif = useCallback(
    async (scale: number, background: boolean) => {
      const api = excalidrawAPIRef.current;
      if (!api) return;
      const p = animProjectRef.current;
      if (p.tracks.length === 0) {
        toast("没有可导出的动画", "error");
        return;
      }
      const total = Math.max(1, Math.round(p.durationSec * p.fps));
      setExporting(true);
      setExportProgress({ done: 0, total });
      try {
        const blob = await exportAnimationToGif({
          project: p,
          baseElements: baseElementsRef.current,
          files: api.getFiles(),
          fps: p.fps,
          durationSec: p.durationSec,
          scale,
          background,
          backgroundColor: api.getAppState().viewBackgroundColor || "#ffffff",
          onProgress: (done, totalN) => setExportProgress({ done, total: totalN }),
        });
        downloadBlob(blob, stamp("animation", "gif"));
        toast(`已导出 GIF（${total} 帧）`);
      } catch (err) {
        console.error(err);
        toast("导出 GIF 失败", "error");
      } finally {
        setExporting(false);
      }
    },
    [toast],
  );

  /**
   * 开关动画面板。
   * 打开：抓取当前画布为基准场景，铺上 t=0（含洋葱皮）预览。
   * 关闭：停播放 + 摘掉插值，画布只留基准场景真实内容。
   */
  const handleToggleAnim = useCallback(() => {
    if (animOpen) {
      stopPlayback();
      const api = excalidrawAPIRef.current;
      if (api) {
        animApplyingRef.current = true;
        api.updateScene({
          elements: baseElementsRef.current,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        api.refresh();
        setTimeout(() => { animApplyingRef.current = false; }, 0);
      }
      setAnimOpen(false);
      lastShownPropsRef.current = new Map();
      animUndoStack.current = [];
      animRedoStack.current = [];
      pendingUndoSnapRef.current = null;
      pendingUndoConsumedRef.current = false;
      refocusCanvas();
      return;
    }
    captureBaseScene();
    setAnimOpen(true);
    // 清空 Excalidraw 原生撤销栈：面板打开期间撤销由我们接管（统一回退画布+帧），
    // 否则内部 applyProjectToCanvas 的 IMMEDIATELY 快照会残留在原生栈里，
    // 等动画撤销栈空了之后 Ctrl+Z 会误撤到这些内部快照。
    const api0 = excalidrawAPIRef.current;
    if (api0 && api0.history) {
      try {
        api0.history.clear();
      } catch {
        /* 忽略 */
      }
    }
    setPlayheadT(0);
    playheadRef.current = 0;
    setSelectedElementId(null);
    selectedElementIdRef.current = null;
    requestAnimationFrame(() => applyProjectToCanvas(0));
  }, [animOpen, stopPlayback, captureBaseScene, applyProjectToCanvas]);

  // 面板打开时：空格播放 / 停止，逗号句号前后挪播放头
  useEffect(() => {
    if (!animOpen) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === ",") {
        e.preventDefault();
        handlePlayheadChange(
          playheadRef.current - 1 / Math.max(1, animProjectRef.current.fps),
        );
      } else if (e.key === ".") {
        e.preventDefault();
        handlePlayheadChange(
          playheadRef.current + 1 / Math.max(1, animProjectRef.current.fps),
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [animOpen, handleTogglePlay, handlePlayheadChange]);

  // 组件卸载 / 关面板时收掉播放定时器
  useEffect(() => () => stopPlayback(), [stopPlayback]);

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
      // 面板打开时存基准场景（动画静态底图）；否则存当前画布（剥掉洋葱皮幽灵）
      const els = animOpen
        ? baseElementsRef.current
        : stripOnionElements(api.getSceneElements() as ExcalidrawElement[]);
      const json = serializeAsJSON(els, api.getAppState(), api.getFiles(), "local");
      savePageScene(notebookStateRef.current.activePageId, json);
      if (animOpen) {
        // 基准场景跟着当前画布内容走，避免切页丢动画基准
        saveBaseScene(notebookStateRef.current.activePageId, json);
      }
    } catch {
      /* 忽略写入错误 */
    }
  }, [animOpen]);

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

      // 动画工程跟着页走：换页即换整份关键帧工程 + 基准场景
      const p = loadProject(pageId);
      animProjectRef.current = p;
      setAnimProject(p);
      // 撤销栈是内存态，不跨页保留（否则会误撤到上一页的状态）
      animUndoStack.current = [];
      animRedoStack.current = [];
      pendingUndoSnapRef.current = null;
      pendingUndoConsumedRef.current = false;
      const baseJson = loadBaseScene(pageId);
      if (baseJson) {
        try {
          const parsed = JSON.parse(baseJson) as { elements?: ExcalidrawElement[] };
          baseElementsRef.current = parsed.elements ?? elements;
        } catch {
          baseElementsRef.current = elements;
        }
      } else {
        baseElementsRef.current = elements;
      }
      setPlayheadT(0);
      playheadRef.current = 0;
      setSelectedElementId(null);
      selectedElementIdRef.current = null;
      lastShownPropsRef.current = new Map();
      setSceneVersion((v) => v + 1);
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
      // 这一页的动画工程一并清掉，不留孤儿数据
      deleteProject(pageId);
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
          stripOnionElements(excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[]),
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
        stripOnionElements(excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[]),
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
        elements: stripOnionElements(excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[]),
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
          elements: stripOnionElements(excalidrawAPI.getSceneElements() as readonly ExcalidrawElement[]),
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
    // 洋葱皮幽灵不参与填充：那是别的帧的影子，算进封闭区域会填出错误形状
    const live = stripOnionElements(all.filter((el) => !el.isDeleted));
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
      // 动画：在真正改动前抓取「手势起点」组合快照，作为本次拖拽的撤销目标
      // （一次拖拽 = 一个撤销步，配合 handleChange 里 pendingUndoConsumedRef 去重）。
      if (animOpenRef.current) {
        pendingUndoSnapRef.current = captureAnimSnapshot();
        pendingUndoConsumedRef.current = false;
      }
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

  // 动画面板用的文件表（图片素材）：随落盘节奏刷新，避免每次渲染新引用
  // 触发缩略图整批重算
  const animFiles = useMemo(
    () => excalidrawAPI?.getFiles() ?? {},
    [excalidrawAPI, sceneVersion],
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
      animOpen,
      onToggleAnim: handleToggleAnim,
      isDark,
    }),
    [handleNew, handleOpen, handleSave, handleExportPng, handleExportSvg, handleClear, handleToggleTheme, handleSmartShape, smartShapeActive, handleSelectPen, activePen, handleFillBucket, fillActive, fillKind, handleFillKindChange, notebookOpen, handleToggleNotebook, animOpen, handleToggleAnim, isDark],
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
                verticalAlign: textFormat.verticalAlign,
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
            // dev-only 测试钩子：端到端直接验证引擎的 points/颜色/z 插值
            if (import.meta.env.DEV) {
              (window as unknown as Record<string, unknown>).__painterAnim = {
                buildSceneAtTime,
                sampleTrack,
                applyProps,
                propsFromElement,
                getProject: () => animProjectRef.current,
                getBase: () => baseElementsRef.current,
              };
            }
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
          UIOptions={EXCALIDRAW_UI_OPTIONS}
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
      {/* 动画时间轴：.app 的 flex 子项，横跨底部，画布自动让位 */}
      {animOpen && (
        <AnimationTimeline
          project={animProject}
          playheadT={playheadT}
          playing={animPlaying}
          fps={animProject.fps}
          durationSec={animProject.durationSec}
          onion={onion}
          elementName={(id) => {
            const els =
              (excalidrawAPI?.getSceneElements() as ExcalidrawElement[] | undefined) ??
              baseElementsRef.current;
            const el = els.find((e) => e.id === id);
            const label =
              (el as { name?: string } | undefined)?.name || el?.type || "元素";
            return label;
          }}
          selectedElementId={selectedElementId}
          files={animFiles}
          baseElements={baseElementsRef.current}
          onAddKeyframe={handleAddKeyframe}
          onSelectTrack={handleSelectTrack}
          onDeleteKeyframe={handleDeleteKeyframe}
          onMoveKeyframe={handleMoveKeyframe}
          onSetEasing={handleSetEasing}
          onDeleteTrack={handleDeleteTrack}
          onFpsChange={handleFpsChange}
          onDurationChange={handleDurationChange}
          onOnionChange={handleOnionChange}
          onPlayheadChange={handlePlayheadChange}
          onPlayToggle={handleTogglePlay}
          playMode={playMode}
          onPlayModeChange={setPlayMode}
          onExportGif={handleExportGif}
          exporting={exporting}
          exportProgress={exportProgress}
          onClose={handleToggleAnim}
        />
      )}
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
