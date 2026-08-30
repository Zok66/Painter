# 笔迹填充（Bucket Fill 笔迹版）设计文档

- 日期：2026-08-30
- 状态：已获用户批准（交互、算法、兼容性、模块划分逐节确认）
- 前置调研：原生 bucketfill 机制实测（`@excalidraw/excalidraw@0.18.0-abeeaeb`）

## 1. 目标与非目标

**目标**：油漆桶工具支持"笔迹填充"——点选封闭区域后，区域内部被所选笔的
笔迹纹理铺满；提供 6 种填充风格：纯色（原生行为）、圆珠、钢笔、铅笔、蜡笔、荧光。

**非目标（V1 明确不做）**：
- 斜向排线（扫描器预留 `angle` 参数，V1 只做水平排线）
- 自绘油漆桶光标（V1 用 crosshair）
- 同区域多笔迹自动混合管理（手动叠加允许，不做管理）
- 移动边界轮廓后自动重算填充（与原生一致的静态语义）

## 2. 已确认的需求决策

| 决策点 | 结论 |
| --- | --- |
| 填充效果 | 笔刷笔迹铺满区域（非增强排线、非叠加管理） |
| 笔刷范围 | 全部五支笔 + 纯色，第一版全做 |
| 笔迹选择 UI | 油漆桶专属选项条（独立于笔刷面板） |
| 技术方案 | 方案一：扫描线排线元素组（非单元素纹理方案） |

## 3. 原生机制（调研结论，0.18.0-abeeaeb 实测）

- 原生 `AppBucketFill.fill()`：点击 → `computeBucketFillPolygon()` 计算封闭
  区域 → 新建 `polygon: true` 的 line 元素，填充靠 `backgroundColor + fillStyle`
  （hachure / cross-hatch / solid 三种），无笔迹质感。
- `computeBucketFillPolygon` 与 `isBucketFillCompatible`、`isRestylableFill`
  在 `@excalidraw/element` 包**公开导出**（`dist/types/element/src/bucketFill.d.ts`），
  主包未 re-export，需显式依赖 `@excalidraw/element`。
- 返回类型 `BucketFillGeometryResult`：
  - 成功：`{ ok: true, ownerId, boundaryElementIds, scenePoints, insertion }`，
    其中 `scenePoints` 是 keyhole 单环（含洞区域经零宽桥接拼成一个环），
    `insertion = { placement: "above" | "below", elementId }` 给出 z 序锚点。
  - 失败：`{ ok: false, reason: "no_owner" | "open_region" | "too_complex" | "too_small" | "invalid_polygon" }`。

## 4. 交互设计

- **入口**：顶部 Toolbar 新增油漆桶按钮（与画笔选择栏同风格：扁平、直角、
  绿色选中态）。点击激活自研 `custom` 工具（`customType: "fill-bucket"`，
  `locked: true`），再点退出。原生 ⋯ 菜单里的 bucketfill 保留不动（原生纯色行为）。
- **填充风格条**（`FillStyleBar`）：油漆桶激活时显示，选项：
  `纯色 │ 圆珠 │ 钢笔 │ 铅笔 │ 蜡笔 │ 荧光`，默认纯色。
- **持久化**：风格条选择存 `localStorage`，key `painter-fill-kind-v1`。
- **颜色**：填充主色 = 风格面板当前笔色（`currentItemStrokeColor`），与画笔
  共用一套颜色，改色即改填充色；不新增颜色选择器。
- 与智能画笔/多笔刷互斥：激活油漆桶时退出笔刷模式（复用现有互斥逻辑）。

## 5. 各风格映射

| 风格 | 生成方式 |
| --- | --- |
| 纯色 | 单个 `polygon: true` line 元素，`backgroundColor = 当前色`，实心 solid（原生等价物） |
| 圆珠 | 等宽排线：strokeWidth ≈ 2.2、间距 ≈ 4px、`variability: constant` |
| 钢笔 | 变宽排线：`variability: variable`，线宽随逐条随机压力模拟笔锋 |
| 铅笔 | 细排线 + `customData.grainKind = "pencil"` + `grainSeed`，走既有颗粒渲染钩子 |
| 蜡笔 | 宽条带（strokeWidth ≈ 13）宽间距（≈ 11px）+ `grainKind = "crayon"`，蜡质厚涂 |
| 荧光 | 半透明纯色多边形：opacity ≈ 32%、当前色 |

排线元素统一为 freedraw 元素，笔迹手感参数复用 `src/lib/pens.ts` 的
`PEN_PRESETS`（间距为新增的填充专用字段，不污染原 preset 使用方）。

## 6. 核心算法（`src/lib/fillStrokes.ts`）

