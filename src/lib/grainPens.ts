// 自研石墨铅笔 / 油画棒蜡笔粒子生成器
//
// 每一笔都被离散成数百个带随机深浅、位移、大小的粒子（场景坐标），
// 由 WebGL 引擎实例化渲染。粒子数据可重新生成、可序列化保存，
// 不做任何 PNG / image 元素转换，缩放与导出也不会发生位图拉伸。

import type { Point } from "./shapeRecognition";

export type GrainPenType = "pencil" | "crayon";

export interface GrainStrokeSpec {
  kind: GrainPenType;
  points: Point[];
  pressures: number[];
  color: string;
  seed: number;
}

/** 每个粒子的浮点布局：x, y, 直径, alpha, seed, kind, r, g, b */
export const GRAIN_PARTICLE_STRIDE = 9;

function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** 可重复的伪随机序列：同一笔画每次重建粒子完全一致 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseRgb(color: string): [number, number, number] {
  const c = color.trim().toLowerCase();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1];
    const full =
      h.length === 3
        ? h
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : h;
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ];
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return [30, 30, 30];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * 按笔型计算每个采样点的压力（0~1，越大越重）。
 * 没有压感笔时用速度模拟：画得慢 = 用力按，画得快 = 轻轻带过，
 * 再叠加成簇噪声让同一笔画内的轻重分布不规律。
 */
export function computeGrainPressures(
  points: Point[],
  kind: GrainPenType,
): number[] {
  const n = points.length;
  if (n === 0) return [];
  const pressures = new Array<number>(n);
  const SPEED_FULL = 12;
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    const speed = Math.hypot(next.x - prev.x, next.y - prev.y) / 2;
    const speedNorm = Math.min(1, speed / SPEED_FULL);
    const cluster = hash01(Math.floor(i / 4) * 7.13 + (kind === "pencil" ? 1.7 : 9.2));
    const fine = hash01(i * 1.31 + (kind === "pencil" ? 3.7 : 5.3));
    let p: number;
    if (kind === "pencil") {
      p = 0.88 - speedNorm * 0.62 + (cluster - 0.5) * 0.28 + (fine - 0.5) * 0.12;
    } else {
      p = 0.94 - speedNorm * 0.54 + (cluster - 0.5) * 0.3 + (fine - 0.5) * 0.14;
    }
    pressures[i] = Math.min(1, Math.max(0.12, p));
  }
  // 起笔 / 收笔略轻，模拟真实落笔的渐入渐出
  const fade = Math.min(5, n);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    pressures[i] *= 0.65 + t * 0.35;
    pressures[n - 1 - i] *= 0.65 + t * 0.35;
  }
  return pressures;
}

