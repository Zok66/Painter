import React from "react";
import { useAtom, atom } from "jotai";
import { Popover } from "radix-ui";
import clsx from "clsx";

// re-export the jotai primitives the copied native files import from "./_shims"
export { useAtom, atom };

/* ------------------------------------------------------------------ *
 * Shims for the Excalidraw-internal modules the native ColorPicker
 * depends on. Everything the copied ColorPicker tree imports from
 * `../../i18n`, `../../editor-jotai`, `../App`, `../icons`,
 * `../EyeDropper`, `../PropertiesPopover`, `../ButtonSeparator`,
 * `../../hooks/useTextEditorFocus`, `../..//shortcut`, `../../types`
 * resolves to this single module so the component stays 1:1 with the
 * upstream source while living standalone inside our project.
 * ------------------------------------------------------------------ */

/* ----------------------------- i18n --------------------------------- */
export type TranslationKeys = string;

/* ---- app state types (the native component only reads a few fields) ---- */
export type AppState = any;
export type UIAppState = any;

const I18N: Record<string, string> = {
  "colorPicker.hexCode": "十六进制值",
  "colorPicker.color": "颜色",
  "labels.showStroke": "显示描边",
  "labels.showBackground": "显示背景",
  "labels.stroke": "描边",
  "labels.background": "背景",
  "labels.colorPicker": "颜色选择器",
  "colorPicker.mostUsedCustomColors": "最常用的自定义颜色",
  "colorPicker.colors": "颜色",
  "colorPicker.shades": "色调明暗",
  "colorPicker.topPicksTip": "将任意颜色拖到上方常用色即可固定它",
  "colorPicker.noShades": "此颜色没有可用的明暗变化",
  "colorPicker.invalidHexLength": "十六进制代码长度无效",
  "colorPicker.invalidColor": "颜色无效",
  "labels.eyeDropper": "取色器",
  "colorPicker.resetTopPicks": "重置为默认值",
};

const COLOR_NAMES: Record<string, string> = {
  transparent: "透明",
  black: "黑色",
  white: "白色",
  gray: "灰色",
  red: "红色",
  pink: "粉色",
  grape: "紫红色",
  violet: "紫罗兰色",
  blue: "蓝色",
  cyan: "青色",
  teal: "蓝绿色",
  green: "绿色",
  yellow: "黄色",
  orange: "橙色",
  bronze: "古铜色",
};

export const t = (key: string, _params?: any, fallback?: string): string => {
  if (key.startsWith("colors.")) {
    const name = key.slice("colors.".length).replace(/\d+/g, "");
    return COLOR_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
  }
  if (key in I18N) {
    return I18N[key];
  }
  return fallback ?? key;
};

/* --------------------- container / panel mode ----------------------- */
export const useExcalidrawContainer = () => ({
  container: null as HTMLElement | null,
});

export const useStylesPanelMode = () =>
  "full" as "full" | "compact" | "mobile";

export const useEditorInterface = () => ({
  formFactor: "desktop" as "desktop" | "phone",
  isLandscape: false,
  isTouchScreen: false,
});

/* --------------------------- eye dropper ----------------------------- */
export interface ActiveEyeDropperState {
  keepOpenOnAlt: boolean;
  onSelect: (color: string) => void;
  colorPickerType: string;
}

export const activeEyeDropperAtom = atom<ActiveEyeDropperState | null>(null);

/* -------------------------- button separator ------------------------- */
export const ButtonSeparator: React.FC = () => (
  <div
    className="dropdown-menu-separator"
    style={{
      height: "1px",
      background: "var(--default-border-color)",
      margin: "0.25rem 0",
    }}
  />
);

/* ------------------------------- icons ------------------------------- */
export const slashIcon = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 18l12 -12" />
  </svg>
);

export const strokeIcon = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M6 10l4 -4 L6 14l8 -8 L6 18l12 -12 L10 18l8 -8 L14 18l4 -4" />
  </svg>
);

