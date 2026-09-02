// 把自研渲染钩子注入 Excalidraw 的内部管线。
//
// 1) 颗粒笔迹（freedraw 渲染 + SVG 导出）—— 已稳定。
// 2) 文字格式化（方向 / 行距 / 字体间距）：
//    - 横排 + 字距：在原生文字渲染分支注入 context.letterSpacing。
//    - 竖排：原生分支开头路由到 window.__painterTextRender 钩子（逐字竖向堆叠）。
//    - 包围盒：redrawTextBoundingBox 的尺寸计算改由 window.__painterMeasureText 接管，
//      保证选中框与文字精确贴合（导出 PNG 也自带正确尺寸）。
//
// 锚点分 dev（未压缩，可读）与 prod（压缩）两套；某套锚点找不到时仅告警跳过。

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

  // ===== 文字格式化：@excalidraw/element 文字渲染分支 + 包围盒测量 =====
  // —— 横排 + 字距：在原生文字分支注入 context.letterSpacing（dev） ——
  {
    file: "node_modules/@excalidraw/element/dist/dev/index.js",
    anchor: '        context.textAlign = element.textAlign;',
    marker: "__painterLetterSpacing",
    after:
      '        context.textAlign = element.textAlign;\n        /* __painterLetterSpacing */\n        if (element.customData && element.customData.letterSpacing) { context.letterSpacing = `${element.customData.letterSpacing}px`; }\n',
  },
  // —— 竖排：原生文字分支开头路由到自研钩子（dev） ——
  {
    file: "node_modules/@excalidraw/element/dist/dev/index.js",
    anchor: '        context.canvas.setAttribute("dir", rtl ? "rtl" : "ltr");',
    marker: "window.__painterTextRender",
    after:
      '\n' +
      '        if (element.customData && element.customData.textDirection === "vertical") {\n' +
      '          if (typeof window !== "undefined" && window.__painterTextRender) {\n' +
      '            window.__painterTextRender(element, context, renderConfig, { rtl });\n' +
      '            break;\n' +
      '          }\n' +
      '        }\n',
  },
  // —— 包围盒：redrawTextBoundingBox 尺寸改由自研函数计算（dev，需把 const 改为 let） ——
  {
    file: "node_modules/@excalidraw/element/dist/dev/index.js",
    anchor:
      "  const metrics = measureText(\n    boundTextUpdates.text,\n    getFontString2(textElement),\n    textElement.lineHeight\n  );",
    marker: "window.__painterMeasureText",
    replace: true,
    after:
      "  let metrics = measureText(\n    boundTextUpdates.text,\n    getFontString2(textElement),\n    textElement.lineHeight\n  );\n" +
      "  if (textElement.customData && (textElement.customData.textDirection === \"vertical\" || (textElement.customData.letterSpacing && textElement.customData.letterSpacing !== 0))) {\n" +
      "    if (typeof window !== \"undefined\" && window.__painterMeasureText) {\n" +
      "      metrics = window.__painterMeasureText(textElement);\n" +
      "    }\n" +
      "  }\n",
  },

  // —— 同上三处，prod（压缩）形态 ——
  {
    file: "node_modules/@excalidraw/element/dist/prod/index.js",
    anchor:
      'n.font=Ch(e),n.fillStyle=pr(e.strokeColor,i.theme===Mi.DARK),n.textAlign=e.textAlign;',
    marker: "__painterLetterSpacing",
    after:
      'n.font=Ch(e),n.fillStyle=pr(e.strokeColor,i.theme===Mi.DARK),n.textAlign=e.textAlign;/* __painterLetterSpacing */e.customData&&e.customData.letterSpacing&&(n.letterSpacing=e.customData.letterSpacing+"px");',
  },
  {
    file: "node_modules/@excalidraw/element/dist/prod/index.js",
    anchor: 'n.canvas.setAttribute("dir",o?"rtl":"ltr"),',
    marker: "window.__painterTextRender",
    // 该锚点尾随逗号（处于逗号表达式链中），直接插入 if 语句会 PARSE_ERROR；
    // 整段替换并把尾随逗号改为分号，使 setAttribute 成为独立语句，if 才合法。
    replace: true,
    after:
      'n.canvas.setAttribute("dir",o?"rtl":"ltr");if(e.customData&&e.customData.textDirection==="vertical"){window.__painterTextRender&&window.__painterTextRender(e,n,i,{rtl:o});break}',
  },
  {
    file: "node_modules/@excalidraw/element/dist/prod/index.js",
    anchor: "let s=ft(r.text,Wo(e),e.lineHeight);",
    marker: "window.__painterMeasureText",
    replace: true,
    after:
      'let s=ft(r.text,Wo(e),e.lineHeight);if(e.customData&&(e.customData.textDirection==="vertical"||e.customData.letterSpacing&&e.customData.letterSpacing!==0)){let m=window.__painterMeasureText&&window.__painterMeasureText(e);m&&(s=m)}',
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
  if (target.replace) {
    // 整段替换锚点（用于需改变量声明方式，如 const → let），否则会在原声明后追加造成重复声明
    src = src.replace(target.anchor, target.after);
  } else {
    const insertAt = at + target.anchor.length;
    src = src.slice(0, insertAt) + target.after + src.slice(insertAt);
  }

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
