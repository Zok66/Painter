// gifenc 没有官方类型定义，这里按其 README 与源码手写最小声明。

declare module "gifenc" {
  export interface GIFEncoderOptions {
    /** 自动在首帧写入逻辑屏幕描述符（默认 true） */
    auto?: boolean;
    initialCapacity?: number;
  }

  export interface WriteFrameOptions {
    /** 该帧使用的调色板（每项为 [r,g,b]） */
    palette?: number[][];
    /** 帧停留时长，单位 1/100 秒 */
    delay?: number;
    /** 是否启用单色透明 */
    transparent?: boolean;
    /** 透明色在调色板中的索引 */
    transparentIndex?: number;
    /** 循环次数，0 = 无限；只需在第一帧设置 */
    repeat?: number;
    /** 帧处置方式 */
    dispose?: number;
    first?: boolean;
  }

  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: GIFEncoderOptions): GIFEncoderInstance;

  export interface QuantizeOptions {
    /** 颜色格式：rgb565 | rgb444 | rgba4444 */
    format?: string;
    /** 把半透明像素归并到单色透明索引 */
    oneBitAlpha?: boolean | number;
    /** 是否把 alpha 低于阈值的像素清零 */
    clearAlpha?: boolean;
  }

  // 注意：运行时必须是 flat 的 Uint8Array / Uint8ClampedArray（逐字节 RGBA），
  // 传 Uint32Array 会让 gifenc 抛错。ImageData.data 是 Uint8ClampedArray，正好可用。
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions,
  ): number[][];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