/** 把一条轨迹生成成粒子数组（Float32Array），count = length / stride */
export function buildGrainParticles(
  points: Point[],
  pressures: number[],
  kind: GrainPenType,
  color: string,
  seed: number,
): Float32Array {
  const out: number[] = [];
  if (points.length === 0 || pressures.length === 0) {
    return new Float32Array(0);
  }

  const rgb = parseRgb(color);
  const luma = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  // 深色（B 类石墨）颗粒更浓，浅色（H 类）更淡；蜡笔不压暗
  const inkScale = kind === "pencil" ? 1.45 - luma * 0.62 : 1;
  const kindFlag = kind === "pencil" ? 0 : 1;
  const rng = mulberry32(seed);

  const emit = (
    x: number,
    y: number,
    radius: number,
    alpha: number,
    tone: number,
  ) => {
    out.push(
      x,
      y,
      Math.max(0.2, radius * 2),
      Math.min(1, Math.max(0.003, alpha)),
      rng(),
      kindFlag,
      clamp255(rgb[0] * tone),
      clamp255(rgb[1] * tone),
      clamp255(rgb[2] * tone),
    );
  };

  // 单点落笔：一小团石墨粉 / 一小块蜡
  if (points.length === 1) {
    const x = points[0].x;
    const y = points[0].y;
    const pressure = pressures[0];
    if (kind === "pencil") {
      const count = 8 + Math.floor(rng() * 7);
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const dist = rng() * 2.4;
        emit(
          x + Math.cos(a) * dist,
          y + Math.sin(a) * dist,
          0.3 + rng() * 1.1,
          (0.14 + rng() * 0.18) * inkScale,
          0.88 + rng() * 0.24,
        );
      }
    } else {
      const size = 6 + pressure * 6;
      const count = 6 + Math.floor(rng() * 5);
      for (let i = 0; i < count; i++) {
        const a = rng() * Math.PI * 2;
        const dist = rng() * size * 0.55;
        emit(
          x + Math.cos(a) * dist,
          y + Math.sin(a) * dist,
          size * (0.16 + rng() * 0.24),
          0.28 + rng() * 0.3,
          0.9 + rng() * 0.2,
        );
      }
    }
    return new Float32Array(out);
  }

  // 弧长参数化，避免采样密度差异造成颗粒稀密不均
  const cum = new Array<number>(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] =
      cum[i - 1] +
      Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  const total = cum[cum.length - 1];
  if (total <= 0.0001) {
    const last = points[points.length - 1];
    return buildGrainParticles([last], [pressures[pressures.length - 1]], kind, color, seed);
  }

  const speeds = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    speeds[i] = Math.hypot(next.x - prev.x, next.y - prev.y) / 2;
  }

  const SPEED_FULL = 12;
  let d = 0;
  let counter = 0;
  let prevAngle = 0;

  while (d < total - 1e-6) {
    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const segLen = cum[hi] - cum[lo] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[lo]) / segLen));
    const x = points[lo].x + (points[hi].x - points[lo].x) * t;
    const y = points[lo].y + (points[hi].y - points[lo].y) * t;
    const pressure = pressures[lo] + (pressures[hi] - pressures[lo]) * t;
    const speed = speeds[lo] + (speeds[hi] - speeds[lo]) * t;
    const speedNorm = Math.min(1, speed / SPEED_FULL);
    const angle = Math.atan2(
      points[hi].y - points[lo].y,
      points[hi].x - points[lo].x,
    );
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);

    // 蜡笔转角堆积：转弯处多压几团蜡，形成块状毛刺
    if (counter > 0 && kind === "crayon") {
      let turn = Math.abs(angle - prevAngle);
      while (turn > Math.PI) turn = Math.PI * 2 - turn;
      if (turn > 0.5) {
        const size = 6.5 + pressure * 6.5;
        const count = 2 + Math.floor(rng() * 2);
        for (let i = 0; i < count; i++) {
          const a = rng() * Math.PI * 2;
          const dist = rng() * size * 0.5;
          emit(
            x + Math.cos(a) * dist,
            y + Math.sin(a) * dist,
            size * (0.2 + rng() * 0.26),
            0.32 + rng() * 0.38,
            0.88 + rng() * 0.24,
          );
        }
      }
    }
    prevAngle = angle;

    if (kind === "pencil") {
      const gap = 1.1 + speedNorm * 1.9 + (1 - pressure) * 0.7;
      const skip = Math.min(
        0.55,
        0.04 + speedNorm * 0.36 + (1 - pressure) * 0.12 + (rng() - 0.5) * 0.18,
      );
      if (rng() < skip) {
        // 快速 / 轻压时只留细碎石墨断点
        const count = 1 + Math.floor(rng() * 2) + (speedNorm > 0.65 ? 1 : 0);
        for (let i = 0; i < count; i++) {
          const a = rng() * Math.PI * 2;
          const dist = 0.5 + rng() * (3.5 + speedNorm * 2.5);
          emit(
            x + Math.cos(a) * dist,
            y + Math.sin(a) * dist,
            0.18 + rng() * (0.75 + pressure * 0.5),
            (0.05 + rng() * 0.13) * inkScale,
            0.86 + rng() * 0.28,
          );
        }
      } else {
        // 主石墨颗粒
        const n = hash01(counter * 7.31 + seed);
        const edgeJitter = (rng() - 0.5) * (1.5 + speedNorm * 3.4);
        const alongJitter = (rng() - 0.5) * (0.8 + pressure * 0.7);
        const cx = x + nx * edgeJitter + Math.cos(angle) * alongJitter;
        const cy = y + ny * edgeJitter + Math.sin(angle) * alongJitter;
        const radius = (1.0 + pressure * 1.7) * (0.68 + n * 0.64);
        const alpha = (0.2 + pressure * 0.3) * inkScale * (0.62 + n * 0.76);
        const tone = 0.9 + n * 0.2;
        emit(cx, cy, radius, alpha, tone);

        // 周围细石墨粉，快速时更多
        const dustCount = 1 + (rng() < 0.55 ? 1 : 0) + (speedNorm > 0.55 ? 1 : 0);
        for (let k = 0; k < dustCount; k++) {
          const dA = rng() * Math.PI * 2;
          const dDist = 0.6 + rng() * (2 + pressure * 2.4);
          emit(
            cx + Math.cos(dA) * dDist,
            cy + Math.sin(dA) * dDist,
            0.2 + rng() * (0.55 + pressure * 0.7),
            (0.07 + rng() * 0.16) * inkScale,
            0.86 + rng() * 0.28,
          );
        }

        // 快速拖动时沿运动方向留一点拖尾，线条更毛
        if (speedNorm > 0.55) {
          const tailDist = 0.8 + speedNorm * 1.5;
          emit(
            cx - Math.cos(angle) * tailDist,
            cy - Math.sin(angle) * tailDist,
            radius * 0.7,
            alpha * 0.45,
            tone,
          );
        }
      }
      d += Math.max(0.5, gap);
    } else {
      const gap = 2.4 + speedNorm * 3.8 + (1 - pressure) * 1.6;
      const skip = Math.min(
        0.6,
        0.06 + speedNorm * 0.4 + (1 - pressure) * 0.16 + (rng() - 0.5) * 0.18,
      );
      if (rng() < skip) {
        // 轻压 / 快速时笔触破碎断续
        const count = 1 + Math.floor(rng() * 3);
        const size = 6 + pressure * 6;
        for (let i = 0; i < count; i++) {
          const a = rng() * Math.PI * 2;
          const dist = rng() * size * 0.85;
          emit(
            x + Math.cos(a) * dist,
            y + Math.sin(a) * dist,
            size * (0.12 + rng() * 0.24),
            0.14 + rng() * 0.26,
            0.9 + rng() * 0.2,
          );
        }
      } else {
        const n = hash01(counter * 3.17 + seed);
        const size = (6.5 + pressure * 6.5) * (0.72 + n * 0.56);
        const edgeJitter = (rng() - 0.5) * (2 + speedNorm * 3);
        const cx = x + nx * edgeJitter;
        const cy = y + ny * edgeJitter;

        // 主团：多个蜡粒聚在一起，重压时颗粒更多、堆叠更厚
        const grains = 4 + Math.floor(rng() * 3) + Math.floor(pressure * 2);
        for (let k = 0; k < grains; k++) {
          const gx = cx + (rng() - 0.5) * size * 1.05;
          const gy = cy + (rng() - 0.5) * size * 1.05;
          emit(
            gx,
            gy,
            size * (0.28 + rng() * 0.3) * (0.75 + pressure * 0.35),
            (0.3 + pressure * 0.4) * (0.55 + rng() * 0.7),
            0.88 + rng() * 0.24,
          );
        }

        // 边缘碎蜡块，让轮廓凹凸不齐
        if (rng() < 0.55) {
          const side = rng() < 0.5 ? -1 : 1;
          const bA = rng() * Math.PI * 2;
          const bDist = size * (0.4 + rng() * 0.6);
          emit(
            cx + Math.cos(bA) * bDist * side * 0.4 + side * ny * bDist * 0.5,
            cy + Math.sin(bA) * bDist * side * 0.4 - side * nx * bDist * 0.5,
            size * (0.16 + rng() * 0.26),
            0.2 + rng() * 0.3,
            0.9 + rng() * 0.2,
          );
        }
      }
      d += Math.max(0.7, gap);
    }
    counter++;
  }

  return new Float32Array(out);
}

