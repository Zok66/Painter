# 笔迹填充（Bucket Fill 笔迹版）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 油漆桶工具支持 6 种填充风格（纯色/圆珠/钢笔/铅笔/蜡笔/荧光）：点击封闭区域，区域内部被所选笔的笔迹纹理铺满。

**Architecture:** 自研 `custom` 工具（`fill-bucket`）接管点击 → 调 `@excalidraw/element` 公开导出的 `computeBucketFillPolygon` 拿封闭区域 keyhole 环 → even-odd 扫描线在环内部生成排线区间 → 每区间一条带手抖的 freedraw 元素（复用 `pens.ts` 的 `buildFreedrawElement` 与颗粒渲染钩子）→ 组内元素共享 `groupIds` + `customData.fillGroup` 标记 → 一次 `updateScene(IMMEDIATELY)` 提交，撤销/选择/橡皮擦/导出全部原生兼容。

**Tech Stack:** React 19 + TypeScript + Vite、`@excalidraw/element`（新增显式依赖）、vitest（新增 devDep，用于纯函数单测）。

**设计文档:** `docs/superpowers/specs/2026-08-30-bucket-fill-stroke-texture-design.md`

**关键约束（执行者必读）:**
- `updateScene` 的 `appState` 是浅合并，绝不能把 `getAppState()` 整包回写。
- 颗粒通道字段为 `customData: { grainKind: "pencil" | "crayon", grainSeed: number }`（`src/lib/grainElementRenderer.ts` 读取），多加 `fillGroup` 字段不影响它。
- 所有新 UI 遵循项目惯例：扁平、直角、无阴影无渐变、选中态绿色。
- `buildFreedrawElement(points, appState, pen, id, strokeColor?, customData?)` 已存在，直接复用；不要改它。

---

## 文件结构

| 文件 | 操作 | 职责 |
| --- | --- | --- |
| `src/lib/fillStrokes.ts` | 新建 | 扫描线算法、抖动排线、`buildFillGroup` 纯函数 |
| `src/lib/fillStrokes.test.ts` | 新建 | vitest 单测（纯函数，无 DOM） |
| `src/lib/pens.ts` | 修改 | 导出 `buildFilledPolygon`（闭合多边形实心色块元素，solid/荧光填充共用） |
| `src/components/FillStyleBar.tsx` | 新建 | 填充风格条 UI |
| `src/components/FillStyleBar.css` | 新建 | 风格条样式（扁平直角绿色选中态） |
| `src/App.tsx` | 修改 | `FILL_TOOL` 注册、onPointerDown 填充分支、fillKind 状态持久化、portal 渲染 |
| `src/components/Toolbar.tsx` | 修改 | 油漆桶按钮 |
| `src/App.css` | 修改 | `.fill-active` 画布光标 |
| `package.json` | 修改 | `@excalidraw/element` 显式依赖 + vitest devDep |
| `docs/excalidraw-wiki.md` | 修改 | 追加"自研笔迹填充"章节 |

---

### Task 1: 依赖准备

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 确认 @excalidraw/element 已装版本并显式安装**

Run: `npm ls @excalidraw/element`
Expected: 显示已安装版本（应为主包同版本 `0.18.0-abeeaeb` 或兼容版本）。

然后以**查到的实际版本**精确安装：

```bash
npm i -S -E @excalidraw/element@0.18.0-abeeaeb
```

（若第 1 步查到的版本不是 `0.18.0-abeeaeb`，用查到的版本号替换。安装会触发 postinstall 补丁脚本，属正常。）

- [ ] **Step 2: 安装 vitest**

```bash
npm i -D vitest
```

若 peer dependency 与 vite 8 冲突报错，改用 `npm i -D vitest --legacy-peer-deps`。

- [ ] **Step 3: 确认 computeBucketFillPolygon 的 API 签名**

Read: `node_modules/@excalidraw/excalidraw/dist/types/element/src/bucketFill.d.ts`

确认成功分支的字段名（预期为 `{ ok: true, ownerId, boundaryElementIds, scenePoints, insertion }`，其中 `insertion = { placement: "above" | "below", elementId }`，`scenePoints` 为场景坐标点数组）。若字段名与本计划不符（如 `scenePoints` 叫别的名字），后续 Task 3/Task 5 的代码以 d.ts 实际字段为准做同名替换。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 显式依赖 @excalidraw/element 并引入 vitest"
```

---

### Task 2: fillStrokes.ts 扫描线核心（TDD）

**Files:**
- Create: `src/lib/fillStrokes.test.ts`
- Create: `src/lib/fillStrokes.ts`

- [ ] **Step 1: 写失败测试 `src/lib/fillStrokes.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { scanlineSegments } from "./fillStrokes";

