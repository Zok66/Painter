// 场景内自研颗粒渲染器
//
// 由 scripts/patch-excalidraw.mjs 注入的钩子调用：铅笔 / 蜡笔以普通
// freedraw 元素存在于 Excalidraw 场景中（撤销、选择、橡皮擦全部原生生效），
// 只是渲染时改走这里的颗粒引擎。粒子用共享 WebGL 离屏画布绘制后贴回
// 场景上下文，WebGL 不可用时自动降级为 2D 粒子。

import {
  GRAIN_PARTICLE_STRIDE,
  buildGrainParticles,
  paintGrainParticles2D,
} from "./grainPens";
import { GrainEngine } from "./grainEngine";
import type { ExcalidrawFreeDrawElement } from "@excalidraw/excalidraw/element/types";

interface GrainElementData {
  grainKind: "pencil" | "crayon";
  grainSeed: number;
}

const GL_CANVAS_SIZE = 4096;

class GrainElementRenderer {
  private glCanvas: HTMLCanvasElement | null = null;
  private engine: GrainEngine | null = null;
  private useWebgl = true;

  private ensureEngine() {
    if (this.glCanvas) return;
    const canvas = document.createElement("canvas");
    canvas.width = GL_CANVAS_SIZE;
    canvas.height = GL_CANVAS_SIZE;
    this.glCanvas = canvas;
    const engine = new GrainEngine(canvas);
    this.engine = engine;
    this.useWebgl = engine.supported;
  }

  render(
    element: ExcalidrawFreeDrawElement,
    context: CanvasRenderingContext2D,
  ) {
    const data = element.customData as GrainElementData | undefined;
    if (!data || (data.grainKind !== "pencil" && data.grainKind !== "crayon")) {
      return;
    }
    const pressures = element.pressures as number[] | undefined;
    if (!pressures || pressures.length === 0) return;

    this.ensureEngine();
    const points = element.points.map(([x, y]) => ({ x, y }));
    let particles: Float32Array;
    try {
      particles = buildGrainParticles(
        points,
        pressures,
        data.grainKind,
        element.strokeColor,
        data.grainSeed,
      );
    } catch (err) {
      console.error("自研颗粒生成失败：", err);
      return;
    }
    const count = particles.length / GRAIN_PARTICLE_STRIDE;
    if (count === 0) return;

    // 钩子收到的 context 是 Excalidraw 元素离屏画布（element-local 空间），
    // 之后由 Excalidraw 用 drawImage(offscreen, element.x, element.y) 贴回主画布。
    // 因此这里直接用局部坐标绘制即可，**不要再 context.translate(element.x/y)**，
    // 否则会双重平移导致离屏越界、笔迹不可见。

    // 仅当 WebGL 引擎确实可用（着色器编译成功）才走 GPU 路径；
    // 否则回退 2D 兜底，避免静默画不出任何东西。
    const canWebgl =
      this.useWebgl && this.engine !== null && this.engine.supported;
    if (canWebgl) {
      try {
        this.renderWebgl(element, context, particles, count);
        return;
      } catch (err) {
        console.error("颗粒 WebGL 渲染失败，降级为 2D：", err);
        this.useWebgl = false;
      }
    }
    paintGrainParticles2D(context, particles, count);
  }

