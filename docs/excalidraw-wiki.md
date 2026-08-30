# Painter × Excalidraw 开发 Wiki

> 面向本项目的 Excalidraw 二次开发速查手册。所有条目均以项目实际安装的
> `@excalidraw/excalidraw@0.18.0-abeeaeb`（`node_modules` 实测）为准，
> 与网上旧教程（多为 0.15 ~ 0.17 时代）不一致处均已标注。

---

## 1. 版本与包结构

- **当前版本**：`0.18.0-abeeaeb`（nightly 构建，见 [package.json](../package.json)）
- 0.18 起 Excalidraw 拆成 monorepo 多包，`node_modules/@excalidraw/` 下的成员：

| 包 | 职责 | 本项目是否直接引用 |
| --- | --- | --- |
| `excalidraw` | React 组件 + 主入口（LayerUI、App、导出 API） | ✅ 主包 |
| `element` | 元素模型、`drawElementOnCanvas` 渲染管线 | ✅（patch 目标） |
| `common` | 常量、KEYS、工具类型等基础 | 间接 |
| `math` | 几何算法 | 间接 |
| `laser-pointer` | 激光笔轨迹算法（自研智能画笔的 laser 捕获与之相关） | 间接 |
| `fractional-indexing` / `utils` / `mermaid-to-excalidraw` 等 | 支撑库 | 间接 |

- **排查源码时读 `dist/dev/`，不要读 `dist/prod/`**（prod 是压缩过的）：
  - 主包可读源码：`node_modules/@excalidraw/excalidraw/dist/dev/index.js`
  - 元素渲染：`node_modules/@excalidraw/element/dist/dev/index.js`
  - 英文语言包（fallback）内置：`dist/dev/chunk-7QNTKOP3.js`
  - 其他语言包**按需懒加载**：`dist/dev/locales/<lang>-<hash>.js`（如 `zh-CN-RSRHKN75.js`）
- `package.json` 的 `postinstall` 会执行 [scripts/patch-excalidraw.mjs](../scripts/patch-excalidraw.mjs)，
  **重装依赖后补丁自动重打**；若脚本报"找不到锚点"，说明上游更新改变了代码结构。

---

## 2. 原生工具速查表（0.18 实测）

注册表 `TOOLS` 位于 `@excalidraw/excalidraw/dist/dev/index.js`（搜索 `bucketfill:` 即可定位）。

| 工具类型名（代码用） | 字母键 | 数字键 | 桌面端 UI 位置 | 备注 |
| --- | --- | --- | --- | --- |
| `selection` | — | 1 | 主工具栏 | 与 `lasso` 共用按钮（点击切换/弹出） |
| `hand` | H | — | 主工具栏 | |
| `rectangle` | R | 2 | 主工具栏 | |
| `diamond` | D | 3 | 主工具栏 | |
| `ellipse` | O | 4 | 主工具栏 | |
| `arrow` | A | 5 | 主工具栏 | |
| `line` | L | 6 | 主工具栏 | |
| `freedraw` | P 或 X | 7 | 主工具栏 | 自研笔刷的底层模式 |
| `text` | T | 8 | 主工具栏 | |
| `image` | — | 9 | 主工具栏 | 可用 `UIOptions.tools.image` 开关 |
| `eraser` | E | 0 | 主工具栏 | toggle 型工具 |
| `frame` | F | — | **⋯ 下拉** | |
| `embeddable` | — | — | **⋯ 下拉** | |
| `autoshape` | Shift+X | — | **⋯ 下拉** | 原生"Draw to shape"（本项目自研了同概念工具） |
| `laser` | K | — | **⋯ 下拉** | 本项目借它捕获手绘轨迹 |
| **`bucketfill`** | **B** | — | **⋯ 下拉** | ⚠️ **0.17 及更早叫 `fill`，0.18 改名 `bucketfill`** |
| `lasso` | — | — | 随 selection / ⋯ 下拉 | ⋯ 下拉中仅**完整样式面板模式**下显示 |
| `custom`（本项目） | — | — | 自研 | 需配 `customType`，见 §5 |

> ⚠️ **重点坑**：油漆桶在桌面端**不在主工具栏**，收在工具栏末尾的 "⋯"（ExtraToolsDropdown）里；
> 且类型名是 `bucketfill` 而不是旧文档的 `fill`。编程激活：
>
> ```ts
> api.setActiveTool({ type: "bucketfill" });
> appState.activeTool.type === "bucketfill"; // 判断当前工具
> ```