1. **输入**：`scenePoints`（keyhole 单环）、风格 kind、颜色、appState 相关参数。
2. **扫描线（even-odd）**：对每个间距 y，与多边形所有边求交点 → 排序 →
   奇偶配对得内部区间。keyhole 桥接为零宽（进/出交点成对相邻），配对后
   区间长度为 0，自动跳过——**无需拆环，洞内不落笔**。
3. **抖动**：每条排线在水平推进时叠加低频随机偏移（幅度按笔 preset），
   模拟手绘排线；每条线独立随机源。
4. **元素构建**：每条排线 = 一条 freedraw 元素（起点/终点裁剪到区间内）；
   铅笔/蜡笔额外挂 `customData = { grainKind, grainSeed }`。
5. **成组**：所有排线共享同一 `groupIds`（新 UUID），一次选中/移动/删除。
6. **密度上限**：排线数 > `MAX_FILL_LINES = 300` 时按比例放大间距重扫
   （保护铅笔细间距 + 大区域的最坏情况）。
7. **z 序**：按 `result.insertion` 解析插入位置（同原生 `insertElementsAtIndex`
   逻辑：`placement === "above"` 时 anchorIndex + 1）。
8. 提交：`updateScene({ elements: [...现有, ...新组], captureUpdate: IMMEDIATELY })`。

> 预留 `angle` 参数（旋转坐标系扫描后旋回），V1 固定水平。

## 7. 交互后的换色与叠加

- 点击命中**我们生成的填充组**成员（元素 `customData.fillGroup = <groupId>` 标记）
  → 全组 restyle 换当前色（`mutateElement` 逐条改 `strokeColor`/`backgroundColor`/
  `opacity`），不重新生成、不叠加。
- 点击其他情况 → 生成新填充组；用户对同区域手动叠色允许（手绘叠色效果）。
- 荧光/纯色填充组点击 → 换色同理（组内单元素 mutate）。

## 8. 兼容性矩阵（全部原生能力免费获得）

| 能力 | 表现 |
| --- | --- |
| 撤销/重做 | 单次 `IMMEDIATELY` 提交，Ctrl+Z 整组消失 |
| 选择/移动/缩放 | `groupIds` 成组整体操作，排线随变换（手绘自然感） |
| 橡皮擦 | 可擦单条（组拆散属预期） |
| SVG/PNG 导出 | 原生链路；铅笔/蜡笔走既有 `__painterGrainSvgRender` 钩子 |
| 序列化/复制 | 普通 freedraw 组，`.excalidraw` 文件天然携带 |

## 9. 模块划分

| 模块 | 职责 |
| --- | --- |
| `src/lib/fillStrokes.ts`（新） | even-odd 扫描线、抖动排线生成、各风格元素组构建、密度上限；纯函数，可单测 |
| `src/components/FillStyleBar.tsx` + `.css`（新） | 填充风格条 UI（扁平/直角/绿色选中态） |
| `src/App.tsx` | `FILL_TOOL` 注册（`customType: "fill-bucket"`）、onPointerDown 分支、风格条状态与 localStorage |
| `src/components/Toolbar.tsx` | 油漆桶按钮（画笔选择栏同款交互模式） |
| `package.json` | 显式新增依赖 `"@excalidraw/element": "^0.18.0-abeeaeb"` |
| `docs/excalidraw-wiki.md` | 追加"自研笔迹填充"章节 + 踩坑条目 |

## 10. 错误处理

- `computeBucketFillPolygon` 失败：toast 复用原生文案映射
  （`too_complex` → bucketfill.tooComplex；其余 → bucketfill.noRegion）。
- 扫描线区间为空（退化多边形）：静默返回，不提交空组。
- 颗粒渲染异常：由既有 `grainElementRenderer` 的 try/catch 兜底（已有机制）。

## 11. 测试要点

- `fillStrokes.ts` 纯函数单测：
  - 矩形/凹多边形/含洞 keyhole 环的排线区间正确性（洞内无笔迹）
  - 密度上限触发的间距放大
  - 各风格生成元素的数量、groupIds 一致性、grainKind 挂载
- 手工验收：
  - 画圆/矩形 → 各风格填充 → 移动/缩放/撤销/橡皮擦/导出 PNG
  - 未闭合区域点击 → toast
  - 填充组上再点击 → 换色不叠加
  - 深浅主题下颜色正确

## 12. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `@excalidraw/element` 直接依赖与主包版本漂移 | 锁同版本号；升级时 postinstall 补丁脚本若报锚点丢失会提前暴露 |
| 大区域粒子量导致卡顿 | 300 条排线上限 + 间距自动放大；颗粒管线本身有粒子步长控制 |
| keyhole 桥接处理有误致洞内落笔 | 单测覆盖含洞用例；桥接交点零宽区间显式过滤（阈值 < 0.5px 丢弃） |
