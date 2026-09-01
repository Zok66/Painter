import "react";

// Native Excalidraw ColorPicker passes CSS custom properties (e.g.
// `--swatch-color`) through inline `style` objects. Augment React's
// `CSSProperties` so the type checker accepts arbitrary `--*` keys.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}