export const eyeDropperIcon = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4z" />
    <path d="M11 7l6 6" />
  </svg>
);

/* ----------------------- text editor focus --------------------------- */
export const saveCaretPosition = () => null;
export const restoreCaretPosition = (_saved: any) => {};
export const temporarilyDisableTextEditorBlur = () => {};

/* --------------------------- shortcuts ------------------------------- */
export const getShortcutKey = (key: string) => key;

/* ------------------------------- Island ------------------------------ *
 * Mirrors Excalidraw's `Island` component. The popup is portaled outside
 * `.painter-color-picker`, so the matching CSS lives in ColorPicker.scss
 * under `.properties-popover .Island`.
 */
export const Island = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode;
    padding?: number;
    className?: string | boolean;
    style?: React.CSSProperties;
  }
>(({ children, padding, className, style }, ref) => (
  <div
    ref={ref}
    className={clsx("Island", className)}
    style={{ "--padding": padding, ...style } as React.CSSProperties}
  >
    {children}
  </div>
));
Island.displayName = "Island";

/* ------------------------- PropertiesPopover ------------------------- *
 * 1:1 adaptation of Excalidraw's PropertiesPopover, minus the optional
 * focus-return-to-container logic that needs `isInteractive`.
 */
export const PropertiesPopover: React.FC<{
  container?: HTMLElement | null;
  style?: React.CSSProperties;
  preventAutoFocusOnTouch?: boolean;
  onFocusOutside?: (e: any) => void;
  onPointerDownOutside?: (e: any) => void;
  onClose?: () => void;
  children?: React.ReactNode;
}> = ({
  container,
  style,
  preventAutoFocusOnTouch,
  onFocusOutside,
  onPointerDownOutside,
  onClose,
  children,
}) => {
  const [eyeDropperState] = useAtom(activeEyeDropperAtom);
  const editorInterface = useEditorInterface();
  const isMobilePortrait =
    editorInterface.formFactor === "phone" && !editorInterface.isLandscape;

  return (
    <Popover.Portal container={container ?? undefined}>
      <Popover.Content
        className="properties-popover focus-visible-none"
        data-prevent-outside-click
        side={isMobilePortrait ? "bottom" : "right"}
        align={isMobilePortrait ? "center" : "start"}
        alignOffset={-16}
        sideOffset={20}
        collisionBoundary={container ?? undefined}
        style={{
          zIndex: "var(--zIndex-ui-styles-popup)",
          marginLeft:
            editorInterface.formFactor === "phone" ? "0.5rem" : undefined,
        }}
        onOpenAutoFocus={(e) => {
          if (preventAutoFocusOnTouch && editorInterface.isTouchScreen) {
            e.preventDefault();
          }
        }}
        onCloseAutoFocus={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClose?.();
        }}
        onFocusOutside={(e) => {
          e.preventDefault();
          onFocusOutside?.(e);
        }}
        onPointerDownOutside={(e) => {
          if (eyeDropperState) {
            e.preventDefault();
            return;
          }
          onPointerDownOutside?.(e);
          onClose?.();
        }}
      >
        <Island padding={3} style={style}>
          {children}
        </Island>
        <Popover.Arrow
          width={20}
          height={10}
          style={{
            fill: "var(--popup-bg-color)",
            filter: "drop-shadow(rgba(0, 0, 0, 0.05) 0px 3px 2px)",
          }}
        />
      </Popover.Content>
    </Popover.Portal>
  );
};

/* ------------------------- EyeDropper controller --------------------- */
export const EyeDropperController: React.FC = () => {
  const [state, setState] = useAtom(activeEyeDropperAtom);
  React.useEffect(() => {
    if (!state) {
      return;
    }
    const w = window as any;
    if (typeof w === "undefined" || !w.EyeDropper) {
      setState(null);
      return;
    }
    let cancelled = false;
    new w.EyeDropper()
      .open()
      .then((res: any) => {
        if (!cancelled) {
          state.onSelect(res.sRGBHex);
          setState(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state, setState]);
  return null;
};
