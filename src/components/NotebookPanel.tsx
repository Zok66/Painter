// 我的笔记本：笔记本 / 页面管理 + 每页纸张（空白 / 横线 / 方格 / 点阵）
//
// 面板本身只负责 UI 与交互，所有状态变更都由 App 通过回调落地：
// 切页要先存当前页再灌目标页，纸张要同步给渲染钩子，这些都不该让面板操心。

import { useState } from "react";
import {
  PAPER_LABELS,
  PAPER_TEMPLATES,
  type NotebookState,
  type PaperTemplate,
} from "../lib/notebook";
import "./NotebookPanel.css";

type EditState =
  | { mode: "createNotebook"; title: string }
  | { mode: "renameNotebook"; id: string; title: string }
  | { mode: "renamePage"; id: string; title: string }
  | null;

interface NameEditorProps {
  initial: string;
  label: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

/** 内联名称编辑：回车提交，Esc 取消，失焦按提交处理（空值视为取消） */
function NameEditor({ initial, label, onSubmit, onCancel }: NameEditorProps) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    const title = value.trim();
    if (title) onSubmit(title);
    else onCancel();
  };
  return (
    <div className="notebook-editor">
      <input
        className="notebook-editor-input"
        value={value}
        aria-label={label}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

interface NotebookPanelProps {
  state: NotebookState;
  /** 新建页面时使用的纸张 */
  newPageTemplate: PaperTemplate;
  onNewPageTemplateChange: (template: PaperTemplate) => void;
  onSelectPage: (notebookId: string, pageId: string) => void;
  onCreateNotebook: (title: string) => void;
  onRenameNotebook: (id: string, title: string) => void;
  onDeleteNotebook: (id: string) => void;
  onCreatePage: (notebookId: string, template: PaperTemplate) => void;
  onRenamePage: (id: string, title: string) => void;
  onDeletePage: (id: string) => void;
  onChangeTemplate: (pageId: string, template: PaperTemplate) => void;
  onClose: () => void;
}

export default function NotebookPanel({
  state,
  newPageTemplate,
  onNewPageTemplateChange,
  onSelectPage,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onCreatePage,
  onRenamePage,
  onDeletePage,
  onChangeTemplate,
  onClose,
}: NotebookPanelProps) {
  const [editing, setEditing] = useState<EditState>(null);

  const activeNotebook =
    state.notebooks.find((nb) => nb.id === state.activeNotebookId) ??
    state.notebooks[0];
  const canDeleteNotebook = state.notebooks.length > 1;
  const canDeletePage = activeNotebook.pages.length > 1;

  const startCreateNotebook = () =>
    setEditing({
      mode: "createNotebook",
      title: `笔记本 ${state.notebooks.length + 1}`,
    });

  const submitEdit = (title: string) => {
    if (!editing) return;
    if (editing.mode === "createNotebook") onCreateNotebook(title);
    else if (editing.mode === "renameNotebook") onRenameNotebook(editing.id, title);
    else onRenamePage(editing.id, title);
    setEditing(null);
  };

  const confirmDeleteNotebook = (id: string) => {
    const nb = state.notebooks.find((n) => n.id === id);
    if (!nb) return;
    if (!window.confirm(`删除笔记本「${nb.title}」？其中 ${nb.pages.length} 页内容会一并删除，且无法恢复。`)) {
      return;
    }
    onDeleteNotebook(id);
  };

  const confirmDeletePage = (id: string) => {
    const page = activeNotebook.pages.find((p) => p.id === id);
    if (!page) return;
    if (!window.confirm(`删除页面「${page.title}」？页面内容无法恢复。`)) return;
    onDeletePage(id);
  };

  return (
    <aside className="notebook-panel" role="dialog" aria-label="我的笔记本">
      <header className="notebook-panel-header">
        <h2 className="notebook-panel-title">我的笔记本</h2>
        <button
          type="button"
          className="notebook-icon-btn"
          onClick={onClose}
          title="关闭"
          aria-label="关闭笔记本面板"
        >
          ×
        </button>
      </header>

      <div className="notebook-panel-body">
        <p className="notebook-hint">笔记本仅保存在当前浏览器</p>

        <section className="notebook-section">
          <div className="notebook-section-title">
            <span>笔记本</span>
            <button type="button" onClick={startCreateNotebook}>
              ＋ 新建
            </button>
          </div>
          <div className="notebook-list">
            {state.notebooks.map((nb) =>
              editing?.mode === "renameNotebook" && editing.id === nb.id ? (
                <NameEditor
                  key={nb.id}
                  initial={editing.title}
                  label="修改笔记本名称"
                  onSubmit={submitEdit}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div
                  key={nb.id}
                  className={`notebook-list-item${
                    nb.id === activeNotebook.id ? " active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="notebook-list-select"
                    onClick={() => {
                      // 已展开的笔记本不响应点击，避免误切回第一页
                      if (nb.id !== activeNotebook.id) {
                        onSelectPage(nb.id, nb.pages[0]?.id ?? "");
                      }
                    }}
                    title={nb.title}
                  >
                    <span
                      className="notebook-cover"
                      style={{ background: nb.color }}
                      aria-hidden
                    />
                    <span className="notebook-list-name">{nb.title}</span>
                    <span className="notebook-list-meta">{nb.pages.length} 页</span>
                  </button>
                  <button
                    type="button"
                    className="notebook-icon-btn"
                    title="重命名笔记本"
                    aria-label="重命名笔记本"
                    onClick={() =>
                      setEditing({
                        mode: "renameNotebook",
                        id: nb.id,
                        title: nb.title,
                      })
                    }
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="notebook-icon-btn"
                    title={canDeleteNotebook ? "删除笔记本" : "至少保留一个笔记本"}
                    aria-label="删除笔记本"
                    disabled={!canDeleteNotebook}
                    onClick={() => confirmDeleteNotebook(nb.id)}
                  >
                    ×
                  </button>
                </div>
              ),
            )}
            {editing?.mode === "createNotebook" && (
              <NameEditor
                initial={editing.title}
                label="新建笔记本"
                onSubmit={submitEdit}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        </section>

        <section className="notebook-section notebook-pages">
          <div className="notebook-section-title">
            <span>{activeNotebook.title} · 页面</span>
            <button
              type="button"
              onClick={() => onCreatePage(activeNotebook.id, newPageTemplate)}
            >
              ＋ 新页面
            </button>
          </div>

          <div className="paper-template-picker" aria-label="新页面纸张">
            {PAPER_TEMPLATES.map((tpl) => (
              <button
                key={tpl}
                type="button"
                className={`paper-template-btn${
                  newPageTemplate === tpl ? " selected" : ""
                }`}
                onClick={() => onNewPageTemplateChange(tpl)}
                title={`新建${PAPER_LABELS[tpl]}页面`}
                aria-pressed={newPageTemplate === tpl}
              >
                <span className={`paper-preview paper-${tpl}`} aria-hidden />
                <span className="paper-template-label">{PAPER_LABELS[tpl]}</span>
              </button>
            ))}
          </div>

          <div className="page-list">
            {activeNotebook.pages.map((page, index) =>
              editing?.mode === "renamePage" && editing.id === page.id ? (
                <NameEditor
                  key={page.id}
                  initial={editing.title}
                  label="修改页面名称"
                  onSubmit={submitEdit}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div
                  key={page.id}
                  className={`page-list-item${
                    page.id === state.activePageId ? " active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="page-list-select"
                    onClick={() => onSelectPage(activeNotebook.id, page.id)}
                    title={`切换到 ${page.title}`}
                  >
                    <span className={`page-sheet paper-${page.template}`} aria-hidden>
                      {index + 1}
                    </span>
                    <span className="page-list-name">
                      <strong>{page.title}</strong>
                      <small>{PAPER_LABELS[page.template]}纸</small>
                    </span>
                  </button>
                  <select
                    className="page-template-select"
                    value={page.template}
                    aria-label={`修改 ${page.title} 的纸张`}
                    onChange={(e) =>
                      onChangeTemplate(page.id, e.target.value as PaperTemplate)
                    }
                  >
                    {PAPER_TEMPLATES.map((tpl) => (
                      <option key={tpl} value={tpl}>
                        {PAPER_LABELS[tpl]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="notebook-icon-btn"
                    title="重命名页面"
                    aria-label="重命名页面"
                    onClick={() =>
                      setEditing({ mode: "renamePage", id: page.id, title: page.title })
                    }
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="notebook-icon-btn"
                    title={canDeletePage ? "删除页面" : "至少保留一页"}
                    aria-label="删除页面"
                    disabled={!canDeletePage}
                    onClick={() => confirmDeletePage(page.id)}
                  >
                    ×
                  </button>
                </div>
              ),
            )}
          </div>
        </section>
      </div>

      <footer className="notebook-panel-footer">
        本地数据不会自动同步到其他设备，请定期导出重要笔记。
      </footer>
    </aside>
  );
}
