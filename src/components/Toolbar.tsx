import { useRef } from "react";
import clsx from "clsx";
import PenMenu from "./PenMenu";
import type { PenType } from "../lib/pens";
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
  onSmartShape: () => void;
  smartShapeActive: boolean;
  onSelectPen: (type: PenType) => void;
  activePen: PenType | null;
  onFillBucket: () => void;
  fillActive: boolean;
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
    onSmartShape,
    smartShapeActive,
    onSelectPen,
    activePen,
    onFillBucket,
    fillActive,
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
        <button
          className={clsx("btn btn-smartshape", smartShapeActive && "active")}
          onClick={onSmartShape}
          title="智能画笔：手绘三角形、五角星等图形，松手自动识别（Shift+X）"
        >
          <span className="smartshape-icon" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.5 5.5L19 9l-5.5 2L12 16l-1.5-5L5 9l5.5-1.5L12 2z" />
              <path d="M5 16.5l1 3.5-3.5-1 2.5-2.5zM19 16.5l-1 3.5 3.5-1-2.5-2.5z" opacity="0.6" />
            </svg>
          </span>
          <span className="smartshape-text">智能画笔</span>
          <span className="smartshape-kbd">Shift+X</span>
        </button>

        {/* 多笔刷：圆珠笔 / 钢笔 / 铅笔 / 荧光笔 */}
        <PenMenu activePen={activePen} onSelectPen={onSelectPen} />

        {/* 油漆桶：笔迹填充 */}
        <button
          className={clsx("btn btn-fillbucket", fillActive && "active")}
          onClick={onFillBucket}
          title="油漆桶：点选封闭区域，用所选笔迹风格填充（再次点击退出）"
        >
          <span className="fillbucket-icon" aria-hidden>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.6 2.3a1 1 0 0 1 1.4 0l6.4 6.4a1 1 0 0 1 0 1.4l-7.1 7.1a2 2 0 0 1-2.8 0l-5-5a2 2 0 0 1 0-2.8l7.1-7.1zM12 4.4L5.9 10.5a.4.4 0 0 0 0 .1l5 5a.4.4 0 0 0 .2-.1l7-7-6.1-6.1z" />
              <path d="M2 21.5c0-1.9 1.6-3.9 2.5-3.9s2.5 2 2.5 3.9a2.5 2.5 0 0 1-5 0z" />
            </svg>
          </span>
          <span className="fillbucket-text">油漆桶</span>
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