  /** SVG 导出：把粒子转成 `<circle>`，坐标沿用元素局部坐标 */
  renderSvg(
    element: ExcalidrawFreeDrawElement,
    doc: Document,
  ): SVGGElement | null {
    const data = element.customData as GrainElementData | undefined;
    if (!data || (data.grainKind !== "pencil" && data.grainKind !== "crayon")) {
      return null;
    }
    const pressures = element.pressures as number[] | undefined;
    if (!pressures || pressures.length === 0) return null;

    const points = element.points.map(([x, y]) => ({ x, y }));
    let particles: Float32Array;
    try {
      particles = buildGrainParticles(
        points,
        pressures,
        data.grainKind,
        element.strokeColor,
        data.grainSeed,
      );
    } catch (err) {
      console.error("自研颗粒 SVG 生成失败：", err);
      return null;
    }
    const count = particles.length / GRAIN_PARTICLE_STRIDE;
    if (count === 0) return null;

    const NS = "http://www.w3.org/2000/svg";
    const g = doc.createElementNS(NS, "g");
    for (let i = 0; i < count; i++) {
      const o = i * GRAIN_PARTICLE_STRIDE;
      const circle = doc.createElementNS(NS, "circle");
      circle.setAttribute("cx", particles[o].toFixed(2));
      circle.setAttribute("cy", particles[o + 1].toFixed(2));
      circle.setAttribute("r", (particles[o + 2] / 2).toFixed(2));
      circle.setAttribute(
        "fill",
        `rgba(${particles[o + 6]},${particles[o + 7]},${particles[o + 8]},${particles[o + 3].toFixed(3)})`,
      );
      g.appendChild(circle);
    }
    return g;
  }

  private renderWebgl(
    element: ExcalidrawFreeDrawElement,
    context: CanvasRenderingContext2D,
    particles: Float32Array,
    count: number,
  ) {
    const data = element.customData as GrainElementData;
    const pad = data.grainKind === "pencil" ? 10 : 18;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const o = i * GRAIN_PARTICLE_STRIDE;
      const r = particles[o + 2] / 2;
      const x = particles[o];
      const y = particles[o + 1];
      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (x + r > maxX) maxX = x + r;
      if (y + r > maxY) maxY = y + r;
    }
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    if (width <= 0 || height <= 0) return;
    const scale = Math.min(1, GL_CANVAS_SIZE / width, GL_CANVAS_SIZE / height);

    const shifted = new Float32Array(particles.length);
    for (let i = 0; i < count; i++) {
      const o = i * GRAIN_PARTICLE_STRIDE;
      shifted[o] = (particles[o] - minX + pad) * scale;
      shifted[o + 1] = (particles[o + 1] - minY + pad) * scale;
      shifted[o + 2] = particles[o + 2] * scale;
      shifted[o + 3] = particles[o + 3];
      shifted[o + 4] = particles[o + 4];
      shifted[o + 5] = particles[o + 5];
      shifted[o + 6] = particles[o + 6];
      shifted[o + 7] = particles[o + 7];
      shifted[o + 8] = particles[o + 8];
    }

    const engine = this.engine!;
    const canvas = this.glCanvas!;
    engine.setViewport({
      scrollX: 0,
      scrollY: 0,
      zoom: 1,
      dpr: 1,
      cssW: GL_CANVAS_SIZE,
      cssH: GL_CANVAS_SIZE,
    });
    engine.setPreview(shifted, count);
    engine.render();
    // 源矩形只取颗粒内容占用的区域（与缩放后尺寸一致），避免把整张 4096²
    // GL 画布非均匀拉伸到目标矩形导致笔迹错位 / 压扁。
    const srcW = Math.min(canvas.width, Math.round(width * scale));
    const srcH = Math.min(canvas.height, Math.round(height * scale));
    context.drawImage(
      canvas,
      0,
      0,
      srcW,
      srcH,
      minX - pad,
      minY - pad,
      width,
      height,
    );
  }
}

const renderer = new GrainElementRenderer();

/** 注册到 window，供 Excalidraw 渲染钩子调用 */
export function installGrainElementRenderer() {
  const w = window as unknown as Record<string, unknown>;
  w.__painterGrainElementRender = (
    element: ExcalidrawFreeDrawElement,
    context: CanvasRenderingContext2D,
  ) => renderer.render(element, context);
  w.__painterGrainSvgRender = (
    element: ExcalidrawFreeDrawElement,
    doc: Document,
  ) => renderer.renderSvg(element, doc);
}
