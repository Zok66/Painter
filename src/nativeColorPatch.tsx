import { useEffect, useRef, useState } from "react";

/** 规范化任意颜色为 #rrggbb，供 <input type="color"> 使用 */
function toHex6(color: string): string {
  if (typeof color !== "string") return "#000000";
  const c = color.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(c)) {
    return "#" + c.split("").map((ch) => ch + ch).join("").toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(c)) {
    return "#" + c.toLowerCase();
  }
  return "#000000";
}

const paletteIcon = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 0 1 0 20" />
    <circle cx="12" cy="12" r="4" />
  </svg>
);

/**
 * 暴露给 Excalidraw 原生 ColorInput 的系统取色触发按钮。
 * 通过 vite transform 注入到原生 EyeDropper 按钮之前，与铅笔取色笔并列。
 * dev 下由调用方传入 color；prod 压缩后拿不到变量名时，从相邻
 * .color-picker-input 读取当前十六进制值作为初始色。
 */
export function NativeSysColorTrigger({
  color,
  onChange,
}: {
  color?: string;
  onChange: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [initial, setInitial] = useState<string>(() =>
    toHex6(color || "#000000"),
  );

  useEffect(() => {
    if (color) {
      setInitial(toHex6(color));
      return;
    }
    // prod 下 color 可能未传入，从相邻 hex input 读取当前值
    const parent = inputRef.current?.parentElement;
    const hexInput = parent?.querySelector?.(
      ".color-picker-input",
    ) as HTMLInputElement | null;
    if (hexInput?.value) {
      setInitial(toHex6("#" + hexInput.value));
    }
  }, [color]);

  return (
    <div
      className="excalidraw-eye-dropper-trigger"
      title="系统取色器"
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="color"
        value={initial}
        onChange={(event) => onChange(event.target.value)}
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: "absolute",
          opacity: 0,
          width: 0,
          height: 0,
          padding: 0,
          border: 0,
          pointerEvents: "none",
        }}
      />
      {paletteIcon}
    </div>
  );
}

// 挂载到全局，供 Excalidraw 原生 ColorInput 的 vite transform 注入引用
(window as unknown as Record<string, unknown>).__painterNativeSysColor =
  NativeSysColorTrigger;