工具栏按钮渲染逻辑：搜索 `ExtraToolsDropdown`（桌面端）与 `MobileToolbar`（移动端）。
某工具"UI 上找不到"先确认它属于主栏还是 ⋯ 下拉，再检查 `UIOptions` 有没有关掉它。

---

## 3. UI 全景与隐秘角落（实测：ExtraToolsDropdown / 主菜单 / 侧边栏 / 语言包）

桌面端 LayerUI 的构成（组件源码均在 `dist/dev/index.js`，行号为 0.18.0-abeeaeb 快照）：

```
┌────────────────────────────────────────────────────────────┐
│ 主菜单(汉堡)  │              画布区              │ 侧边栏触发 ▤ │
│  撤销 重做    │   （样式面板：选中元素/形状时弹出）   │  缩放控件    │
│  主工具栏：手│选择│□│◇│○│→│╱│✏│T│🖼|🧽│ ⋯ │              │
└────────────────────────────────────────────────────────────┘
```

### 3.1 主工具栏（按钮级细节）

桌面端主工具栏渲染顺序（#L37602-37645），与实机截图从左到右一一对应：

| 按钮 | 角标 | 行为要点 |
| --- | --- | --- |
| 🔒 锁定按钮 LockButton | Q | `checked = activeTool.locked`（#L37404）。开启后形状工具画完**不自动回退** selection（#L41914）。⚠️ 本项目自定义工具 `setActiveTool({ ..., locked: true })` 也会点亮它 |
| 分隔线 | | 仅当宿主未传 `activeTool` prop 时，锁定按钮+分隔线才渲染（#L37602） |
| ✋ hand | — | |
| ▶ selection | 1 | **再次点击已激活的 selection 会切换到 lasso**（#L9637 onSelect）；compact 模式下变成 SelectionToolPopover（长按/点开选 selection 或 lasso） |
| □ rectangle | 2 | |
| ◇ diamond | 3 | |
| ○ ellipse | 4 | |
| → arrow | 5 | |
| ╱ line | 6 | |
| ✏ freedraw | 7 | compact 模式下变成 FreedrawToolPopover |
| A text | 8 | |
| 🖼 image | 9 | 受 `UIOptions.tools.image` 开关控制（#L37629） |
| 🧽 eraser | 0 | |
| 分隔线 → ⋯ | | ExtraToolsDropdown，见 §3.2 |

- **角标规则**（#L9603）：`keyBindingLabel = 数字键优先，否则字母键`。
  这些工具都有数字键（1-9、0），所以截图里全显示数字；只有字母键的工具（如 frame F）才显示字母。
- **样式面板三态**：`deriveStylesPanelMode(app.editorInterface)` 推导出
  `full / compact / mobile`（#L7147）。compact（窄桌面窗口）时 selection 和 freedraw
  合并成弹出按钮（#L37621、#L37627），同时 ⋯ 下拉里才出现"套索选择"条目。
- **⋯ 按钮联动**：当前激活 frame / embeddable / autoshape / lasso / bucketfill / laser
  之一时，⋯ 按钮图标变成该工具图标并高亮（#L37442、#L37452），提示工具"藏"在里面。

### 3.2 "⋯" 下拉（ExtraToolsDropdown，#L37423）完整条目与顺序

1. `frame` 画框工具（F）
2. `embeddable` 嵌入网页
3. `autoshape` Draw to shape（Shift+X）
4. `laser` 激光笔（K）
5. `bucketfill` Bucket fill（B）
6. `lasso` 套索选择 —— **仅 `useStylesPanelMode() === "full"` 时渲染**（#L37521）
7. 分组标题 **"Generate"**（硬编码英文，#L37532）
8. TTDDialogTrigger（AI 入口，`app.props.aiEnabled !== false` 才渲染，#L37533）
9. Mermaid 至 Excalidraw（`app.setOpenDialog({ name: "ttd", tab: "mermaid" })`）

> 想隐藏 AI 入口：给 `<Excalidraw>` 传 `aiEnabled={false}`。

### 3.3 主菜单（汉堡）条目 ↔ `UIOptions.canvasActions` 开关对照

默认主菜单 `DefaultMainMenu`（#L37654）与开关类型 `CanvasActions`
（`dist/types/excalidraw/types.d.ts` #L838）实测对应：

