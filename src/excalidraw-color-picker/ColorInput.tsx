import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KEYS, normalizeInputColor } from "@excalidraw/common";

import { useAtom } from "./_shims";
import { t } from "./_shims";

import { activeColorPickerSectionAtom } from "./colorPickerUtils";

/** 调色板按钮图标：唤起系统颜色选择器。 */
const colorPaletteIcon = (
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

/** 取色笔按钮图标：调用浏览器原生 EyeDropper API。 */
const eyeDropperIcon = (
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
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4z" />
    <path d="M11 7l6 6" />
  </svg>
);

export const ColorInput = ({
  color,
  onChange,
  label,
  placeholder,
  colorPickerType: _colorPickerType,
}: {
  color: string;
  onChange: (color: string) => void;
  label: string;
  placeholder?: string;
  /**
   * 原生 ColorInput 会传入 colorPickerType，但自研实现不需要它。
   * 保留该 prop 是为了让 vite transform 直接替换原生调用时不必再删字段。
   */
  colorPickerType?: string;
}) => {
  const [innerValue, setInnerValue] = useState(color);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeSection, setActiveColorPickerSection] = useAtom(
    activeColorPickerSectionAtom,
  );

  useEffect(() => {
    setInnerValue(color);
  }, [color]);

  const changeColor = useCallback(
    (inputValue: string) => {
      const value = inputValue.toLowerCase().trim();
      const color = normalizeInputColor(value);

      if (color) {
        onChange(color);
        setErrorMessage(null);
      } else if (value.length === 0) {
        setErrorMessage(null);
      } else if (/^#?[0-9a-f]+$/.test(value)) {
        setErrorMessage(t("colorPicker.invalidHexLength"));
      } else {
        setErrorMessage(t("colorPicker.invalidColor"));
      }
      setInnerValue(value);
    },
    [onChange],
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const pickerTriggerRef = useRef<HTMLDivElement>(null);
  const eyeDropperTriggerRef = useRef<HTMLDivElement>(null);
  const nativeColorInputRef = useRef<HTMLInputElement>(null);

  const [picking, setPicking] = useState(false);

  const openEyeDropper = useCallback(async () => {
    const w = window as any;
    if (typeof w === "undefined" || !w.EyeDropper) {
      return;
    }
    setPicking(true);
    try {
      const result = await new w.EyeDropper().open();
      if (result?.sRGBHex) {
        changeColor(result.sRGBHex);
      }
    } catch {
      // user cancelled or API not supported
    } finally {
      setPicking(false);
    }
  }, [changeColor]);

  const currentHex = useMemo(() => {
    const v = (color || "").replace(/^#/, "");
    return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : "#ffffff";
  }, [color]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeSection]);

  return (
    <div className="color-picker__input-label-container">
      <div
        className={clsx("color-picker__input-label", {
          "has-error": errorMessage,
        })}
      >
        <div className="color-picker__input-hash">#</div>
        <input
          ref={activeSection === "hex" ? inputRef : undefined}
          style={{ border: 0, padding: 0 }}
          spellCheck={false}
          className="color-picker-input"
          aria-label={label}
          aria-invalid={!!errorMessage}
          onChange={(event) => {
            changeColor(event.target.value);
          }}
          value={(innerValue || "").replace(/^#/, "")}
          onBlur={() => {
            setInnerValue(color);
            setErrorMessage(null);
          }}
          tabIndex={-1}
          onFocus={() => setActiveColorPickerSection("hex")}
          onKeyDown={(event) => {
            if (event.key === KEYS.TAB) {
              return;
            } else if (event.key === KEYS.ESCAPE) {
              pickerTriggerRef.current?.focus();
            }
            event.stopPropagation();
          }}
          placeholder={placeholder}
        />
        <div
          style={{
            width: "1px",
            height: "1.25rem",
            backgroundColor: "var(--default-border-color)",
          }}
        />
        <div className="color-picker__input-label-triggers">
          <div
            ref={pickerTriggerRef}
            className="excalidraw-eye-dropper-trigger"
            onClick={() => nativeColorInputRef.current?.click()}
            title={t("labels.colorPicker")}
          >
            <input
              ref={nativeColorInputRef}
              type="color"
              value={currentHex}
              onChange={(event) => changeColor(event.target.value)}
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
            {colorPaletteIcon}
          </div>
          <div
            ref={eyeDropperTriggerRef}
            className={clsx("excalidraw-eye-dropper-trigger", {
              selected: picking,
            })}
            onClick={openEyeDropper}
            title={`${t("labels.eyeDropper")} — I`}
          >
            {eyeDropperIcon}
          </div>
        </div>
      </div>
      {errorMessage && (
        <div className="color-picker__error-message" role="alert">
          {errorMessage}
        </div>
      )}
    </div>
  );
};
