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

  // ===== 文字框：可独立设定高度 + 垂直对齐 =====
  // 原生把「拖上下手柄」翻译成缩放字号（resizeSingleTextElement 里
  // transformHandleType 含 n/s 即改 fontSize）。这里只对**纯 n / s**（上下中间手柄）
  // 改道为设置框高度；四个角手柄保留原生等比缩放，方便快速放大字号。
  // 高度写进 customData.fixedHeight，由 redrawTextBoundingBox 负责兜底不小于内容高度。
  {
    file: "node_modules/@excalidraw/element/dist/dev/index.js",
    anchor:
      "var resizeSingleTextElement = (origElement, element, scene, transformHandleType, shouldResizeFromCenter, nextWidth, nextHeight) => {",
    marker: "__painterFixedHeightResize",
    after:
      "\n" +
      "  /* __painterFixedHeightResize 上下中间手柄 → 改框高度，不改字号 */\n" +
      "  if (transformHandleType === \"n\" || transformHandleType === \"s\") {\n" +
      "    const painterNat = typeof window !== \"undefined\" && window.__painterMeasureText ? window.__painterMeasureText(element) : null;\n" +
      "    const painterNatH = painterNat && typeof painterNat.height === \"number\" ? painterNat.height : element.height;\n" +
      "    const painterH = nextHeight < painterNatH ? painterNatH : nextHeight;\n" +
      "    const painterOrigin = pointFrom17(origElement.x, origElement.y);\n" +
      "    const painterNext = getResizedOrigin(\n" +
      "      painterOrigin,\n" +
      "      origElement.width,\n" +
      "      origElement.height,\n" +
      "      element.width,\n" +
      "      painterH,\n" +
      "      origElement.angle,\n" +
      "      transformHandleType,\n" +
      "      false,\n" +
      "      shouldResizeFromCenter\n" +
      "    );\n" +
      "    scene.mutateElement(element, {\n" +
      "      height: painterH,\n" +
      "      x: painterNext.x,\n" +
      "      y: painterNext.y,\n" +
      "      customData: { ...(element.customData || {}), fixedHeight: painterH }\n" +
      "    });\n" +
      "    return;\n" +
      "  }\n",
  },
  // —— 包围盒：height 不再无条件等于测量高度，用户拉过的高度优先（但不小于内容）——
  {
    file: "node_modules/@excalidraw/element/dist/dev/index.js",
    anchor:
      "  if (textElement.autoResize) {\n    boundTextUpdates.width = metrics.width;\n  }\n  boundTextUpdates.height = metrics.height;",
    marker: "__painterFixedHeightKeep",
    replace: true,
    after:
      "  if (textElement.autoResize) {\n    boundTextUpdates.width = metrics.width;\n  }\n" +
      "  boundTextUpdates.height = metrics.height;\n" +
      "  /* __painterFixedHeightKeep 用户设定的框高度优先，但不小于内容高度以免裁切 */\n" +
      "  {\n" +
      "    const painterFixed = textElement.customData && textElement.customData.fixedHeight;\n" +
      "    if (typeof painterFixed === \"number\" && painterFixed > boundTextUpdates.height) {\n" +
      "      boundTextUpdates.height = painterFixed;\n" +
      "    }\n" +
      "  }\n",
  },
  // —— 渲染：框高于内容时，整块文字按 verticalAlign 下移 ——
  {
    file: "node_modules/@excalidraw/element/dist/dev/index.js",
    anchor:
      "        const verticalOffset = getVerticalOffset(\n          element.fontFamily,\n          element.fontSize,\n          lineHeightPx\n        );\n" +
      "        for (let index = 0; index < lines.length; index++) {\n" +
      "          context.fillText(\n" +
      "            lines[index],\n" +
      "            horizontalOffset,\n" +
      "            index * lineHeightPx + verticalOffset\n" +
      "          );\n" +
      "        }",
    marker: "__painterVerticalAlign",
    replace: true,
    after:
      "        const verticalOffset = getVerticalOffset(\n          element.fontFamily,\n          element.fontSize,\n          lineHeightPx\n        );\n" +
      "        /* __painterVerticalAlign 框高于内容时按 verticalAlign 下移整块文字 */\n" +
      "        let painterPadTop = 0;\n" +
      "        {\n" +
      "          const painterContentH = lines.length * lineHeightPx;\n" +
      "          const painterFree = element.height - painterContentH;\n" +
      "          if (painterFree > 0) {\n" +
      "            const painterVA = element.customData && element.customData.verticalAlign;\n" +
      "            painterPadTop = painterVA === \"bottom\" ? painterFree : painterVA === \"middle\" ? painterFree / 2 : 0;\n" +
      "          }\n" +
      "        }\n" +
      "        for (let index = 0; index < lines.length; index++) {\n" +
      "          context.fillText(\n" +
      "            lines[index],\n" +
      "            horizontalOffset,\n" +
      "            index * lineHeightPx + verticalOffset + painterPadTop\n" +
      "          );\n" +
      "        }",
  },

  // —— 同上三处的 prod（压缩）形态 ——
  // resize：Ox 形参 e=origElement t=element n=scene i=handle o=fromCenter r=nextWidth s=nextHeight
  {
    file: "node_modules/@excalidraw/element/dist/prod/index.js",
    anchor: "Ox=(e,t,n,i,o,r,s)=>{",
    marker: "__painterFixedHeightResize",
    after:
      '/*__painterFixedHeightResize*/if(i==="n"||i==="s"){let _pNat=typeof window!=="undefined"&&window.__painterMeasureText?window.__painterMeasureText(t):null,_pNatH=_pNat&&typeof _pNat.height==="number"?_pNat.height:t.height,_pH=s<_pNatH?_pNatH:s,_pO=me(e.x,e.y),_pNext=va(_pO,e.width,e.height,t.width,_pH,e.angle,i,!1,o);n.mutateElement(t,{height:_pH,x:_pNext.x,y:_pNext.y,customData:{...(t.customData||{}),fixedHeight:_pH}});return}',
  },
  {
    file: "node_modules/@excalidraw/element/dist/prod/index.js",
    // 注意：r.height=s.height 在 if 条件的逗号表达式里已执行，且块体仅在
    // 有绑定容器(t)时才跑——注入必须放在整条 if 之前、直接抬高 s.height，
    // 让随后的 r.height=s.height 自然带上固定高度。
    anchor: "if(e.autoResize&&(r.width=s.width),r.height=s.height,t){",
    marker: "__painterFixedHeightKeep",
    replace: true,
    after:
      'if(e.customData&&typeof e.customData.fixedHeight==="number"&&e.customData.fixedHeight>s.height)s.height=e.customData.fixedHeight;/*__painterFixedHeightKeep*/if(e.autoResize&&(r.width=s.width),r.height=s.height,t){',
  },
  {
    file: "node_modules/@excalidraw/element/dist/prod/index.js",
    anchor:
      "d=kh(e.fontFamily,e.fontSize,l);for(let c=0;c<s.length;c++)n.fillText(s[c],a,c*l+d);",
    marker: "__painterVerticalAlign",
    replace: true,
    after:
      "d=kh(e.fontFamily,e.fontSize,l);/*__painterVerticalAlign*/let _pPad=0;{let _pCH=s.length*l,_pFree=e.height-_pCH;if(_pFree>0){let _pVA=e.customData&&e.customData.verticalAlign;_pPad=_pVA===\"bottom\"?_pFree:_pVA===\"middle\"?_pFree/2:0}}for(let c=0;c<s.length;c++)n.fillText(s[c],a,c*l+d+_pPad);",
  },

  // —— 编辑态：wysiwyg textarea 与渲染态对齐 ——
  // textarea 的高度直接取 element.height，且 CSS vertical-align 对 textarea 无效，
  // 所以框高于内容时编辑文字会跳回顶部。补一个 paddingTop 让两处落位一致。
  // 绑定容器的文字不受影响（其 height 等于内容高度，富余为 0）。
  {
    file: "node_modules/@excalidraw/excalidraw/dist/dev/index.js",
    anchor:
      "        opacity: updatedTextElement.opacity / 100,\n        maxHeight: `${editorMaxHeight}px`\n      });",
    marker: "__painterVerticalAlignEdit",
    after:
      "\n      /* __painterVerticalAlignEdit 编辑态文字与渲染态垂直对齐 */\n" +
      "      {\n" +
      "        const _pEl = updatedTextElement;\n" +
      "        const _pLh = _pEl.fontSize * _pEl.lineHeight;\n" +
      "        const _pContentH = _pEl.text.replace(/\\r\\n?/g, \"\\n\").split(\"\\n\").length * _pLh;\n" +
      "        const _pFree = _pEl.height - _pContentH;\n" +
      "        if (_pFree > 0) {\n" +
      "          const _pVA = _pEl.customData && _pEl.customData.verticalAlign;\n" +
      "          const _pPad = _pVA === \"bottom\" ? _pFree : _pVA === \"middle\" ? _pFree / 2 : 0;\n" +
      "          if (_pPad > 0) {\n" +
      "            editable.style.paddingTop = `${_pPad}px`;\n" +
      "          }\n" +
      "        }\n" +
      "      }\n",
  },
  {
    // 注意：原 Object.assign 之后紧跟 `,c={...}` 逗号表达式链，在其后插语句会
    // PARSE_ERROR。锚定它前面的 `;`，把代码块插在 Object.assign 之前（语句间隙）。
    file: "node_modules/@excalidraw/excalidraw/dist/prod/index.js",
    anchor: "ight-Qr)/N.zoom.value;",
    marker: "__painterVerticalAlignEdit",
    after:
      "/*__painterVerticalAlignEdit*/{let _pLh=H.fontSize*H.lineHeight,_pCH=H.text.replace(/\\r\\n?/g,`\n`).split(`\n`).length*_pLh,_pFr=H.height-_pCH;if(_pFr>0){let _pVA=H.customData&&H.customData.verticalAlign,_pPd=_pVA===\"bottom\"?_pFr:_pVA===\"middle\"?_pFr/2:0;_pPd>0&&(u.style.paddingTop=`${_pPd}px`)}};",
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