| 菜单条目 | 快捷键 | 开关 | 本项目设置 |
| --- | --- | --- | --- |
| 打开（加载场景） | Ctrl+O | `canvasActions.loadScene` | `false` |
| 保存到… | Ctrl+S | `canvasActions.saveToActiveFile` | `false` |
| 导出图片… | Ctrl+Shift+E | `canvasActions.saveAsImage` | 默认开 |
| 导出… | — | `canvasActions.export`（`false` 或 `ExportOpts`） | `{ saveFileToDisk: true }` |
| 在画布上查找 | Ctrl+F | **无开关，始终渲染** | — |
| 帮助 | ? | **无开关，始终渲染** | — |
| 重置画布 | — | `canvasActions.clearCanvas` | 默认开 |
| Excalidraw links（GitHub/关注/Discord） | — | **无开关，始终渲染**（DefaultMainMenu 兜底版） | — |
| 切换主题 | — | `canvasActions.toggleTheme`（`boolean \| null`） | `false` |
| 画布背景 | — | `canvasActions.changeViewBackgroundColor` | 默认开 |

- `tools: { image: boolean }` 是 `UIOptions` 里另一组独立开关（控制主工具栏图片按钮）。
- 想完全接管主菜单：给 `<Excalidraw>` 传 `<MainMenu>` children（自定义条目），
  传了之后 DefaultMainMenu 兜底版不再出现。

### 3.4 侧边栏：库面板与画布内查找

侧边栏是统一容器 `DefaultSidebar`（#L31205），内含两个 Tab，触发按钮 ▤
（DefaultSidebarTrigger）只在**未停靠**时显示（#L37923）：

| Tab | 内容 | 打开方式 |
| --- | --- | --- |
| `LIBRARY_SIDEBAR_TAB` | 库面板 LibraryMenu："尚未添加任何项目…"、"浏览素材库"（公共素材库 libraries.excalidraw.com） | 点 ▤ 图标 |
| `CANVAS_SEARCH_TAB` | 画布内查找 SearchMenu（搜索/替换元素文本） | 主菜单"在画布上查找"或 **Ctrl+F**（`actionToggleSearchMenu` #L21736） |

编程打开库面板：`api.updateScene({ appState: { openSidebar: { name: "default", tab: LIBRARY_SIDEBAR_TAB } } })`
（#L15167 同款写法）。

### 3.5 命令面板与帮助

- **命令面板**：`Ctrl+/`（#L14515 `isCommandPaletteToggleShortcut`），组件
  `components/CommandPalette`，可执行所有注册过的 action，调试时很好用。
- **帮助对话框**：`?` 键，列出全部快捷键（源码 `helpDialog` 命名空间）。
- 油漆桶专属交互：`bucketfill` 激活时样式面板/顶部栏换成
  `changeBucketFillBackgroundColor` action（#L18146、#L18522），最近使用的填充色
  存在 `appState.colorTopPicks.bucketFill`（#L5398）。

### 3.6 语言包陷阱：zh-CN 翻译不全（界面混英文的根源）

实测 `dist/dev/locales/zh-CN-RSRHKN75.js`：

- `toolBar.autoshape: ""` —— **翻译是空字符串**，界面回退英文 "Draw to shape"
- **`toolBar.bucketfill` 条目整个缺失** —— 界面显示英文 "Bucket fill"
- 其余如 `lasso: "套索选择"`、`frame: "画框工具"`、`laser: "激光笔"`、
  `embeddable: "嵌入网页"` 均正常

规律：0.18 新增的工具（bucketfill/autoshape）zh-CN 翻译滞后；`t()` 查不到或为空串时
回退内置英文包（`chunk-7QNTKOP3.js`，其中 `bucketfill: "Bucket fill"` #L336）。
**不要以为是功能没装上**。自定义组件里引用工具名时，建议自己维护一份中文名映射表。

---

## 4. 常用 API 速查（本项目实际在用）

### 4.1 导入路径（0.18 的类型子路径）

```ts
// 运行时导出（App.tsx 实测可用）
import {
  Excalidraw, exportToBlob, exportToSvg, serializeAsJSON, loadFromBlob,
  THEME, CaptureUpdateAction,
} from "@excalidraw/excalidraw";

// 类型
import type { ExcalidrawImperativeAPI, AppState, BinaryFileData,
  BinaryFiles, ActiveTool, PointerDownState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, ExcalidrawFreeDrawElement,
  ExcalidrawLineElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
```

### 4.2 ExcalidrawImperativeAPI 常用方法

