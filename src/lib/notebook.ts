// 笔记本数据层
//
// 存储分两块：笔记本索引（notebooks + active 指针）单独一个 key，
// 每个页面的场景单独一个 key。切页 = 把当前场景写入当前页 → 读目标页 →
// 灌进 Excalidraw。这样切换不用序列化/反序列化整本笔记本，页面多了也不卡。
//
// 全部落在 localStorage：面板里明说"仅保存在当前浏览器"，与画板本身一致。

export type PaperTemplate = "blank" | "ruled" | "grid" | "dotted";

export const PAPER_TEMPLATES: PaperTemplate[] = ["blank", "ruled", "grid", "dotted"];

export const PAPER_LABELS: Record<PaperTemplate, string> = {
  blank: "空白",
  ruled: "横线",
  grid: "方格",
  dotted: "点阵",
};

export interface NotebookPage {
  id: string;
  title: string;
  template: PaperTemplate;
  createdAt: number;
  updatedAt: number;
}

export interface Notebook {
  id: string;
  title: string;
  /** 笔记本封面色，按创建顺序轮换 */
  color: string;
  pages: NotebookPage[];
  createdAt: number;
  updatedAt: number;
}

export interface NotebookState {
  version: 1;
  notebooks: Notebook[];
  activeNotebookId: string;
  activePageId: string;
}

const INDEX_KEY = "painter:notebooks:v1";
/** 升级前画板用的单场景 key，首次进入时迁移成第一页 */
const LEGACY_SCENE_KEY = "painter:scene:v1";
const PAGE_PREFIX = "painter:page:";

const NOTEBOOK_COLORS = [
  "#6965db",
  "#228be6",
  "#12b886",
  "#f59f00",
  "#e8590c",
  "#d6336c",
];

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isTemplate(value: unknown): value is PaperTemplate {
  return PAPER_TEMPLATES.includes(value as PaperTemplate);
}

export function createPage(
  title: string,
  template: PaperTemplate = "blank",
): NotebookPage {
  const now = Date.now();
  return { id: newId(), title, template, createdAt: now, updatedAt: now };
}

export function createNotebook(title: string, index = 0): Notebook {
  const now = Date.now();
  return {
    id: newId(),
    title,
    color: NOTEBOOK_COLORS[index % NOTEBOOK_COLORS.length],
    pages: [createPage("第 1 页")],
    createdAt: now,
    updatedAt: now,
  };
}

export function pageSceneKey(pageId: string): string {
  return `${PAGE_PREFIX}${pageId}`;
}

/** 容错修复：下标越界、template 非法值都拉回可用状态 */
function normalize(state: NotebookState): NotebookState {
  const notebooks = state.notebooks.map((nb) => ({
    ...nb,
    pages: nb.pages.map((p) => ({
      ...p,
      template: isTemplate(p.template) ? p.template : ("blank" as PaperTemplate),
    })),
  }));
  const active =
    notebooks.find((nb) => nb.id === state.activeNotebookId) ?? notebooks[0];
  const page =
    active.pages.find((p) => p.id === state.activePageId) ?? active.pages[0];
  return {
    version: 1,
    notebooks,
    activeNotebookId: active.id,
    activePageId: page.id,
  };
}

export function saveNotebookState(state: NotebookState) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(state));
  } catch {
    /* 忽略写入错误（隐私模式 / 配额满） */
  }
}

export function loadNotebookState(): NotebookState {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as NotebookState;
      if (Array.isArray(parsed?.notebooks) && parsed.notebooks.length > 0) {
        return normalize(parsed);
      }
    }
  } catch {
    /* 忽略损坏的本地数据，退回初始状态 */
  }
  return createInitialState();
}

/** 首次进入：建默认笔记本，并把旧版单场景内容迁成第一页，避免升级丢画 */
function createInitialState(): NotebookState {
  const notebook = createNotebook("我的笔记本");
  const firstPage = notebook.pages[0];
  const state: NotebookState = {
    version: 1,
    notebooks: [notebook],
    activeNotebookId: notebook.id,
    activePageId: firstPage.id,
  };
  saveNotebookState(state);
  try {
    const legacy = localStorage.getItem(LEGACY_SCENE_KEY);
    if (legacy) {
      localStorage.setItem(pageSceneKey(firstPage.id), legacy);
      localStorage.removeItem(LEGACY_SCENE_KEY);
    }
  } catch {
    /* 忽略 */
  }
  return state;
}

export function loadPageScene(pageId: string): unknown | null {
  try {
    const raw = localStorage.getItem(pageSceneKey(pageId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePageScene(pageId: string, scene: unknown) {
  try {
    const value = typeof scene === "string" ? scene : JSON.stringify(scene);
    localStorage.setItem(pageSceneKey(pageId), value);
  } catch {
    /* 忽略 */
  }
}

export function deletePageScene(pageId: string) {
  try {
    localStorage.removeItem(pageSceneKey(pageId));
  } catch {
    /* 忽略 */
  }
}

export function findNotebook(
  state: NotebookState,
  id: string,
): Notebook | undefined {
  return state.notebooks.find((nb) => nb.id === id);
}

export function findPage(
  state: NotebookState,
  pageId: string,
): NotebookPage | undefined {
  for (const nb of state.notebooks) {
    const page = nb.pages.find((p) => p.id === pageId);
    if (page) return page;
  }
  return undefined;
}

/** 当前激活页（找不到时退回第一个笔记本的第一页） */
export function activePage(state: NotebookState): NotebookPage {
  const nb = findNotebook(state, state.activeNotebookId) ?? state.notebooks[0];
  return nb.pages.find((p) => p.id === state.activePageId) ?? nb.pages[0];
}
