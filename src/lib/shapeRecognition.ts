// 手绘轨迹的形状识别器
// 在 Excalidraw 原有的矩特征思路上增加角点检测，从而支持三角形、五角星等更多形状。
// Excalidraw 内置识别器只认 rectangle / diamond / ellipse / arrow / line，
// 这也是画三角形被误判成菱形的原因：三角形没有对应的原型，只能落到最近的菱形。

export interface Point {
  x: number;
  y: number;
}

export type RecognizedShapeType =
  | "line"
  | "arrow"
  | "rectangle"
  | "diamond"
  | "ellipse"
  | "triangle"
  | "star5"
  | "pentagon"
  | "hexagon"
  | "freedraw";

export interface RecognitionResult {
  type: RecognizedShapeType;
  // 包围盒 [minX, minY, maxX, maxY]，用于矩形 / 菱形 / 椭圆
  bbox: [number, number, number, number];
  // 多边形顶点（全局坐标），用于三角形 / 五角星 / 五边形 / 六边形
  polygon: Point[];
  // 首尾点（全局坐标），用于直线 / 箭头
  start: Point;
  end: Point;
}

const RESAMPLE_N = 64;
// 转角峰值低于该角度（弧度）就不算角点
const CORNER_ANGLE_THRESHOLD = 0.28;
const OPEN_GAP_RATIO = 0.15;
const LINEAR_MAX_ELONGATION = 0.25;
const LINEAR_MAX_SHAFT_DEVIATION = 0.15;
const ARROW_MIN_SKEW = 0.3;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function getBBox(points: Point[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [minX, minY, maxX, maxY];
}

// 沿轨迹等距重采样，消除落笔速度造成的采样密度偏差
function resample(points: Point[], n: number): Point[] {
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    totalLen += dist(points[i - 1], points[i]);
  }
  if (totalLen === 0) {
    return Array.from({ length: n }, () => ({ ...points[0] }));
  }

  // 除以 n 而不是 n-1：让闭合曲线的首尾之间保留一个采样间隔，
  // 避免首尾点重合导致角点检测在接缝处退化。
  const interval = totalLen / n;
  const result: Point[] = [points[0]];
  let accumulated = 0;
  let prev = points[0];

  for (let i = 1; i < points.length; i++) {
    const curr = points[i];
    const segLen = dist(prev, curr);
    if (accumulated + segLen >= interval) {
      let remaining = interval - accumulated;
      while (remaining <= segLen + 1e-10) {
        const t = remaining / segLen;
        result.push({
          x: prev.x + t * (curr.x - prev.x),
          y: prev.y + t * (curr.y - prev.y),
        });
        if (result.length === n) return result;
        prev = result[result.length - 1];
        accumulated = 0;
        remaining += interval;
      }
      accumulated = segLen - (remaining - interval);
    } else {
      accumulated += segLen;
    }
    prev = curr;
  }

  while (result.length < n) {
    result.push({ ...points[points.length - 1] });
  }
  return result;
}

interface Corner {
  index: number;
  turn: number;
  point: Point;
}

// 用带符号转角检测角点。闭合曲线按轮廓顺序绕行时，
// 凸角与凹角的转角符号相反，五角星正是 5 凸 + 5 凹交替。
interface CornerDetection {
  corners: Corner[];
  totalTurn: number;
}

function detectCorners(points: Point[]): CornerDetection {
  const n = points.length;
  // 相邻点局部转角。闭合曲线按轮廓绕行时，凸角与凹角符号相反，
  // 五角星正是 5 凸 + 5 凹交替。
  const turns: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    const v1x = b.x - a.x;
    const v1y = b.y - a.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    turns.push(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y));
  }

  // 贪心取转角峰值，并吞并其小邻域，避免同一物理角点被重复计数
  const corners: Corner[] = [];
  const taken = new Array<boolean>(n).fill(false);
  const mergeRadius = 2;
  let totalTurn = 0;
  for (const t of turns) totalTurn += Math.abs(t);
  while (true) {
    let best = -1;
    let bestAbs = CORNER_ANGLE_THRESHOLD;
    for (let i = 0; i < n; i++) {
      if (!taken[i] && Math.abs(turns[i]) > bestAbs) {
        bestAbs = Math.abs(turns[i]);
        best = i;
      }
    }
    if (best < 0) break;
    corners.push({ index: best, turn: turns[best], point: points[best] });
    for (let k = best - mergeRadius; k <= best + mergeRadius; k++) {
      taken[(k + n) % n] = true;
    }
  }
  corners.sort((a, b) => a.index - b.index);
  return { corners, totalTurn };
}

interface PrincipalAxes {
  cx: number;
  cy: number;
  mx: number;
  my: number;
  majorVariance: number;
  minorVariance: number;
}