| 方法 | 说明 | 本项目用法 |
| --- | --- | --- |
| `updateScene({ elements?, appState?, captureUpdate? })` | **浅合并**写入场景/状态 | 见下方陷阱 |
| `getAppState()` | 读当前 AppState（注意是快照，勿整包回写） | 风格面板初始化 |
| `getSceneElements()` | 读场景元素 | 保存/序列化 |
| `setActiveTool({ type, customType?, locked? })` | 切换工具 | 自定义工具 + `locked: true` |
| `addFiles(files)` | 注册图片二进制 | 恢复场景时必须单独调用（`SceneData` 无 `files` 字段） |
| `getFiles()` | 读图片资源 | 与场景一起持久化 |
| `setToast({ message, closable })` | 画布内提示 | `as never` 绕过类型收窄 |
| `resetScene()` | 清空场景 | |

### 4.3 updateScene 两大陷阱（项目内已踩过）

1. **浅合并**：`updateScene({ appState })` 只合并传入字段。
   反例：把 `getAppState()` 整包回写 → 会把尚未落地的 `activeTool` 冲掉，
   自定义画笔立刻退回选择工具（[App.tsx](../src/App.tsx) `handleStyleChange` 注释）。
   ✅ 正确姿势：只传要改的字段。
2. **必须带 `captureUpdate`**：不带时 updateScene 只发 ephemeral 增量，
   撤销栈不收录。提交正式元素用
   `captureUpdate: CaptureUpdateAction.IMMEDIATELY`；
   拖拽中的临时预览用 `CaptureUpdateAction.EVENTUALLY`。

### 4.4 `<Excalidraw>` 组件回调（自研工具的事件链）

```tsx
<Excalidraw
  onExcalidrawAPI={(api) => { /* 存 ref + 挂 window.__painterAPI 便于控制台调试 */ }}
  onChange={(elements, appState, files) => { /* 同步持久化 */ }}
  onPointerDown={(activeTool, pointerDownState) => { /* 自定义工具开始采点 */ }}
  onPointerUpdate={(payload) => { /* 移动中追加轨迹点 */ }}
  onPointerUp={(activeTool) => { /* 结束：构建正式元素 + IMMEDIATELY 提交 */ }}
  UIOptions={{ canvasActions: {...}, tools: { image: true } }}
  langCode="zh-CN"
/>
```

---

## 5. 本项目架构（改笔刷前必读）

### 5.1 自定义工具机制

自研工具不注册进 Excalidraw 的 `TOOLS` 表，而是用原生 `custom` 槽位：

```ts
api.setActiveTool({ type: "custom", customType: "smart-shape", locked: true });
// 判断：tool.type === "custom" && tool.customType === SMART_SHAPE_TOOL
```

链路：`onPointerDown` 采点 → `onPointerUpdate` 追加 → `onPointerUp`
用 `buildShapeElement` / `buildFreedrawElement` 构造元素 →
`updateScene({ elements: [...], captureUpdate: IMMEDIATELY })`。

### 5.2 多笔刷（[src/lib/pens.ts](../src/lib/pens.ts)）

底层全部是 freedraw 元素，靠 perfect-freehand 参数组合区分手感：

- `variability: "variable"` → size = strokeWidth × 4.25，线宽随速度变化（钢笔/铅笔）
- `variability: "constant"` → size = strokeWidth × 1.4，完全等宽（圆珠笔/蜡笔/荧光笔）
- 关键参数：`strokeWidth`、`streamline`（平滑）、`opacity`、`simulatePressure`（统一 false，
  由自己按速度算 pressures）

面板"细/中/粗"是**缩放系数**（thin 0.55 / medium 1 / bold 1.7），不直接覆盖 strokeWidth。

### 5.3 颗粒笔（铅笔/蜡笔）渲染钩子

Excalidraw 没有自定义渲染器 API，[scripts/patch-excalidraw.mjs](../scripts/patch-excalidraw.mjs)
在 `drawElementOnCanvas()` 的 `case "freedraw"` 分支注入钩子：

- 元素带 `customData.grainKind`（`"pencil" | "crayon"` + `grainSeed`）→ 交给
  [src/lib/grainElementRenderer.ts](../src/lib/grainElementRenderer.ts)（WebGL，降级 2D）
- SVG 导出另有 `window.__painterGrainSvgRender` 钩子（4 个 dist 文件都要打补丁）
- ⚠️ 钩子收到的 context 是 **element-local 离屏画布**，**不要**再 `translate(element.x/y)`，
  否则双重平移导致笔迹不可见

### 5.4 荧光笔（完全自绘）

`buildHighlighterStrokeElement` + polygon-clipping：
Douglas-Peucker 抽稀 → 段四边形切割 → 布尔并集，生成等宽平头轮廓。
直接画最终元素（预览即结果），解决原生 LaserPointer 等宽模式端头是半圆弧、
以及交叉区域非零填充规则挖出白斑的问题。

