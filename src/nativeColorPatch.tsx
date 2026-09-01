import { ColorInput } from "./excalidraw-color-picker/ColorInput";

/**
 * 把自研 ColorInput 暴露给原生属性面板。
 *
 * 原生 Excalidraw 的 ColorPicker 弹窗中，「十六进制值」行使用原生 ColorInput，
 * 右侧只有一支铅笔 EyeDropper，点击会进入 Excalidraw 自己的取色状态（画布变暗）。
 * 这里通过 vite transform 把原生弹窗里的 ColorInput 调用替换为自研组件，
 * 从而在该行直接使用系统取色器 + 浏览器原生 EyeDropper API，不再触发原生取色状态。
 */
(window as unknown as Record<string, unknown>).__painterColorInput = ColorInput;
