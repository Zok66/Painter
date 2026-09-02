// 导出 SVG 前的背景选择弹窗。
//
// 「带背景」走 exportBackground: true，SVG 里多一层画布底色矩形；
// 「不带背景」走 exportBackground: false，SVG 透明底，方便贴到别的设计稿上。
//
// 样式沿用 Excalidraw 原生 Island：圆角 0.5rem + shadow-island 投影，
// 配色 token 全部从 .app 继承（暗色由 .app[data-theme="dark"] 覆盖），
// 所以这里不重复声明亮/暗两套颜色。

import { useEffect, useRef } from "react";
import "./ExportSvgDialog.css";

interface ExportSvgDialogProps {
  open: boolean;
  /** 当前画布背景色，用于「带背景」选项的预览色块 */
  backgroundColor: string;
  /** 选择结果：true 带背景，false 透明底 */
  onPick: (withBackground: boolean) => void;
  onClose: () => void;
}

export default function ExportSvgDialog({
  open,
  backgroundColor,
  onPick,
  onClose,
}: ExportSvgDialogProps) {
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstOptionRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // capture 阶段拦截：Excalidraw 自己也会监听 Esc（退出工具 / 关面板），
        // 在它之前先把弹窗关掉，才不会一次 Esc 触发两个动作。
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="export-svg-mask" onPointerDown={onClose}>
      <div
        className="export-svg-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-svg-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 className="export-svg-title" id="export-svg-title">
          导出 SVG
        </h2>
        <p className="export-svg-desc">导出时是否包含画布背景色？</p>

        <div className="export-svg-options">
          <button
            ref={firstOptionRef}
            type="button"
            className="export-svg-option"
            onClick={() => onPick(true)}
          >
            <span
              className="export-svg-preview"
              style={{ background: backgroundColor }}
              aria-hidden
            />
            <span className="export-svg-option-label">带背景</span>
            <span className="export-svg-option-hint">保留画布底色</span>
          </button>

          <button
            type="button"
            className="export-svg-option"
            onClick={() => onPick(false)}
          >
            <span className="export-svg-preview export-svg-preview--transparent" aria-hidden />
            <span className="export-svg-option-label">不带背景</span>
            <span className="export-svg-option-hint">透明底</span>
          </button>
        </div>

        <div className="export-svg-footer">
          <button type="button" className="export-svg-cancel" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