/** 2D 兜底渲染器（WebGL 不可用时预览 / 导出合成用），调用方需先设置视口变换 */
export function paintGrainParticles2D(
  ctx: CanvasRenderingContext2D,
  particles: Float32Array,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const o = i * GRAIN_PARTICLE_STRIDE;
    const x = particles[o];
    const y = particles[o + 1];
    const radius = particles[o + 2] / 2;
    const alpha = particles[o + 3];
    const seed = particles[o + 4];
    const kind = particles[o + 5];
    const r = particles[o + 6];
    const g = particles[o + 7];
    const b = particles[o + 8];

    if (kind < 0.5) {
      // 铅笔：软边石墨圆粒
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // 蜡笔：一个粒子由几颗蜡粒组成，留出缝隙模拟孔洞
    const grains = 3 + Math.floor(seed * 3);
    for (let k = 0; k < grains; k++) {
      const a = (seed * 37.7 + k * 2.399) % (Math.PI * 2);
      const dist = (hash01(seed * 17.1 + k * 3.7) - 0.5) * radius * 1.5;
      const gr = radius * (0.3 + hash01(seed * 9.3 + k * 1.1) * 0.42);
      const ga = alpha * (0.55 + hash01(seed * 23.9 + k * 0.7) * 0.45);
      ctx.fillStyle = `rgba(${r},${g},${b},${ga.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(
        x + Math.cos(a) * dist,
        y + Math.sin(a) * dist,
        Math.max(0.3, gr),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}
