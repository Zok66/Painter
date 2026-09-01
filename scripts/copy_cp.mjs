import fs from "fs";
import path from "path";

const SRC = "scripts/_cp_src";
const DST = "src/excalidraw-color-picker";
fs.mkdirSync(DST, { recursive: true });

// native files import Excalidraw-internal modules via relative paths; redirect
// every one of those to our local _shims module (single source of truth).
const rewriteMap = [
  ["../../editor-jotai", "./_shims"],
  ["../../i18n", "./_shims"],
  ["../App", "./_shims"],
  ["../ButtonSeparator", "./_shims"],
  ["../EyeDropper", "./_shims"],
  ["../PropertiesPopover", "./_shims"],
  ["../icons", "./_shims"],
  ["../../hooks/useTextEditorFocus", "./_shims"],
  ["../..//shortcut", "./_shims"],
  ["../../types", "./_shims"],
];

function rewriteImports(code) {
  for (const [from, to] of rewriteMap) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(from\\s*[\\"'])${escaped}([\\"'])`, "g");
    code = code.replace(re, `$1${to}$2`);
  }
  return code;
}

const files = [
  "ColorPicker.tsx",
  "Picker.tsx",
  "PickerColorList.tsx",
  "ShadeList.tsx",
  "HotkeyLabel.tsx",
  "ColorInput.tsx",
  "PickerHeading.tsx",
  "TopPicks.tsx",
  "CustomColorList.tsx",
  "keyboardNavHandlers.ts",
  "colorPickerUtils.ts",
  "topPicksDnD.tsx",
];

for (const f of files) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) {
    console.log("skip missing", f);
    continue;
  }
  let code = fs.readFileSync(p, "utf8");
  code = rewriteImports(code);
  // keep keyboardNavHandlers' ValueOf import (subpath resolves fine)
  fs.writeFileSync(path.join(DST, f), code);
  console.log("copied", f);
}

// ---- ColorPicker.scss: unwrap .excalidraw scope -> .painter-color-picker ----
const scss = path.join(SRC, "ColorPicker.scss");
if (fs.existsSync(scss)) {
  let s = fs.readFileSync(scss, "utf8");
  s = s.replace(/^\s*@use\s+"sass:color";\s*$/m, "");
  s = s.replace(
    /^\s*@use\s+"\.\.\/\.\.\/css\/variables\.module"\s+as\s+\*;\s*$/m,
    "",
  );
  s = s.replace(
    /color\.adjust\(#fff,\s*\$alpha:\s*-0\.75\)/g,
    "rgba(255, 255, 255, 0.25)",
  );
  s = s.replace(
    /color\.adjust\(#000,\s*\$alpha:\s*-0\.75\)/g,
    "rgba(0, 0, 0, 0.25)",
  );
  s = s.replace(
    /color\.adjust\(#000,\s*\$alpha:\s*-0\.9\)/g,
    "rgba(0, 0, 0, 0.1)",
  );
  s = s.replace(/^\.excalidraw\s*\{/m, ".painter-color-picker {");
  s = s.replace(/\.excalidraw\.theme--dark/g, ".painter-color-picker.theme--dark");
  fs.writeFileSync(path.join(DST, "ColorPicker.scss"), s);
  console.log("copied ColorPicker.scss (scope rewritten)");
}

console.log("DONE");