// 2x2 协方差矩阵的主成分分析，用于开放笔迹的直线 / 箭头判断
function pca(points: Point[]): PrincipalAxes {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  let m20 = 0;
  let m02 = 0;
  let m11 = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    m20 += dx * dx;
    m02 += dy * dy;
    m11 += dx * dy;
  }
  m20 /= n;
  m02 /= n;
  m11 /= n;

  const trace = m20 + m02;
  const diff = Math.hypot(m20 - m02, 2 * m11);
  const majorVariance = (trace + diff) / 2;
  const minorVariance = (trace - diff) / 2;

  let mx: number;
  let my: number;
  if (Math.abs(m11) > 1e-9) {
    const len = Math.hypot(majorVariance - m02, m11);
    mx = (majorVariance - m02) / len;
    my = m11 / len;
  } else {
    mx = m20 >= m02 ? 1 : 0;
    my = m20 >= m02 ? 0 : 1;
  }

  return { cx, cy, mx, my, majorVariance, minorVariance };
}

// 点在主轴投影上的三阶标准矩（偏度）。箭头因为有箭头质量分布，偏度更大。
function majorSkew(points: Point[], axes: PrincipalAxes): number {
  const u = points.map(
    (p) => (p.x - axes.cx) * axes.mx + (p.y - axes.cy) * axes.my,
  );
  const n = u.length;
  let mean = 0;
  for (const v of u) mean += v;
  mean /= n;
  let variance = 0;
  let m3 = 0;
  for (const v of u) {
    const d = v - mean;
    variance += d * d;
    m3 += d * d * d;
  }
  variance /= n;
  m3 /= n;
  const sigma = Math.sqrt(variance);
  return sigma > 1e-9 ? m3 / sigma ** 3 : 0;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

// 点到“起点-尖端”弦的最大偏离，用于排除折线 / 弧线 / 锯齿
function shaftDeviationRatio(points: Point[]): number {
  const start = points[0];
  let tip = start;
  let tipDistance = 0;
  for (const p of points) {
    const d = dist(start, p);
    if (d > tipDistance) {
      tipDistance = d;
      tip = p;
    }
  }
  if (tipDistance === 0) return 0;
  let maxDeviation = 0;
  for (const p of points) {
    if (dist(tip, p) <= 0.5 * tipDistance) continue;
    maxDeviation = Math.max(maxDeviation, distanceToSegment(p, start, tip));
  }
  return maxDeviation / tipDistance;
}

function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(sum / 2);
}

function classifyClosed(
  detection: CornerDetection,
  bbox: [number, number, number, number],
): RecognizedShapeType {
  const corners = detection.corners;
  const count = corners.length;
  if (count === 0) return "ellipse";

  // 转角集中度：椭圆的转向均匀分布在整个轮廓上，多边形的转向集中在角点。
  // 手绘噪声会在圆上制造少量伪峰值，用这一条把它们挡回椭圆。
  const cornerTurn = corners.reduce((s, c) => s + Math.abs(c.turn), 0);
  const turnShare =
    detection.totalTurn > 0 ? cornerTurn / detection.totalTurn : 0;
  if (turnShare < 0.45) return "ellipse";

  const positive = corners.filter((c) => c.turn > 0).length;
  const negative = count - positive;
  const convex = positive === 0 || negative === 0;

  if (convex) {
    if (count === 3) return "triangle";
    if (count === 4) {
      const area = polygonArea(corners.map((c) => c.point));
      const boxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
      const fill = boxArea > 0 ? area / boxArea : 0;
      return fill > 0.75 ? "rectangle" : "diamond";
    }
    if (count === 5) return "pentagon";
    if (count === 6) return "hexagon";
  }

  // 星形：外尖与内凹交替，因此凸角与凹角数量接近。
  // 闭合接缝偶尔会吞掉一个角点，所以这里放宽为 8~11 个角点。
  if (count >= 8 && count <= 11 && positive >= 4 && negative >= 4) {
    return "star5";
  }

  // 角点太多通常是抖动出的椭圆或复杂涂鸦，退回 freedraw 而不是硬凑
  return count >= 7 ? "freedraw" : "ellipse";
}

const polygonTypes = new Set<RecognizedShapeType>([
  "triangle",
  "star5",
  "pentagon",
  "hexagon",
]);

export function recognizeShape(points: Point[]): RecognitionResult {
  const bbox = getBBox(points);
  const result: RecognitionResult = {
    type: "freedraw",
    bbox,
    polygon: [],
    start: points[0],
    end: points[points.length - 1],
  };

  if (points.length < 3) return result;

  const pts = resample(points, RESAMPLE_N);

  let pathLength = 0;
  for (let i = 1; i < pts.length; i++) {
    pathLength += dist(pts[i - 1], pts[i]);
  }
  const gapRatio =
    pathLength > 0 ? dist(pts[0], pts[pts.length - 1]) / pathLength : 0;

  if (gapRatio > OPEN_GAP_RATIO) {
    const axes = pca(pts);
    const elongation =
      axes.majorVariance > 0 ? axes.minorVariance / axes.majorVariance : 1;
    if (
      elongation <= LINEAR_MAX_ELONGATION &&
      shaftDeviationRatio(pts) <= LINEAR_MAX_SHAFT_DEVIATION
    ) {
      result.type = Math.abs(majorSkew(pts, axes)) >= ARROW_MIN_SKEW ? "arrow" : "line";
    }
    return result;
  }

  const detection = detectCorners(pts);
  result.type = classifyClosed(detection, bbox);
  if (polygonTypes.has(result.type)) {
    result.polygon = detection.corners.map((c) => c.point);
  }
  return result;
}