### 5.5 样式与 CSS 覆盖约定

- 所有形状生成走 [src/lib/buildShapeElement.ts](../src/lib/buildShapeElement.ts)，
  保证 `roughness` / `roundness`（直角 → 圆角，默认直角）统一生效
- 智能画笔激活时给根节点加 `.app.smart-shape-active`，用 CSS 隐藏原生工具栏选中效果
  （[src/App.css](../src/App.css)），避免视觉打架
- 笔刷预设持久化：`localStorage`（key `painter-pen-presets-v1`）
- 项目场景持久化：key `painter:scene:v1`（[src/App.tsx](../src/App.tsx) `STORAGE_KEY`）

---

## 6. "检测不到 XX" 排查三步法

遇到"原生明明有 X 功能，代码/界面里却找不到"，按顺序查：

1. **确认版本事实**：在 `node_modules/@excalidraw/excalidraw/dist/dev/` 里直接
   `grep` 关键词（如 `bucket`、`lasso`、`frame`）。dist/dev 是可读源码，
   命中即为存在；不要凭网上教程的版本印象下结论。
2. **确认类型名与语言包**：跨大版本类型名会变（`fill` → `bucketfill`）。
   用 0.18 的 `TOOLS` 注册表核对 `activeTool.type` 的合法值；
   中文界面混英文 ≠ 功能缺失，先查 `dist/dev/locales/zh-CN-*.js` 是否缺条目（§3.6）。
3. **确认 UI 位置与开关**：主工具栏 vs `ExtraToolsDropdown`（⋯）vs `MobileToolbar`；
   再检查 `<Excalidraw>` 的 `UIOptions`（canvasActions/tools）与全局 CSS 有没有隐藏它。

---

## 7. 踩坑记录（持续追加）

| # | 坑 | 结论 |
| --- | --- | --- |
| 1 | 油漆桶"检测不到" | 0.18 类型名 `bucketfill`（旧名 `fill`），且藏在桌面端 ⋯ 下拉，快捷键 B |
| 2 | 中文界面显示 "Bucket fill" / "Draw to shape" 英文 | zh-CN 语言包翻译滞后：`bucketfill` 条目缺失、`autoshape` 为空串（§3.6），不是功能问题 |
| 3 | updateScene 整包回写 appState | 浅合并会冲掉未落地的 activeTool，自定义工具退回选择工具；只传增量字段 |
| 4 | updateScene 漏 captureUpdate | 撤销栈不收录；正式提交用 `IMMEDIATELY`，临时预览用 `EVENTUALLY` |
| 5 | koa-connect 包装 Express 中间件 | ctx.state 数据丢失，需原生 Koa 重写 |
| 6 | adjustRoughness 效果不生效 | 它按元素 width/height/roundness 调整线条风格，三要素要一起设置 |
| 7 | freedraw 笔刷中途换手感 | roughness 在绘制中实时作用于控制点，`setAppState` 直接切换最有效 |
| 8 | LaserPointer 等宽模式端头 | 底层是半圆弧，参数改不成平头 → 荧光笔改自绘轮廓方案 |
| 9 | 颗粒笔迹不可见 | 渲染钩子 context 是 element-local 离屏空间，二次 translate 导致越界 |
| 10 | 点完按钮后 Ctrl+Z 失灵 | 焦点还在按钮上；`refocusCanvas()` 把焦点交还 `.excalidraw` |
| 11 | 图片恢复后丢失 | `updateScene` 的 SceneData 无 files 字段，二进制必须走 `addFiles()` |
| 12 | ⋯ 下拉里找不到"套索选择" | 仅完整样式面板模式（full styles panel）渲染该条目，紧凑模式下走 selection 长按 |
| 13 | 主菜单多了"在画布上查找/帮助/社交链接"想关掉 | 这三个条目在 DefaultMainMenu 兜底版中无开关，需自定义 `<MainMenu>` children 接管 |
| 14 | 锁定按钮（Q）莫名高亮、形状画完不回退选择工具 | `activeTool.locked` 为 true；本项目自定义画笔/智能画笔 `setActiveTool({ locked: true })` 也会点亮它，退出时记得切回 `setActiveTool({ type: "selection" })` |

---

## 8. 官方资源

- 仓库（monorepo，源码以 `packages/excalidraw`、`packages/element` 为主）：
  https://github.com/excalidraw/excalidraw
- 组件文档：https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api
- ⚠️ 官方文档对 nightly 版有滞后，**类型名/参数以本项目 node_modules 的 dist/dev 源码为准**。