describe("scanlineSegments", () => {
  it("矩形：奇偶配对得到单区间", () => {
    // 10x10 矩形，y=5 扫描线应得区间 [0, 10]
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(scanlineSegments(ring, 5)).toEqual([[0, 10]]);
  });

  it("扫描线在边界外返回空", () => {
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(scanlineSegments(ring, 15)).toEqual([]);
    expect(scanlineSegments(ring, -5)).toEqual([]);
  });

  it("凹多边形：一条扫描线得到两个区间", () => {
    // U 形（开口朝上），y=5 时左右两臂各一段
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [7, 4],
      [3, 4],
      [3, 10],
      [0, 10],
    ];
    const segs = scanlineSegments(ring, 5);
    expect(segs).toEqual([
      [0, 3],
      [7, 10],
    ]);
  });

  it("含洞 keyhole 单环：零宽桥接被剔除，洞内不落区间", () => {
    // 外环 [0,0]-[10,10]，洞 [4,4]-[6,6]，经桥 y=5 连成单环（桥在 x=5 竖直往返）
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
      // 桥：从外环某点走到洞边再回来（零宽往返）
      [5, 5],
      [6, 5],
      [6, 6],
      [4, 6],
      [4, 4],
      [6, 4],
      [5, 4],
      [5, 5],
    ];
    const segs = scanlineSegments(ring, 5);
    // y=5 交点排序后桥接处 x=5、x=4、x=6 成对相邻，剔除后区间为 [0,4] 与 [6,10] 附近
    for (const [x0, x1] of segs) {
      // 任何区间都不得深入洞内部 [4,6] 的中间
      expect(x1 <= 4 + 0.5 || x0 >= 6 - 0.5).toBe(true);
    }
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it("零宽区间被过滤", () => {
    // 蝶形：x=5 处上下顶点相触，y=5 恰在触点，产生零宽配对
    const ring: [number, number][] = [
      [0, 0],
      [10, 10],
      [5, 5],
      [5, 5],
      [10, 0],
      [0, 10],
    ];
    const segs = scanlineSegments(ring, 5);
    for (const [x0, x1] of segs) {
      expect(x1 - x0).toBeGreaterThanOrEqual(0.5);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/fillStrokes.test.ts`
Expected: FAIL（`Cannot find module './fillStrokes'`）。

- [ ] **Step 3: 实现 `src/lib/fillStrokes.ts`（本任务只写扫描线部分）**

```ts
// 笔迹填充：把 computeBucketFillPolygon 得到的封闭区域转成一组排线笔迹元素
//
// 原理：
// 1) even-odd 扫描线：对每条水平线 y，与区域环所有边求交点，排序后
//    奇偶配对得到内部区间。原生返回的 keyhole 单环（含洞区域经零宽桥接）
//    在桥接处交点成对出现，配对后区间长度为 0，会被自动跳过——无需拆环。
// 2) 每个区间生成一条带手抖的 freedraw 排线；铅笔/蜡笔挂 grainKind 走颗粒钩子。
// 3) solid / highlighter 用单个 polygon:true 的 line 元素（实心色块）。

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { buildFilledPolygon, buildFreedrawElement, randomPenId } from "./pens";
import type { Point } from "./shapeRecognition";

export type Ring = [number, number][];

export type FillKind =
  | "solid"
  | "ballpoint"
  | "fountain"
  | "pencil"
  | "crayon"
  | "highlighter";

/** 风格条选项（顺序即 UI 顺序） */
export const FILL_KINDS: { key: FillKind; name: string }[] = [
  { key: "solid", name: "纯色" },
  { key: "ballpoint", name: "圆珠" },
  { key: "fountain", name: "钢笔" },
  { key: "pencil", name: "铅笔" },
  { key: "crayon", name: "蜡笔" },
  { key: "highlighter", name: "荧光" },
];

/** 排线行距（场景像素）。蜡笔条带宽所以行距大 */
const FILL_LINE_GAPS: Record<"ballpoint" | "fountain" | "pencil" | "crayon", number> = {
  ballpoint: 4.5,
  fountain: 5.5,
  pencil: 4,
  crayon: 11,
};

/** 每条排线的垂直抖动幅度（±px） */
const FILL_JITTERS: Record<"ballpoint" | "fountain" | "pencil" | "crayon", number> = {
  ballpoint: 0.6,
  fountain: 1.1,
  pencil: 1,
  crayon: 2.2,
};

/** 排线水平采样步长 */
const FILL_STEP = 8;
/** 排线数量上限，超限自动放大行距重扫 */
const MAX_FILL_LINES = 300;
/** 零宽区间（keyhole 桥接/重合边）过滤阈值 */
const MIN_SEGMENT = 0.5;

/** 确定性伪随机（与 pens.ts 的 hashNoise 同式，独立 seed） */
function hashNoise(i: number, seed: number): number {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * even-odd 扫描线：水平线 y 与环所有边求交点，排序后奇偶配对成内部区间。
 * 返回 [x0, x1][]（保证 x0 < x1，长度 < MIN_SEGMENT 的零宽区间被剔除）。
 * 水平边（y1 === y2）不产生交点；半开区间判定 [y1, y2) 保证顶点恰好落在
 * 扫描线上时不重复计数。
 */
export function scanlineSegments(ring: Ring, y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    if (y1 === y2) continue;
    if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) {
      xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
  }
  xs.sort((a, b) => a - b);
  const segs: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] >= MIN_SEGMENT) segs.push([xs[i], xs[i + 1]]);
  }
  return segs;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/fillStrokes.test.ts`
Expected: PASS（5 个用例全绿）。若 keyhole 用例不满足，检查配对逻辑：交点必须先排序再两两配对，桥接的往返边各贡献一个交点且排序后相邻。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fillStrokes.ts src/lib/fillStrokes.test.ts
git commit -m "feat: 填充排线扫描线核心(even-odd 配对,keyhole 桥接自动过滤)"
```

---

### Task 3: buildFillGroup 元素组生成（TDD）

**Files:**
- Modify: `src/lib/pens.ts`（文件末尾追加导出）
- Modify: `src/lib/fillStrokes.ts`（追加 buildFillGroup）
- Modify: `src/lib/fillStrokes.test.ts`（追加用例）

- [ ] **Step 1: 在 `src/lib/pens.ts` 末尾追加 `buildFilledPolygon`**

先确认文件头部 `Ring` 类型定义行（`type Ring = [number, number][];`）改为导出：

```ts
export type Ring = [number, number][];
```

然后在文件末尾追加：

```ts
/**
 * 闭合多边形实心色块元素（油漆桶「纯色 / 荧光」填充共用）。
 * 与荧光笔同形态：line + polygon:true + solid 填充 + 描边同色（视觉无边框）。
 * ring 为场景坐标；返回元素坐标已转为局部坐标。
 */
export function buildFilledPolygon(
  ring: Ring,
  color: string,
  opacity: number,
  id: string,
  frameId: string | null = null,
): ExcalidrawLineElement | null {
  if (ring.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const local = ring.map(([x, y]) => [x - minX, y - minY] as [number, number]);
  local.push(local[0]); // 显式闭合

  return {
    id,
    type: "line",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    angle: 0,
    strokeColor: color,
    backgroundColor: color,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity,
    groupIds: [],
    frameId,
    index: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    points: local,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    polygon: true,
    lastCommittedPoint: null,
  } as unknown as ExcalidrawLineElement;
}
```

- [ ] **Step 2: 追加失败测试到 `src/lib/fillStrokes.test.ts`**

```ts
import { buildFillGroup } from "./fillStrokes";
import type { AppState } from "@excalidraw/excalidraw/types";

// buildFreedrawElement 只读 currentItemStrokeColor 等少量字段，最小 mock 即可
const fakeAppState = {
  currentItemStrokeColor: "#1e1e1e",
} as unknown as AppState;

const square: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];

describe("buildFillGroup", () => {
  it("solid：单个闭合 polygon line 元素，带 fillGroup 标记", () => {
    const g = buildFillGroup(square, "solid", "#e03131", fakeAppState);
    expect(g).not.toBeNull();
    expect(g!.elements.length).toBe(1);
    const el = g!.elements[0] as never as { type: string; polygon?: boolean };
    expect(el.type).toBe("line");
    expect(el.polygon).toBe(true);
    expect((g!.elements[0] as never as { customData?: { fillGroup?: string } }).customData?.fillGroup).toBe(g!.groupId);
    // 组内 groupIds 一致
    expect(g!.elements[0].groupIds).toEqual([g!.groupId]);
  });

  it("highlighter：opacity 32", () => {
    const g = buildFillGroup(square, "highlighter", "#ffec27", fakeAppState);
    expect(g!.elements[0].opacity).toBe(32);
  });

  it("ballpoint：多条 freedraw 排线，组号一致，均带 fillGroup", () => {
    const g = buildFillGroup(square, "ballpoint", "#1e1e1e", fakeAppState);
    expect(g!.elements.length).toBeGreaterThan(1);
    for (const el of g!.elements) {
      expect(el.type).toBe("freedraw");
      expect(el.groupIds).toEqual([g!.groupId]);
      expect((el as never as { customData?: { fillGroup?: string } }).customData?.fillGroup).toBe(g!.groupId);
    }
    // 100px 高方块、行距 4.5 → 约 22 行
    expect(g!.elements.length).toBeLessThan(40);
  });

  it("pencil/crayon：挂 grainKind 与 grainSeed", () => {
    for (const kind of ["pencil", "crayon"] as const) {
      const g = buildFillGroup(square, kind, "#1e1e1e", fakeAppState);
      const first = g!.elements[0] as never as {
        customData?: { grainKind?: string; grainSeed?: number; fillGroup?: string };
      };
      expect(first.customData?.grainKind).toBe(kind);
      expect(typeof first.customData?.grainSeed).toBe("number");
      expect(first.customData?.fillGroup).toBe(g!.groupId);
    }
  });

  it("密度上限：大区域自动放大行距，条数不超 MAX_FILL_LINES", () => {
    const big: [number, number][] = [
      [0, 0],
      [3000, 0],
      [3000, 3000],
      [0, 3000],
    ];
    const g = buildFillGroup(big, "pencil", "#1e1e1e", fakeAppState);
    expect(g!.elements.length).toBeLessThanOrEqual(300);
  });

  it("所有排线都落在区域包围盒内", () => {
    const g = buildFillGroup(square, "fountain", "#1e1e1e", fakeAppState);
    for (const el of g!.elements) {
      expect(el.x).toBeGreaterThanOrEqual(-5);
      expect(el.y).toBeGreaterThanOrEqual(-5);
      expect(el.x + el.width).toBeLessThanOrEqual(105);
      expect(el.y + el.height).toBeLessThanOrEqual(105);
    }
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/lib/fillStrokes.test.ts`
Expected: FAIL（`buildFillGroup` 未导出）。

- [ ] **Step 4: 在 `src/lib/fillStrokes.ts` 追加实现**

```ts
export interface FillGroup {
  elements: ExcalidrawElement[];
  groupId: string;
}

/** 单条带抖动排线的点列（首尾精确落在区间端点上，中段叠加确定性噪声） */
function jitterLine(
  y: number,
  x0: number,
  x1: number,
  jitter: number,
  seed: number,
): Point[] {
  const len = x1 - x0;
  const n = Math.max(2, Math.ceil(len / FILL_STEP) + 1);
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x = x0 + len * t;
    const dy =
      i === 0 || i === n - 1 ? 0 : (hashNoise(i, seed) - 0.5) * jitter * 2;
    pts.push({ x, y: y + dy });
  }
  return pts;
}

/**
 * 按填充风格把封闭区域环转成一组元素。
 * - solid / highlighter：单个 polygon line 色块（荧光半透明 32%）
 * - 其余：扫描线排线 freedraw 组；pencil/crayon 挂 grainKind 走颗粒钩子
 * 返回 null 表示无法生成（环退化、区间为空）。
 */
export function buildFillGroup(
  ring: Ring,
  kind: FillKind,
  color: string,
  appState: AppState,
  frameId: string | null = null,
): FillGroup | null {
  const groupId = randomPenId().replace("pen-", "fill-");

  if (kind === "solid" || kind === "highlighter") {
    const el = buildFilledPolygon(
      ring,
      color,
      kind === "highlighter" ? 32 : 100,
      randomPenId(),
      frameId,
    );
    if (!el) return null;
    el.groupIds = [groupId];
    (el as never as { customData: Record<string, unknown> }).customData = {
      fillGroup: groupId,
    };
    return { elements: [el], groupId };
  }

  // 排线类：ballpoint / fountain / pencil / crayon
  const gap0 = FILL_LINE_GAPS[kind];
  const jitter = FILL_JITTERS[kind];
  const seed = Math.floor(Math.random() * 2 ** 31);
  const preset = { ...PEN_PRESETS[kind] };

  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of ring) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  let gap = gap0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const rows: { y: number; segs: [number, number][] }[] = [];
    for (let y = minY + gap / 2; y < maxY; y += gap) {
      const segs = scanlineSegments(ring, y);
      if (segs.length > 0) rows.push({ y, segs });
    }
    const lineCount = rows.reduce((acc, r) => acc + r.segs.length, 0);

    if (lineCount > MAX_FILL_LINES && attempt < 5) {
      gap *= Math.max(1.5, Math.ceil(lineCount / MAX_FILL_LINES));
      continue;
    }

    const customData: Record<string, unknown> =
      kind === "pencil" || kind === "crayon"
        ? { grainKind: kind, grainSeed: seed, fillGroup: groupId }
        : { fillGroup: groupId };

    const elements: ExcalidrawElement[] = [];
    for (const row of rows) {
      for (const [x0, x1] of row.segs) {
        const el = buildFreedrawElement(
          jitterLine(row.y, x0, x1, jitter, seed + Math.round(row.y * 7)),
          appState,
          preset,
          randomPenId(),
          color,
          customData,
        );
        el.groupIds = [groupId];
        (el as never as { frameId: string | null }).frameId = frameId;
        elements.push(el);
      }
    }
    if (elements.length === 0) return null;
    return { elements, groupId };
  }
  return null;
}
```

注意：文件头部需补 import `PEN_PRESETS`：

```ts
import { buildFilledPolygon, buildFreedrawElement, randomPenId, PEN_PRESETS } from "./pens";
```

- [ ] **Step 5: 运行全部测试确认通过**

Run: `npx vitest run src/lib/fillStrokes.test.ts`
Expected: PASS（11 个用例全绿）。若"包围盒"用例失败，检查 `jitterLine` 的首尾 dy 是否为 0（只有中段抖动）。

- [ ] **Step 6: lint 与 commit**

```bash
npm run lint
git add src/lib/fillStrokes.ts src/lib/fillStrokes.test.ts src/lib/pens.ts
git commit -m "feat: buildFillGroup 按风格生成填充元素组(排线/色块/颗粒通道)"
```

---

### Task 4: FillStyleBar 组件

**Files:**
- Create: `src/components/FillStyleBar.tsx`
- Create: `src/components/FillStyleBar.css`

- [ ] **Step 1: 实现 `src/components/FillStyleBar.tsx`**

```tsx
import { FILL_KINDS, type FillKind } from "../lib/fillStrokes";
import "./FillStyleBar.css";

interface FillStyleBarProps {
  kind: FillKind;
  onChange: (kind: FillKind) => void;
}

/** 油漆桶填充风格条：纯色 + 五支笔笔迹（扁平直角，绿色选中态） */
export default function FillStyleBar({ kind, onChange }: FillStyleBarProps) {
  return (
    <div className="fill-style-bar" role="toolbar" aria-label="填充风格">
      <span className="fill-style-bar__title">填充</span>
      {FILL_KINDS.map((k) => (
        <button
          key={k.key}
          type="button"
          className={`fill-style-bar__btn${kind === k.key ? " active" : ""}`}
          onClick={() => onChange(k.key)}
          title={`用${k.name}笔迹填充`}
        >
          {k.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 实现 `src/components/FillStyleBar.css`**

```css
/* 填充风格条：扁平、直角、无阴影无渐变，选中态绿色（与全站按钮一致） */
.fill-style-bar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 0;
  z-index: 40;
}

[data-theme="dark"] .fill-style-bar {
  background: #232323;
  border-color: #3d3d3d;
}

.fill-style-bar__title {
  font-size: 12px;
  color: #6b7280;
  padding: 0 6px 0 2px;
}

[data-theme="dark"] .fill-style-bar__title {
  color: #9ca3af;
}

.fill-style-bar__btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: #374151;
  font-size: 13px;
  line-height: 1;
  padding: 7px 12px;
  cursor: pointer;
}

[data-theme="dark"] .fill-style-bar__btn {
  color: #d1d5db;
}

.fill-style-bar__btn:hover {
  background: #f3f4f6;
}

[data-theme="dark"] .fill-style-bar__btn:hover {
  background: #2f2f2f;
}

.fill-style-bar__btn.active {
  background: #16a34a;
  border-color: #16a34a;
  color: #ffffff;
}

.fill-style-bar__btn.active:hover {
  background: #15803d;
}
```

（若 `Toolbar.css` / `StylePanel.css` 中已有绿色主色调变量，优先复用同色值；以上 `#16a34a` 为与既有绿色按钮一致的兜底值。）

- [ ] **Step 3: lint 与 commit**

```bash
npm run lint
git add src/components/FillStyleBar.tsx src/components/FillStyleBar.css
git commit -m "feat: 填充风格条组件(六种填充风格切换)"
```

---

### Task 5: App.tsx 集成

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: 顶部 import 与常量**

`src/App.tsx` 头部（第 1-49 行区域）追加：

```ts
import { computeBucketFillPolygon } from "@excalidraw/element";
import FillStyleBar from "./components/FillStyleBar";
import { buildFillGroup, type FillKind } from "./lib/fillStrokes";
```

常量区（`const PEN_TOOL = "pen-brush";` 之后）追加：

```ts
const FILL_TOOL = "fill-bucket";
const FILL_KIND_STORAGE_KEY = "painter-fill-kind-v1";

/** 判断工具是否为自研油漆桶填充 */
function isFillTool(tool: ActiveTool): boolean {
  return tool.type === "custom" && tool.customType === FILL_TOOL;
}
```

- [ ] **Step 2: 组件内状态（与 `smartShapeActive` 等 state 同区）**

```ts
const [fillToolActive, setFillToolActive] = useState(false);
const [fillKind, setFillKind] = useState<FillKind>(() => {
  try {
    const raw = localStorage.getItem(FILL_KIND_STORAGE_KEY);
    if (raw && ["solid", "ballpoint", "fountain", "pencil", "crayon", "highlighter"].includes(raw)) {
      return raw as FillKind;
    }
  } catch {
    /* 忽略 */
  }
  return "solid";
});
const fillKindRef = useRef<FillKind>(fillKind);
useEffect(() => {
  fillKindRef.current = fillKind;
  try {
    localStorage.setItem(FILL_KIND_STORAGE_KEY, fillKind);
  } catch {
    /* 忽略 */
  }
}, [fillKind]);
```

- [ ] **Step 3: 切换函数（放在 `handleSmartShape` 之后，复用同一互斥模式）**

```ts
// 启用油漆桶填充；再点一次退出
const handleToggleFill = useCallback(() => {
  const api = excalidrawAPIRef.current;
  if (!api) return;
  if (fillToolActive) {
    setFillToolActive(false);
    api.setActiveTool({ type: "selection" });
    toast("已退出油漆桶");
    return;
  }
  // 与智能画笔 / 多笔刷互斥
  setSmartShapeActive(false);
  activePenRef.current = null;
  setActivePen(null);
  setFillToolActive(true);
  api.setActiveTool({ type: "custom", customType: FILL_TOOL, locked: true });
  toast("油漆桶已启用：点封闭区域，用当前笔迹填充（颜色跟随当前笔色）");
}, [toast, fillToolActive]);
```

- [ ] **Step 4: onPointerDown 填充分支**

在 `handlePointerDown` 的回调体开头（`isSmartShapeTool` 分支之前）插入：

```ts
// 笔迹填充：点击封闭区域 → 换色或生成新填充组（一次点击一次填充）
if (isFillTool(activeTool)) {
  const api = excalidrawAPIRef.current;
  if (!api) return;
  const appState = api.getAppState();
  // 填充色 = 当前笔色；透明时回退背景色，仍透明则回退默认墨色
  let color = appState.currentItemStrokeColor;
  if (color === "transparent") color = appState.currentItemBackgroundColor;
  if (color === "transparent") color = "#1e1e1e";

  const elements = api.getSceneElements();
  const elementsMap = new Map(
    elements.map((el) => [el.id, el] as const),
  );
  const result = computeBucketFillPolygon({
    point: { x: pointerDownState.origin.x, y: pointerDownState.origin.y },
    elements,
    elementsMap,
  } as Parameters<typeof computeBucketFillPolygon>[0]);

  if (!result.ok) {
    toast(
      result.reason === "too_complex"
        ? "区域太复杂，无法填充"
        : "点击区域未闭合，无法填充",
      "error",
    );
    return;
  }

  // 点击命中的是我们填充组的成员 → 全组换色，不叠加
  const ownerId = result.ownerId;
  const owner = ownerId ? elementsMap.get(ownerId) : undefined;
  const gid = (
    owner?.customData as { fillGroup?: string } | undefined
  )?.fillGroup;
  if (gid) {
    api.updateScene({
      elements: elements.map((el) =>
        (el.customData as { fillGroup?: string } | undefined)?.fillGroup === gid
          ? { ...el, strokeColor: color, backgroundColor: color }
          : el,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    toast("已为填充区域换色");
    return;
  }

  // 新填充组；z 序按原生 insertion 插到锚点元素上/下方
  const anchorId = result.insertion?.elementId;
  const anchor = anchorId ? elementsMap.get(anchorId) : undefined;
  const group = buildFillGroup(
    result.scenePoints as [number, number][],
    fillKindRef.current,
    color,
    appState,
    anchor?.frameId ?? null,
  );
  if (!group) {
    toast("无法在此区域生成填充", "error");
    return;
  }
  const arr = [...elements];
  const idx = anchorId ? arr.findIndex((el) => el.id === anchorId) : -1;
  if (idx >= 0) {
    arr.splice(
      result.insertion.placement === "below" ? idx : idx + 1,
      0,
      ...group.elements,
    );
  } else {
    arr.push(...group.elements);
  }
  api.updateScene({
    elements: arr,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  toast("填充完成");
}
```

（`result.scenePoints` / `result.ownerId` / `result.insertion` 的字段名以 Task 1 Step 3 读到的 d.ts 为准，不同则同步改名。）

- [ ] **Step 5: 渲染集成**

根容器 className 追加 fill-active 标记（第 806 行附近）：

```tsx
className={`app${smartShapeActive ? " smart-shape-active" : ""}${
  activePen ? " pen-active" : ""
}${fillToolActive ? " fill-active" : ""}`}
```

风格条 portal（`StylePanel` 的 portal 块之后）：

```tsx
{fillToolActive &&
  panelHost &&
  createPortal(
    <FillStyleBar
      kind={fillKind}
      onChange={(k) => setFillKind(k)}
    />,
    panelHost,
  )}
```

`actions` useMemo 中追加并加入依赖数组：

```ts
onToggleFill: handleToggleFill,
fillToolActive,
```

依赖数组追加 `handleToggleFill, fillToolActive`。

- [ ] **Step 6: `src/App.css` 末尾追加光标**

```css
/* 油漆桶激活时画布用十字光标 */
.app.fill-active .excalidraw .canvas {
  cursor: crosshair;
}
```

- [ ] **Step 7: 类型检查、lint 与 commit**

```bash
npm run lint
npx tsc -b
git add src/App.tsx src/App.css
git commit -m "feat: 集成笔迹填充工具(点击填充/全组换色/风格条持久化)"
```

---

### Task 6: Toolbar 油漆桶按钮

**Files:**
- Modify: `src/components/Toolbar.tsx`

- [ ] **Step 1: `ToolbarActions` 接口追加两个字段**

```ts
onToggleFill: () => void;
fillToolActive: boolean;
```

- [ ] **Step 2: 解构与按钮**

解构处追加 `onToggleFill, fillToolActive`。在 `<PenMenu ... />` 之后、分隔线之前插入：

```tsx
{/* 油漆桶：笔迹填充 */}
<button
  className={clsx("btn btn-smartshape", fillToolActive && "active")}
  onClick={onToggleFill}
  title="油漆桶填充：点封闭区域，用所选笔迹铺满（颜色跟随当前笔色）"
>
  <span className="smartshape-icon" aria-hidden>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11 3l7.5 7.5a1.5 1.5 0 0 1 0 2.12l-5.38 5.38a3 3 0 0 1-4.24 0L4 13.12a1.5 1.5 0 0 1 0-2.12L10.38 4.62 8.5 2.74 9.74 1.5l2.6 2.6L11 3zm-5.55 9.5L11 18.06a1 1 0 0 0 1.42 0l4.54-4.54L11.17 7.3l-5.72 5.2zM19 15s2 2.17 2 3.5a2 2 0 1 1-4 0c0-1.33 2-3.5 2-3.5z" />
    </svg>
  </span>
  <span className="smartshape-text">油漆桶</span>
</button>
```

- [ ] **Step 3: lint 与 commit**

```bash
npm run lint
git add src/components/Toolbar.tsx
git commit -m "feat: 工具栏新增油漆桶按钮(与笔刷/智能画笔同风格)"
```

---

### Task 7: 构建、手工验收与文档

**Files:**
- Modify: `docs/excalidraw-wiki.md`

- [ ] **Step 1: 全量构建**

Run: `npm run build`
Expected: tsc 与 vite build 均无错误。

- [ ] **Step 2: 手工验收（`npm run dev` 后浏览器逐项验证）**

1. 点工具栏"油漆桶" → 风格条出现，画布光标变十字
2. 画一个矩形 → 各风格逐一切换填充：纯色实心 / 圆珠细排线 / 钢笔变宽排线 / 铅笔石墨颗粒 / 蜡笔厚涂条带 / 荧光半透明
3. 在填充组上再点击 → 整组换色不叠加
4. Ctrl+Z → 整组消失；Ctrl+Shift+Z → 恢复
5. 框选填充 → 整体拖动、缩放 → 排线跟随
6. 橡皮擦 → 可擦除单条排线
7. 画两个相交形状，点重叠区 → 内外填充互不侵入（keyhole 洞不落笔）
8. 未闭合路径内点击 → toast"点击区域未闭合"
9. 导出 PNG/SVG → 铅笔/蜡笔颗粒保留（走既有 SVG 颗粒钩子）
10. 刷新页面 → 风格条选择保持（localStorage）
11. 智能画笔/多笔刷 ↔ 油漆桶切换互斥正常

- [ ] **Step 3: wiki 追加章节（`docs/excalidraw-wiki.md` 末尾新增）**

````markdown
## 9. 自研笔迹填充（fill-bucket 工具）

- **入口**：Toolbar 油漆桶按钮 → `customType: "fill-bucket"` 自定义工具（locked）。
  原生 ⋯ 菜单里的 bucketfill 保留（原生纯色行为），两者互不干扰。
- **几何来源**：`computeBucketFillPolygon()`（`@excalidraw/element` 公开导出，
  主包不 re-export，需显式依赖）。成功返回 keyhole 单环 `scenePoints` +
  z 序锚点 `insertion`；失败 reason 映射 toast 文案。
- **核心算法**：even-odd 扫描线（`src/lib/fillStrokes.ts`）。keyhole 零宽桥接
  的交点排序后成对相邻，奇偶配对得到零宽区间，按 `MIN_SEGMENT = 0.5` 剔除，
  洞内自然不落笔，无需拆环。
- **六种风格**：solid/highlighter = 单个 `polygon:true` line 色块（荧光 opacity 32）；
  ballpoint/fountain/pencil/crayon = 扫描线排线 freedraw 组，pencil/crayon 挂
  `customData.grainKind` 走颗粒钩子。行距上限 `MAX_FILL_LINES = 300`，超限自动放大行距。
- **组标记**：组内元素共享 `groupIds` + `customData.fillGroup`；点击已有组员
  → 全组换色（按 `customData.fillGroup` 匹配），不重新生成。
- **填充色**：跟随 `currentItemStrokeColor`（当前笔色），transparent 时回退
  `currentItemBackgroundColor` 再回退 `#1e1e1e`。
- **风格持久化**：localStorage key `painter-fill-kind-v1`。

### 踩坑

| # | 现象 | 原因与对策 |
| --- | --- | --- |
| 15 | 排线越出填充区域 | `jitterLine` 首尾点 dy 必须为 0，只抖中段；端点精确落在扫描线区间上 |
| 16 | 含洞区域填充把洞也填了 | 不能用 nonzero 环绕直接填 keyhole 环；必须走 even-odd 扫描线，桥接零宽区间显式过滤 |
| 17 | 撤销一次只撤掉组内一条排线 | 整组必须一次 `updateScene(elements + IMMEDIATELY)` 提交，禁止逐条追加 |
````

- [ ] **Step 4: 最终 commit**

```bash
git add docs/excalidraw-wiki.md
git commit -m "docs: wiki 新增自研笔迹填充章节与踩坑记录"
```

---

## 自审记录

- **Spec 覆盖**：spec §4 交互（Task 5/6）、§5 风格映射（Task 3）、§6 算法（Task 2/3）、§7 换色与叠加（Task 5 Step 4）、§8 兼容性（Task 7 验收 4-9）、§9 模块（文件结构表）、§10 错误处理（Task 5 Step 4 toast 映射）、§11 测试要点（Task 2/3 单测 + Task 7 验收）、§12 风险（keyhole 单测 Task 2、上限 Task 3、版本锁定 Task 1）——全部有对应任务。
- **类型一致性**：`FillKind` / `Ring` / `FillGroup` / `buildFillGroup(ring, kind, color, appState, frameId)` / `scanlineSegments(ring, y)` 在 Task 2/3/5 间一致；`FILL_KINDS` 供 FillStyleBar 使用一致。
- **依赖顺序**：Task 2 只依赖 Task 1 的 vitest；Task 3 依赖 Task 2 的扫描线与 Task 1 的 API 签名确认；Task 5 依赖 Task 3/4 导出。
