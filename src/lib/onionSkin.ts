// 洋葱皮：把相邻帧的元素改造成「幽灵元素」注入当前场景
//
// 为什么走元素注入而不是位图叠加：
// 画布上的笔迹带自研颗粒渲染、竖排文字、字距行距这些补丁，全部挂在
// Excalidraw 自己的渲染路径上。只有让幽灵元素也走同一条路径，
// 洋葱皮才会和真实笔迹长得一模一样；位图叠加（exportToCanvas）会丢这些。
//
// 幽灵元素的三个特征：
// 1. id 带前缀  → 保存 / 切帧 / 导出前好剥离，不会污染场景
// 2. locked     → Excalidraw 命中测试直接跳过，选不中也改不动
// 3. 低 opacity → 越远的帧越淡
//
// 绑定关系一律断开（containerId / boundElements / startBinding / endBinding）：
// 跨帧引用另一帧的元素会指向不存在的 id，留着只会渲染错乱。

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { OnionConfig } from "./animation";

export const ONION_PREFIX = "painter-onion:";

export function isOnionElement(
  el: { id?: string } | null | undefined,
): boolean {
  return typeof el?.id === "string" && el.id.startsWith(ONION_PREFIX);
}

/** 剥掉幽灵元素，拿回这一帧真正的内容 */
export function stripOnionElements<T extends { id: string }>(
  elements: readonly T[],
): T[] {
  return elements.filter((el) => !isOnionElement(el));
}

function randomNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * 把一帧变成幽灵元素。
 * @param distance 与当前帧的距离（1 = 紧邻）
 * @param total    这一侧总共显示几帧，用来算衰减
 */
function ghostify(
  elements: readonly ExcalidrawElement[],
  distance: number,
  total: number,
  baseOpacity: number,
): ExcalidrawElement[] {
  // 越远越淡：紧邻那帧最实，最远那帧只剩一半左右，避免糊成一片
  const falloff = total <= 1 ? 1 : 1 - ((distance - 1) / total) * 0.5;
  const opacity = Math.max(3, Math.round(baseOpacity * falloff));

  return elements.map((el) => {
    const clone = JSON.parse(JSON.stringify(el)) as Record<string, unknown> & {
      id: string;
    };
    clone.id = `${ONION_PREFIX}${el.id}`;
    clone.opacity = opacity;
    clone.locked = true;
    clone.versionNonce = randomNonce();
    clone.boundElements = null;
    clone.containerId = null;
    clone.frameId = null;
    clone.startBinding = null;
    clone.endBinding = null;
    clone.groupIds = [];
    clone.link = null;
    return clone as unknown as ExcalidrawElement;
  });
}

export interface OnionInput {
  /** 当前帧元素（可能混着上一次注入的幽灵，内部会先剥干净） */
  current: readonly ExcalidrawElement[];
  /** 前面的帧，下标 0 是紧邻的前一帧 */
  before: readonly (readonly ExcalidrawElement[])[];
  /** 后面的帧，下标 0 是紧邻的后一帧 */
  after: readonly (readonly ExcalidrawElement[])[];
  config: OnionConfig;
}

/**
 * 拼出带洋葱皮的场景数组。
 * 幽灵全部排在当前帧之前（即渲染在当前帧下面），
 * 这样正在画的笔迹永远盖在参考影子上。
 */
export function composeSceneWithOnion({
  current,
  before,
  after,
  config,
}: OnionInput): ExcalidrawElement[] {
  const base = stripOnionElements(current);
  if (!config.enabled) return base;

  const ghosts: ExcalidrawElement[] = [];

  // 远的先塞（在更底层），近的后塞（离当前帧更近）
  for (let d = before.length; d >= 1; d--) {
    const frame = before[d - 1];
    if (frame?.length) ghosts.push(...ghostify(frame, d, before.length, config.opacity));
  }
  for (let d = 1; d <= after.length; d++) {
    const frame = after[d - 1];
    if (frame?.length) ghosts.push(...ghostify(frame, d, after.length, config.opacity));
  }

  return ghosts.length ? [...ghosts, ...base] : base;
}
