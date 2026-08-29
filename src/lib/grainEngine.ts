// WebGL 颗粒笔迹渲染引擎
//
// 每个笔画先由 grainPens 生成粒子数组（场景坐标），这里用 WebGL2
// 实例化渲染：每个粒子是一个小四边形，片元着色器按笔型程序化生成
// 石墨颗粒 / 蜡质孔洞纹理。笔画保持为可重建的粒子数据，不转位图。

import { GRAIN_PARTICLE_STRIDE, type GrainPenType } from "./grainPens";
import type { Point } from "./shapeRecognition";

export interface GrainStrokeRecord {
  id: string;
  kind: GrainPenType;
  color: string;
  seed: number;
  points: Point[];
  pressures: number[];
  particles: Float32Array;
  count: number;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aQuad;
in vec2 aPos;
in float aSize;
in float aAlpha;
in float aSeed;
in float aKind;
in vec3 aColor;

uniform vec2 uScroll;
uniform float uZoom;
uniform vec2 uScreen;
uniform float uDpr;

out vec2 vUv;
out float vAlpha;
out float vSeed;
out float vKind;
out vec3 vColor;

void main() {
  vec2 screen = (aPos + uScroll) * uZoom;
  vec2 px = screen * uDpr + aQuad * aSize * uDpr;
  vec2 clip = px / uScreen * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  vUv = aQuad + 0.5;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vKind = aKind;
  vColor = aColor;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
in float vAlpha;
in float vSeed;
in float vKind;
in vec3 vColor;

out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv - 0.5;
  float d = length(uv);
  float a = 0.0;

  if (vKind < 0.5) {
    // 石墨铅笔：软边颗粒 + 微噪点 + 边缘毛边
    float core = smoothstep(0.5, 0.2, d);
    float grain = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 gp = uv * 24.0 + vec2(float(i) * 7.13, 3.71) + vSeed * 13.7;
      vec2 gcell = floor(gp);
      vec2 gfrac = fract(gp) - 0.5;
      float gd = length(gfrac);
      float gn = hash(gcell + vSeed);
      grain += step(0.52, gn) * smoothstep(0.26, 0.0, gd);
    }
    a = core * (0.7 + grain * 0.5);
    float edge = hash(uv * 16.0 + vSeed * 3.1);
    a *= mix(1.0, smoothstep(0.34, 0.5, d), step(0.58, edge) * step(0.26, d));
  } else {
    // 油画棒蜡笔：细胞内大蜡粒 + 随机孔洞
    float base = smoothstep(0.5, 0.28, d);
    vec2 cell = uv * 6.5 + 0.5;
    vec2 id = floor(cell);
    vec2 f = fract(cell) - 0.5;
    float minD = 1e3;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 o = vec2(float(i), float(j));
        vec2 seedPos = hash(id + o + vec2(vSeed * 17.3, vSeed * 7.7)) - 0.5;
        vec2 p = o + seedPos * 0.8;
        minD = min(minD, length(f - p));
      }
    }
    float wax = 1.0 - smoothstep(0.09, 0.28, minD);
    float hole = hash(id + vec2(vSeed * 9.1, vSeed * 3.3));
    float holeMask = step(0.78, hole);
    a = base * (0.16 + wax * 0.98) * (1.0 - holeMask * smoothstep(0.05, 0.24, minD));
  }

  outColor = vec4(vColor, clamp(a * vAlpha, 0.0, 1.0));
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建 WebGL 着色器");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "未知错误";
    gl.deleteShader(shader);
    throw new Error(`WebGL 着色器编译失败：${info}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("无法创建 WebGL 程序");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "未知错误";
    gl.deleteProgram(program);
    throw new Error(`WebGL 程序链接失败：${info}`);
  }
  return program;
}

export class GrainEngine {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private strokeBuffers = new Map<string, WebGLBuffer>();
  private strokeCounts = new Map<string, number>();
  private order: string[] = [];
  private previewBuffer: WebGLBuffer | null = null;
  private previewCount = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private attribs: Record<string, number> = {};
  private scrollX = 0;
  private scrollY = 0;
  private zoom = 1;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return;
    this.gl = gl;
    try {
      this.program = linkProgram(gl);
    } catch (err) {
      console.error(err);
      this.gl = null;
      return;
    }
    gl.useProgram(this.program);

    for (const name of ["uScroll", "uZoom", "uScreen", "uDpr"]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    for (const name of [
      "aQuad",
      "aPos",
      "aSize",
      "aAlpha",
      "aSeed",
      "aKind",
      "aColor",
    ]) {
      this.attribs[name] = gl.getAttribLocation(this.program, name);
    }

    // 单位四边形（两个三角形），局部坐标 -0.5..0.5
    const quad = new Float32Array([
      -0.5, -0.5,
      0.5, -0.5,
      -0.5, 0.5,
      -0.5, 0.5,
      0.5, -0.5,
      0.5, 0.5,
    ]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.attribs.aQuad);
    gl.vertexAttribPointer(this.attribs.aQuad, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  get supported(): boolean {
    return this.gl !== null;
  }

  setViewport(opts: {
    scrollX: number;
    scrollY: number;
    zoom: number;
    dpr: number;
    cssW: number;
    cssH: number;
  }) {
    this.scrollX = opts.scrollX;
    this.scrollY = opts.scrollY;
    this.zoom = opts.zoom;
    this.dpr = opts.dpr;
    const pxW = Math.max(1, Math.round(opts.cssW * opts.dpr));
    const pxH = Math.max(1, Math.round(opts.cssH * opts.dpr));
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
  }

  setStrokes(strokes: readonly GrainStrokeRecord[]) {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const nextOrder = strokes.map((s) => s.id);
    const wanted = new Set(nextOrder);
    // 释放已删除笔画的缓冲
    for (const id of [...this.strokeBuffers.keys()]) {
      if (!wanted.has(id)) {
        const buf = this.strokeBuffers.get(id);
        if (buf) gl.deleteBuffer(buf);
        this.strokeBuffers.delete(id);
        this.strokeCounts.delete(id);
      }
    }
    // 新笔画上传粒子缓冲
    for (const stroke of strokes) {
      if (!this.strokeBuffers.has(stroke.id)) {
        const buf = gl.createBuffer();
        if (!buf) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          stroke.particles,
          gl.STATIC_DRAW,
        );
        this.strokeBuffers.set(stroke.id, buf);
        this.strokeCounts.set(stroke.id, stroke.count);
      }
    }
    this.order = nextOrder;
  }

  setPreview(particles: Float32Array | null, count: number) {
    const gl = this.gl;
    if (!gl) return;
    if (this.previewBuffer) {
      gl.deleteBuffer(this.previewBuffer);
      this.previewBuffer = null;
    }
    this.previewCount = 0;
    if (!particles || count === 0) return;
    const buf = gl.createBuffer();
    if (!buf) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, particles, gl.DYNAMIC_DRAW);
    this.previewBuffer = buf;
    this.previewCount = count;
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.program || !this.quadVao) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.uScroll, this.scrollX, this.scrollY);
    gl.uniform1f(this.uniforms.uZoom, this.zoom);
    gl.uniform2f(
      this.uniforms.uScreen,
      this.canvas.width,
      this.canvas.height,
    );
    gl.uniform1f(this.uniforms.uDpr, this.dpr);
    gl.bindVertexArray(this.quadVao);

    for (const id of this.order) {
      const buf = this.strokeBuffers.get(id);
      const count = this.strokeCounts.get(id) ?? 0;
      if (buf && count > 0) this.drawInstanced(buf, count);
    }
    if (this.previewBuffer && this.previewCount > 0) {
      this.drawInstanced(this.previewBuffer, this.previewCount);
    }
    gl.bindVertexArray(null);
  }

  private drawInstanced(buffer: WebGLBuffer, count: number) {
    const gl = this.gl;
    if (!gl) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = GRAIN_PARTICLE_STRIDE * 4;
    gl.enableVertexAttribArray(this.attribs.aPos);
    gl.vertexAttribPointer(this.attribs.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(this.attribs.aPos, 1);
    gl.enableVertexAttribArray(this.attribs.aSize);
    gl.vertexAttribPointer(this.attribs.aSize, 1, gl.FLOAT, false, stride, 8);
    gl.vertexAttribDivisor(this.attribs.aSize, 1);
    gl.enableVertexAttribArray(this.attribs.aAlpha);
    gl.vertexAttribPointer(this.attribs.aAlpha, 1, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(this.attribs.aAlpha, 1);
    gl.enableVertexAttribArray(this.attribs.aSeed);
    gl.vertexAttribPointer(this.attribs.aSeed, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(this.attribs.aSeed, 1);
    gl.enableVertexAttribArray(this.attribs.aKind);
    gl.vertexAttribPointer(this.attribs.aKind, 1, gl.FLOAT, false, stride, 20);
    gl.vertexAttribDivisor(this.attribs.aKind, 1);
    gl.enableVertexAttribArray(this.attribs.aColor);
    gl.vertexAttribPointer(this.attribs.aColor, 3, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(this.attribs.aColor, 1);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  }

  clear() {
    const gl = this.gl;
    if (gl) {
      for (const buf of this.strokeBuffers.values()) gl.deleteBuffer(buf);
      if (this.previewBuffer) gl.deleteBuffer(this.previewBuffer);
    }
    this.strokeBuffers.clear();
    this.strokeCounts.clear();
    this.order = [];
    this.previewBuffer = null;
    this.previewCount = 0;
  }

  destroy() {
    const gl = this.gl;
    if (gl) {
      this.clear();
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.quadVao) gl.deleteVertexArray(this.quadVao);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.program = null;
  }
}
