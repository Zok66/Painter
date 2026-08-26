import { useEffect, useRef, useState } from "react";
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
  /** 修改选中元素的字体大小(px) */
  onFontSizeChange: (size: number) => void;
  /** 当前选中文本元素的字体大小,null 表示未选中 */
  selectedFontSize: number | null;
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
    onFontSizeChange,
    selectedFontSize,
    isDark,
    saving,
  } = props;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 字体大小输入框的本地值,用户输入时不被外部覆盖
  const [fontSizeInput, setFontSizeInput] = useState<string>("");
  const fontSizeInputRef = useRef<HTMLInputElement>(null);

  // 选中元素变化时同步输入框(仅在未聚焦时,避免打断用户输入)
  useEffect(() => {
    const el = fontSizeInputRef.current;
    const isFocused = el && document.activeElement === el;
    if (!isFocused) {
      setFontSizeInput(selectedFontSize == null ? "" : String(selectedFontSize));
    }
  }, [selectedFontSize]);

  const handleOpenClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onOpen(file);
    e.target.value = ""; // 允许重复选同一文件
  };

  // 提交字体大小输入(回车或失焦时)
  const commitFontSize = () => {
    const raw = fontSizeInput.trim();
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onFontSizeChange(n);
  };

  const handleFontSizeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitFontSize();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      // 取消编辑,恢复显示
      setFontSizeInput(selectedFontSize == null ? "" : String(selectedFontSize));
      (e.target as HTMLInputElement).blur();
    }
  };

  const fontSizeDisabled = selectedFontSize == null;

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

        {/* 字体大小自定义输入(参考 processon 数字 px) */}
        <div
          className={`font-size-control${fontSizeDisabled ? " disabled" : ""}`}
          title={fontSizeDisabled ? "选中文本元素后可修改字体大小" : "字体大小(px),回车应用"}
        >
          <span className="font-size-label">字号</span>
          <input
            ref={fontSizeInputRef}
            className="font-size-input"
            type="number"
            min={1}
            max={200}
            step={1}
            value={fontSizeInput}
            placeholder={fontSizeDisabled ? "—" : "px"}
            disabled={fontSizeDisabled}
            onChange={(e) => setFontSizeInput(e.target.value)}
            onBlur={commitFontSize}
            onKeyDown={handleFontSizeKeyDown}
          />
          <span className="font-size-unit">px</span>
        </div>

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
