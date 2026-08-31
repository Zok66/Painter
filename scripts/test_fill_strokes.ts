// 笔迹填充核心算法单测（npx tsx scripts/test_fill_strokes.ts）
// 覆盖设计文档第 11 节测试要点：扫描线区间 / keyhole 洞内不落笔 /
// 密度上限 / 各风格元素构建一致性 / 点击命中与换色。

import {
  scanFillSpans,
  buildFillElements,
  hitFillGroup,
  restyleFillGroup,
} from "../src/lib/fillStrokes";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.error(`  ✗ ${msg}`);
  }
}

const appState = { currentItemStrokeColor: "#e03131" } as never;

/* 1. 矩形排线区间 */
console.log("[1] 矩形扫描线区间");
{
  const rect: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 80],
    [0, 80],
  ];
  const spans = scanFillSpans(rect, 10);
  assert(spans.length === 8, `间距 10、高 80 → 8 条排线（实际 ${spans.length}）`);
  assert(
    spans.every((s) => s.x0 === 0 && s.x1 === 100),
    "矩形内部区间均为 [0,100]",
  );
  assert(
    spans.every((s, i) => i === 0 || s.y > spans[i - 1].y),
    "排线 y 自上而下递增",
  );
}

/* 2. keyhole 含洞环：洞内不落笔 */
console.log("[2] keyhole 含洞环");
{
  // 外环 (0,0)-(100,100)，洞 [40,60]²，经零宽桥接成单环
  const keyhole: [number, number][] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
    [0, 50],
    [40, 40],
    [40, 60],
    [60, 60],
    [60, 40],
    [40, 40],
    [0, 50],
    [0, 0],
  ];
  const spans = scanFillSpans(keyhole, 5);
  const overlapHole = spans.filter(
    (s) => s.x1 > 40 + 0.5 && s.x0 < 60 - 0.5 && s.y > 40 && s.y < 60,
  );
  assert(overlapHole.length === 0, "洞内部无排线区间");
  const belowHole = spans.filter((s) => s.y < 40);
  assert(
    belowHole.every((s) => s.x0 === 0 && s.x1 === 100),
    "洞下方区间横贯 [0,100]",
  );
}

/* 3. 密度上限 */
console.log("[3] 密度上限");
{
  const big: [number, number][] = [
    [0, 0],
    [2000, 0],
    [2000, 2000],
    [0, 2000],
  ];
  const els = buildFillElements({
    scenePoints: big,
    kind: "pencil",
    color: "#1e1e1e",
    groupId: "g-density",
    seed: 42,
    appState,
  });
  assert(els.length <= 300, `排线数 ≤ 300（实际 ${els.length}）`);
}

/* 4. 各风格元素构建一致性 */
console.log("[4] 各风格元素构建");
{
  const rect: [number, number][] = [
    [0, 0],
    [120, 0],
    [120, 90],
    [0, 90],
  ];
  const kinds = [
    "solid",
    "ballpoint",
    "fountain",
    "pencil",
    "crayon",
    "highlighter",
  ] as const;

  for (const kind of kinds) {
    const els = buildFillElements({
      scenePoints: rect,
      kind,
      color: "#e03131",
      groupId: `g-${kind}`,
      seed: 7,
      appState,
    });
    assert(els.length > 0, `${kind}: 生成非空元素组（${els.length} 个）`);
    assert(
      els.every((el) => (el.groupIds ?? []).length === 1 && el.groupIds[0] === `g-${kind}`),
      `${kind}: 所有元素共享同一 groupIds`,
    );
    assert(
      els.every((el) => (el.customData as never as Record<string, unknown>)?.fillGroup === `g-${kind}`),
      `${kind}: customData.fillGroup 标记正确`,
    );

    if (kind === "solid" || kind === "highlighter") {
      assert(els.length === 1 && els[0].type === "line", `${kind}: 单个 line 多边形`);
      const el = els[0] as never as { backgroundColor: string; opacity: number };
      assert(el.backgroundColor === "#e03131", `${kind}: 填充色正确`);
      assert(
        kind === "solid" ? el.opacity === 100 : el.opacity === 32,
        `${kind}: 透明度正确（${el.opacity}）`,
      );
    } else {
      assert(els.every((el) => el.type === "freedraw"), `${kind}: 排线均为 freedraw`);
      const hasGrain = els.some(
        (el) =>
          (el.customData as never as Record<string, unknown>)?.grainKind === kind,
      );
      assert(
        kind === "pencil" || kind === "crayon" ? hasGrain : !hasGrain,
        `${kind}: grainKind 挂载正确`,
      );
      assert(
        els.every((el) => (el as never as { strokeColor: string }).strokeColor === "#e03131"),
        `${kind}: 颜色正确`,
      );
    }
  }
}

/* 5. 点击命中与换色 */
console.log("[5] hitFillGroup / restyleFillGroup");
{
  const rect: [number, number][] = [
    [0, 0],
    [120, 0],
    [120, 90],
    [0, 90],
  ];
  const solid = buildFillElements({
    scenePoints: rect,
    kind: "solid",
    color: "#e03131",
    groupId: "g-hit-solid",
    seed: 7,
    appState,
  });
  const lines = buildFillElements({
    scenePoints: rect,
    kind: "ballpoint",
    color: "#1e1e1e",
    groupId: "g-hit-line",
    seed: 7,
    appState,
  });

  const scene = [...solid, ...lines] as ExcalidrawElement[];
  assert(hitFillGroup(60, 45, scene) === "g-hit-line", "顶层排线组命中优先");
  assert(hitFillGroup(60, 45, solid as ExcalidrawElement[]) === "g-hit-solid", "纯色多边形内部命中");
  assert(hitFillGroup(500, 500, scene) === null, "区域外点击不命中");

  // 排线中心线上取一点应命中排线组
  const firstLine = lines[0] as never as {
    x: number;
    y: number;
    points: [number, number][];
  };
  const px = firstLine.x + firstLine.points[0][0];
  const py = firstLine.y + firstLine.points[0][1];
  assert(
    hitFillGroup(px, py, lines as ExcalidrawElement[]) === "g-hit-line",
    "排线中心线命中",
  );

  // 换色：全组改色，排线不动 backgroundColor
  const restyled = restyleFillGroup("g-hit-line", "#1971c2", scene);
  const lineEl = restyled.find(
    (el) => (el.customData as never as Record<string, unknown>)?.fillGroup === "g-hit-line",
  ) as never as { strokeColor: string; backgroundColor: string };
  const solidEl = restyled.find(
    (el) => (el.customData as never as Record<string, unknown>)?.fillGroup === "g-hit-solid",
  ) as never as { strokeColor: string; backgroundColor: string };
  assert(lineEl.strokeColor === "#1971c2", "排线组换色生效");
  assert(
    solidEl.strokeColor === "#e03131" && solidEl.backgroundColor === "#e03131",
    "未命中的纯色组保持原色",
  );
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
