import { useRef } from "react";
import "./Toolbar.css";

/** 工具栏可执行的操作集合,由 App 通过 props 注入 */
export interface ToolbarActions {
  onNew: () => void;
  onOpen: (file: File) => void;
  onSave: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onClear: () => void;
  onToggleTheme: () => void;
  isDark: boolean;
}

interface ToolbarProps extends ToolbarActions {
  saving: boolean;
}

/** 扁平顶部工具栏 —— 主要按钮放最前,绿色主调,无阴影无渐变 */
export default function Toolbar(props: ToolbarProps) {
  const {
    onNew,
    onOpen,
    onSave,
    onExportPng,
    onExportSvg,
    onClear,
    onToggleTheme,
    isDark,
    saving,
  } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onOpen(file);
    e.target.value = ""; // 允许重复选同一文件
  };


  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="logo">
          <span className="logo-mark" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="logo-text">
            Painter <em>画板</em>
          </span>
        </div>

        <div className="divider" />

        {/* 主操作按钮组 —— 主按钮置首 */}
        <button className="btn btn-primary" onClick={onNew} title="新建空白画布">
          新建
        </button>
        <button className="btn" onClick={handleOpenClick} title="打开 .excalidraw 文件">
          打开
        </button>
        <button className="btn" onClick={onSave} disabled={saving} title="保存为 .excalidraw 文件">
          {saving ? "保存中…" : "保存"}
        </button>

        <div className="divider" />

        <button className="btn btn-accent" onClick={onExportPng} title="导出 PNG 图片">
          导出 PNG
        </button>
        <button className="btn btn-accent" onClick={onExportSvg} title="导出 SVG 矢量图">
          导出 SVG
        </button>

        <div className="divider" />


        <button className="btn btn-danger" onClick={onClear} title="清空当前画布">
          清空
        </button>
      </div>

      <div className="toolbar-right">
        <button
          className="btn btn-icon"
          onClick={onToggleTheme}
          title={isDark ? "切换到浅色" : "切换到深色"}
          aria-label="切换主题"
        >
          {isDark ? "☀️" : "🌙"}
        </button>
        <a
          className="btn btn-link"
          href="https://github.com/excalidraw/excalidraw"
          target="_blank"
          rel="noreferrer"
          title="基于 Excalidraw 开源项目"
        >
          基于 Excalidraw
        </a>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".excalidraw,.excalidrawjson,application/json"
        onChange={handleFileChange}
        hidden
      />
    </header>
  );
}
