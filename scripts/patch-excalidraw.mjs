// 把自研颗粒渲染器注入 Excalidraw 的 freedraw 渲染管线。
//
// Excalidraw 没有公开的自定义元素渲染器，而自研笔迹要参与撤销 / 选择 /
// 橡皮擦，必须作为场景 freedraw 元素渲染。这里在 @excalidraw/element
// 的 drawElementOnCanvas() freedraw 分支开头挂一个钩子：元素带有
// customData.grainKind 时，改由应用注册的 window.__painterGrainElementRender
// 绘制颗粒，其余元素走原生路径。

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const TARGETS = [
  {
    file: "node_modules/@excalidraw/element/dist/dev/index.js",
    anchor: 'case "freedraw": {',
    marker: "window.__painterGrainElementRender",
    after: '      if (element.customData?.grainKind && typeof window !== "undefined" && window.__painterGrainElementRender) {\n        window.__painterGrainElementRender(element, context, renderConfig);\n        break;\n      }\n',
  },
  {
    file: "node_modules/@excalidraw/element/dist/prod/index.js",
    anchor: 'case"freedraw":{',
    marker: "window.__painterGrainElementRender",
    after: 'if(e.customData?.grainKind&&typeof window!="undefined"&&window.__painterGrainElementRender){window.__painterGrainElementRender(e,n,i);break}',
  },
  {
    file: "node_modules/@excalidraw/excalidraw/dist/dev/chunk-6WU4HLK7.js",
    anchor:
      'case "freedraw": {\n      const wrapper = svgRoot.ownerDocument.createElementNS(SVG_NS, "g");',
    marker: "window.__painterGrainSvgRender",
    after:
      '\n      if (element.customData?.grainKind && typeof window !== "undefined" && window.__painterGrainSvgRender) {\n' +
      '        const grainWrapper = svgRoot.ownerDocument.createElementNS(SVG_NS, "g");\n' +
      '        const grainNode = window.__painterGrainSvgRender(element, svgRoot.ownerDocument, renderConfig);\n' +
      '        if (grainNode) {\n' +
      '          grainWrapper.appendChild(grainNode);\n' +
      '          if (opacity !== 1) {\n' +
      '            grainWrapper.setAttribute("stroke-opacity", `${opacity}`);\n' +
      '            grainWrapper.setAttribute("fill-opacity", `${opacity}`);\n' +
      '          }\n' +
      '          grainWrapper.setAttribute(\n' +
      '            "transform",\n' +
      '            `translate(${offsetX || 0} ${offsetY || 0}) rotate(${degree} ${cx} ${cy})`\n' +
      '          );\n' +
      '          grainWrapper.setAttribute("stroke", "none");\n' +
      '          addToRoot(grainWrapper, element);\n' +
      '          break;\n' +
      '        }\n' +
      '      }\n',
  },
  {
    file: "node_modules/@excalidraw/excalidraw/dist/prod/chunk-RM4UPSZO.js",
    anchor: 'case"freedraw":{',
    marker: "window.__painterGrainSvgRender",
    after:
      'if(e.customData?.grainKind&&typeof window!="undefined"&&window.__painterGrainSvgRender){let b=a.ownerDocument.createElementNS(Y,"g"),v=window.__painterGrainSvgRender(e,a,o);if(v){b.appendChild(v),p!==1&&(b.setAttribute("stroke-opacity",`${p}`),b.setAttribute("fill-opacity",`${p}`)),b.setAttribute("transform",`translate(${t||0} ${d||0}) rotate(${i} ${R} ${g})`),b.setAttribute("stroke","none"),N(b,e);break}}',
  },
];

let patched = 0;

for (const target of TARGETS) {
  if (!existsSync(target.file)) {
    console.warn(`[patch-excalidraw] 文件不存在，跳过：${target.file}`);
    continue;
  }
  let src = readFileSync(target.file, "utf8");
  if (src.includes(target.marker)) {
    console.log(`[patch-excalidraw] 已打过补丁，跳过：${target.file}`);
    patched++;
    continue;
  }

  const at = src.indexOf(target.anchor);
  if (at < 0) {
    console.warn(`[patch-excalidraw] 找不到锚点，跳过：${target.file}`);
    continue;
  }
  const insertAt = at + target.anchor.length;
  src = src.slice(0, insertAt) + target.after + src.slice(insertAt);

  if (!src.includes(target.marker)) {
    console.error(`[patch-excalidraw] 插入失败：${target.file}`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(target.file, src);
  patched++;
  console.log(`[patch-excalidraw] 已注入：${target.file}`);
}

console.log(`[patch-excalidraw] 完成，共处理 ${patched}/${TARGETS.length} 个文件`);
