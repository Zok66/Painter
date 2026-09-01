import React, { useState, useCallback, useMemo } from "react";
import {
  COLOR_PALETTE,
  DEFAULT_ELEMENT_STROKE_COLOR_PALETTE,
  DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE,
} from "@excalidraw/common";
import { ColorPicker } from "./ColorPicker";
import type { ColorPickerType } from "./colorPickerUtils";

interface NativeColorPickerProps {
  type: ColorPickerType;
  color: string;
  onChange: (color: string) => void;
  theme?: "light" | "dark";
  label?: string;
}

/**
 * Drop-in wrapper around the verbatim upstream Excalidraw `ColorPicker`.
 * Owns the `appState`/`updateData` state machine the native component drives
 * (openPopup, theme, …) so it behaves exactly like the original — top-picks
 * strip, popup, keyboard navigation, eye dropper and all.
 */
interface PickerAppState {
  openPopup: ColorPickerType | null;
  theme: "light" | "dark";
  editingTextElement: any;
  colorTopPicks: any;
}

const getPalette = (type: ColorPickerType) => {
  switch (type) {
    case "elementStroke":
      return DEFAULT_ELEMENT_STROKE_COLOR_PALETTE;
    case "elementBackground":
      return DEFAULT_ELEMENT_BACKGROUND_COLOR_PALETTE;
    default:
      return COLOR_PALETTE;
  }
};

export const NativeColorPicker: React.FC<NativeColorPickerProps> = ({
  type,
  color,
  onChange,
  theme = "dark",
  label,
}) => {
  const palette = useMemo(() => getPalette(type), [type]);
  const [appState, setAppState] = useState<PickerAppState>({
    openPopup: null,
    theme,
    editingTextElement: null,
    colorTopPicks: undefined,
  });

  const updateData = useCallback((formData?: any) => {
    setAppState((prev) => ({ ...prev, ...formData }));
  }, []);

  return (
    <div
      className={`painter-color-picker ${
        theme === "dark" ? "theme--dark" : "theme--light"
      }`}
    >
      <ColorPicker
        type={type}
        color={color}
        onChange={onChange}
        label={label ?? (type === "elementStroke" ? "描边" : "背景")}
        palette={palette}
        elements={[]}
        appState={appState as any}
        updateData={updateData}
      />
    </div>
  );
};
