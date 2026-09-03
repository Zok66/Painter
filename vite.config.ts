import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const GRAIN_MARKER = '__painterGrainElementRender'
const GRAIN_SVG_MARKER = '__painterGrainSvgRender'

/**
 * 自研铅笔 / 蜡笔渲染钩子补丁。
 * Excalidraw 的 freedraw 渲染在 @excalidraw/element 里,这里在模块转换阶段
 * 直接注入:元素带 customData.grainKind 时改由应用注册的渲染器绘制颗粒。
 * 同时适配 element 包的 dev(unminified)与 prod(minified)两种形态。
 */
function patchExcalidrawRender(): Plugin {
  return {
    name: 'painter-patch-excalidraw-render',
    transform(code, id) {
      if (id.includes('@excalidraw/element/dist/')) {
        if (code.includes(GRAIN_MARKER)) return

        const devAnchor = 'case "freedraw": {'
        const prodAnchor = 'case"freedraw":{'
        let at = code.indexOf(devAnchor)
        if (at >= 0) {
          const insert =
            '      if (element.customData?.grainKind && typeof window !== "undefined" && window.__painterGrainElementRender) {\n' +
            '        window.__painterGrainElementRender(element, context, renderConfig);\n' +
            '        break;\n' +
            '      }\n'
          return (
            code.slice(0, at + devAnchor.length) +
            insert +
            code.slice(at + devAnchor.length)
          )
        }
        at = code.indexOf(prodAnchor)
        if (at >= 0) {
          const insert =
            'if(e.customData?.grainKind&&typeof window!="undefined"&&window.__painterGrainElementRender){window.__painterGrainElementRender(e,n,i);break}'
          return (
            code.slice(0, at + prodAnchor.length) +
            insert +
            code.slice(at + prodAnchor.length)
          )
        }
      }

      if (id.includes('@excalidraw/excalidraw/dist/')) {
        if (code.includes(GRAIN_SVG_MARKER)) return

        const devAnchor =
          'case "freedraw": {\n' +
          '      const wrapper = svgRoot.ownerDocument.createElementNS(SVG_NS, "g");'
        const prodAnchor = 'case"freedraw":{'
        let at = code.indexOf(devAnchor)
        if (at >= 0) {
          const insert =
            '\n' +
            '      if (element.customData?.grainKind && typeof window !== "undefined" && window.__painterGrainSvgRender) {\n' +
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
            '      }\n'
          return (
            code.slice(0, at + devAnchor.length) +
            insert +
            code.slice(at + devAnchor.length)
          )
        }
        at = code.indexOf(prodAnchor)
        if (at >= 0 && code.includes('createElementNS(Y,"g")')) {
          const insert =
            'if(e.customData?.grainKind&&typeof window!="undefined"&&window.__painterGrainSvgRender){let b=a.ownerDocument.createElementNS(Y,"g"),v=window.__painterGrainSvgRender(e,a,o);if(v){b.appendChild(v),p!==1&&(b.setAttribute("stroke-opacity",`${p}`),b.setAttribute("fill-opacity",`${p}`)),b.setAttribute("transform",`translate(${t||0} ${d||0}) rotate(${i} ${R} ${g})`),b.setAttribute("stroke","none"),N(b,e);break}}'
          return (
            code.slice(0, at + prodAnchor.length) +
            insert +
            code.slice(at + prodAnchor.length)
          )
        }
      }
    },
  }
}

const PAPER_MARKER = "__painterPaperRender";

/**
 * 纸张纹理（空白 / 横线 / 方格 / 点阵）注入。
 *
 * 钩子打在 _renderStaticScene 里 ctx.scale(zoom) 之后、原生 strokeGrid 之前。
 * 这个位置让纹理落在背景层：元素盖在它上面，原生网格（若开启）又盖在它下面一层，
 * 且导出 PNG / SVG 自带纹理。
 *
 * dev（未压缩）与 prod（压缩）两种产物形态不同，分别用各自的锚点；
 * 两边都匹配不上时原样返回，最坏情况只是没有纹理，不会破坏渲染。
 */
function patchPaperTexture(): Plugin {
  return {
    name: "painter-patch-paper-texture",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist/")) return;
      if (code.includes(PAPER_MARKER)) return;

      // dev：
      //   context.scale(appState.zoom.value, appState.zoom.value);
      //   if (renderGrid) {
      const devRe =
        /context\.scale\(appState\.zoom\.value,\s*appState\.zoom\.value\);(\s*)if \(renderGrid\) \{/;
      if (devRe.test(code)) {
        return code.replace(
          devRe,
          (_m, gap) =>
            `context.scale(appState.zoom.value, appState.zoom.value);${gap}` +
            `if (typeof window !== "undefined" && window.${PAPER_MARKER}) { window.${PAPER_MARKER}(context, appState.scrollX, appState.scrollY, appState.zoom, normalizedWidth, normalizedHeight); }${gap}` +
            `if (renderGrid) {`,
        );
      }

      // prod：
      //   E.scale(d.zoom.value,d.zoom.value),n&&Hf(E,d.gridSize,d.gridStep,d.scrollX,d.scrollY,d.zoom,o.theme,s/d.zoom.value,u/d.zoom.value)
      // 变量名是压缩生成的，用捕获组把上下文变量和宽高变量一起取出来再拼回去。
      const prodRe =
        /([A-Za-z_$][\w$]*)\.scale\(([A-Za-z_$][\w$]*)\.zoom\.value,\2\.zoom\.value\),([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)\(\1,\2\.gridSize,\2\.gridStep,\2\.scrollX,\2\.scrollY,\2\.zoom,([^,]+),([A-Za-z_$][\w$]*)\/\2\.zoom\.value,([A-Za-z_$][\w$]*)\/\2\.zoom\.value\)/;
      return code.replace(
        prodRe,
        (_m, ctx, app, flag, fn, theme, w, h) =>
          `${ctx}.scale(${app}.zoom.value,${app}.zoom.value),` +
          `window.${PAPER_MARKER}&&window.${PAPER_MARKER}(${ctx},${app}.scrollX,${app}.scrollY,${app}.zoom,${w},${h}),` +
          `${flag}&&${fn}(${ctx},${app}.gridSize,${app}.gridStep,${app}.scrollX,${app}.scrollY,${app}.zoom,${theme},${w}/${app}.zoom.value,${h}/${app}.zoom.value)`,
      );
    },
  };
}

/**
 * 原生 ColorInput 取色器替换为自研组件。
 *
 * 原生 Excalidraw ColorPicker 弹窗里「十六进制值」行使用原生 ColorInput，
 * 右侧只有一支铅笔 EyeDropper，点击会进入 Excalidraw 自己的取色状态（画布变暗）。
 * 这里通过 vite transform 把原生弹窗中的 ColorInput 调用替换为
 * window.__painterColorInput（即自研 ColorInput，定义在
 * src/excalidraw-color-picker/ColorInput.tsx，并在 src/nativeColorPatch.tsx
 * 挂到全局），从而在该行直接使用系统取色器 + 浏览器原生 EyeDropper API。
 *
 * dev（格式化源码）直接按 jsxN(ColorInput, { 定位调用点；
 * prod（压缩）先通过组件定义 var Ww=({color:e,...})=> 提取组件名，
 * 再替换 jsxFn(Ww,{ 调用。
 */
function patchNativeColorPicker(): Plugin {
  return {
    name: "painter-patch-native-color-picker",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist/")) return;
      if (code.includes("__painterColorInput")) return;

      // dev：格式化源码，调用处形如 jsx20(ColorInput, { ... })
      const devRe = /(jsx\d+)\(\s*ColorInput,\s*\{/;
      if (devRe.test(code)) {
        return code.replace(devRe, "$1(window.__painterColorInput, {");
      }

      // prod：压缩后组件名被缩短，先通过定义签名提取组件名
      const prodDefRe =
        /var (\w+)=\(\{color:e,onChange:t,label:n,colorPickerType:o,placeholder:r\}\)=>/;
      const defMatch = code.match(prodDefRe);
      if (defMatch) {
        const compName = defMatch[1];
        const callRe = new RegExp(`(jsx\\d+|\\w+)\\(${compName},\\{`);
        const callMatch = code.match(callRe);
        if (callMatch) {
          return code.replace(
            callRe,
            `${callMatch[1]}(window.__painterColorInput,{`,
          );
        }
      }

      return null;
    },
  };
}

/**
 * 文字格式化补丁（方向 / 行距 / 字距 / 文字框独立高度 / 垂直对齐）。
 *
 * 与上面几个补丁一样，在 vite 转换 @excalidraw 源码时**内存注入**，
 * 不写 node_modules（本机安全软件对 node_modules/@excalidraw 的 dist 文件加了写锁，
 * 无法原地改；用 transform 注入则完全绕开）。锚点与 scripts/patch-excalidraw.mjs
 * 一一对应；marker 用于幂等保护——已注入则跳过，避免 HMR / 重复转换时二次注入。
 *
 * 匹配按「包名（element / excalidraw）」而非具体文件名：因为生产构建会把
 * @excalidraw 拆成若干 chunk（index.js / chunk-*.js），文件名不固定；
 * 只要锚点命中即注入，对拆包免疫。颗粒渲染 / 纸张纹理 / 原生取色器由上面三个
 * 插件负责，本插件只处理文字相关。
 */
type TextPatch = {
  /** 目标包：element 或 excalidraw（按包名匹配，对 chunk 拆包免疫） */
  pkg: "element" | "excalidraw";
  anchor: string;
  marker: string;
  /** replace=true 时整段替换锚点（用于 const→let 等需要改声明的场景），否则在锚点后插入 */
  replace?: boolean;
  after: string;
};

const TEXT_PATCHES: TextPatch[] = [
  // —— 横排 + 字距：原生文字分支注入 context.letterSpacing（dev） ——
  {
    pkg: "element",
    anchor: '        context.textAlign = element.textAlign;',
    marker: "__painterLetterSpacing",
    after:
      '        context.textAlign = element.textAlign;\n        /* __painterLetterSpacing */\n        if (element.customData && element.customData.letterSpacing) { context.letterSpacing = `${element.customData.letterSpacing}px`; }\n',
  },
  // —— 竖排：原生文字分支开头路由到自研钩子（dev） ——
  {
    pkg: "element",
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
    pkg: "element",
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
  // —— 文字框：上下中间手柄改道为设置框高度（dev） ——
  {
    pkg: "element",
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
  // —— 包围盒：height 不再无条件等于测量高度，用户拉过的高度优先（dev，replace） ——
  {
    pkg: "element",
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
  // —— 渲染：框高于内容时，整块文字按 verticalAlign 下移（dev，replace） ——
  {
    pkg: "element",
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

  // ===== 以上 dev 的 prod（压缩）对应形态 =====
  {
    pkg: "element",
    anchor:
      'n.font=Ch(e),n.fillStyle=pr(e.strokeColor,i.theme===Mi.DARK),n.textAlign=e.textAlign;',
    marker: "__painterLetterSpacing",
    after:
      'n.font=Ch(e),n.fillStyle=pr(e.strokeColor,i.theme===Mi.DARK),n.textAlign=e.textAlign;/* __painterLetterSpacing */e.customData&&e.customData.letterSpacing&&(n.letterSpacing=e.customData.letterSpacing+"px");',
  },
  {
    pkg: "element",
    anchor: 'n.canvas.setAttribute("dir",o?"rtl":"ltr"),',
    marker: "window.__painterTextRender",
    // 该锚点尾随逗号（处于逗号表达式链中），直接插入 if 语句会 PARSE_ERROR；
    // 整段替换并把尾随逗号改为分号，使 setAttribute 成为独立语句，if 才合法。
    replace: true,
    after:
      'n.canvas.setAttribute("dir",o?"rtl":"ltr");if(e.customData&&e.customData.textDirection==="vertical"){window.__painterTextRender&&window.__painterTextRender(e,n,i,{rtl:o});break}',
  },
  {
    pkg: "element",
    anchor: "let s=ft(r.text,Wo(e),e.lineHeight);",
    marker: "window.__painterMeasureText",
    replace: true,
    after:
      'let s=ft(r.text,Wo(e),e.lineHeight);if(e.customData&&(e.customData.textDirection==="vertical"||e.customData.letterSpacing&&e.customData.letterSpacing!==0)){let m=window.__painterMeasureText&&window.__painterMeasureText(e);m&&(s=m)}',
  },
  // resize：当前 prod 压缩签名为 Yx=(e,t,n,i,o,r,s,a)=>{，形参
  // e=origElement t=element n=scene i=handle o=fromCenter r=nextWidth s=nextHeight（a=zoom 未用）。
  // 注意：prod 压缩名每次 npm install 可能变化，本锚点若失效构建会告警并跳过（dev 不受影响）。
  {
    pkg: "element",
    anchor: "Yx=(e,t,n,i,o,r,s,a)=>{",
    marker: "__painterFixedHeightResize",
    after:
      '/*__painterFixedHeightResize*/if(i==="n"||i==="s"){let _pNat=typeof window!=="undefined"&&window.__painterMeasureText?window.__painterMeasureText(t):null,_pNatH=_pNat&&typeof _pNat.height==="number"?_pNat.height:t.height,_pH=s<_pNatH?_pNatH:s,_pO=me(e.x,e.y),_pNext=va(_pO,e.width,e.height,t.width,_pH,e.angle,i,!1,o);n.mutateElement(t,{height:_pH,x:_pNext.x,y:_pNext.y,customData:{...(t.customData||{}),fixedHeight:_pH}});return}',
  },
  {
    pkg: "element",
    // 注意：r.height=s.height 在 if 条件的逗号表达式里已执行，且块体仅在有绑定容器(t)时
    // 才跑——注入必须放在整条 if 之前、直接抬高 s.height，让随后的 r.height=s.height 自然带上。
    anchor: "if(e.autoResize&&(r.width=s.width),r.height=s.height,t){",
    marker: "__painterFixedHeightKeep",
    replace: true,
    after:
      'if(e.customData&&typeof e.customData.fixedHeight==="number"&&e.customData.fixedHeight>s.height)s.height=e.customData.fixedHeight;/*__painterFixedHeightKeep*/if(e.autoResize&&(r.width=s.width),r.height=s.height,t){',
  },
  {
    pkg: "element",
    anchor:
      "d=kh(e.fontFamily,e.fontSize,l);for(let c=0;c<s.length;c++)n.fillText(s[c],a,c*l+d);",
    marker: "__painterVerticalAlign",
    replace: true,
    after:
      "d=kh(e.fontFamily,e.fontSize,l);/*__painterVerticalAlign*/let _pPad=0;{let _pCH=s.length*l,_pFree=e.height-_pCH;if(_pFree>0){let _pVA=e.customData&&e.customData.verticalAlign;_pPad=_pVA===\"bottom\"?_pFree:_pVA===\"middle\"?_pFree/2:0}}for(let c=0;c<s.length;c++)n.fillText(s[c],a,c*l+d+_pPad);",
  },
  // —— 折行：字距>0 时让 wrapText 按含字距宽度折行，与编辑态 textarea 原生折行一致（dev） ——
  {
    pkg: "element",
    anchor: "var redrawTextBoundingBox = (textElement, container, scene) => {",
    marker: "__painterWrapLSSet",
    after:
      '\n  /* __painterWrapLSSet 折行前挂上当前元素字距，供 wrapText 使用 */\n  window.__painterWrapLS = (textElement.customData && textElement.customData.letterSpacing) || 0;\n',
  },
  {
    pkg: "element",
    anchor: "  boundTextUpdates.height = metrics.height;",
    marker: "__painterWrapLSReset",
    after:
      '\n  /* __painterWrapLSReset 折行/测量结束，清除以免污染其他元素 */\n  window.__painterWrapLS = 0;\n',
  },
  {
    pkg: "element",
    anchor:
      'var wrapText = (text, font, maxWidth) => {\n  return getWrappedTextLines(text, font, maxWidth).map((line2) => line2.text).join("\\n");\n};',
    marker: "__painterWrapTextDev",
    replace: true,
    after:
      'var wrapText = (text, font, maxWidth) => {\n' +
      '  const _ls = (typeof window !== "undefined" && window.__painterWrapLS) || 0;\n' +
      '  if (!_ls) {\n' +
      '    return getWrappedTextLines(text, font, maxWidth).map((line2) => line2.text).join("\\n");\n' +
      '  }\n' +
      '  try {\n' +
      '    const _cv = document.createElement("canvas");\n' +
      '    const _ctx = _cv.getContext("2d");\n' +
      '    const _w = (s) => {\n' +
      '      _ctx.font = font;\n' +
      '      try { _ctx.letterSpacing = _ls + "px"; } catch (e) {}\n' +
      '      return _ctx.measureText(s).width;\n' +
      '    };\n' +
      '    const out = [];\n' +
      '    for (const orig of text.split("\\n")) {\n' +
      '      if (_w(orig) <= maxWidth) { out.push(orig); continue; }\n' +
      '      let cur = ""; let curW = 0;\n' +
      '      for (const ch of orig) {\n' +
      '        _ctx.font = font;\n' +
      '        try { _ctx.letterSpacing = _ls + "px"; } catch (e) {}\n' +
      '        const cw = _ctx.measureText(ch).width;\n' +
      '        if (curW + cw <= maxWidth || !cur) { cur += ch; curW += cw; }\n' +
      '        else { out.push(cur); cur = ch; curW = cw; }\n' +
      '      }\n' +
      '      if (cur) out.push(cur);\n' +
      '    }\n' +
      '    return out.join("\\n");\n' +
      '  } catch (e) {\n' +
      '    return getWrappedTextLines(text, font, maxWidth).map((line2) => line2.text).join("\\n");\n' +
      '  }\n' +
      '};',
  },
  // —— 折行 prod 对应（压缩） ——
  {
    pkg: "element",
    anchor: "Uo=(e,t,n)=>{",
    marker: "__painterWrapLSProdSet",
    after:
      'window.__painterWrapLS=(e.customData&&e.customData.letterSpacing)||0;',
  },
  {
    pkg: "element",
    anchor: "r.height=s.height,t){",
    marker: "__painterWrapLSProdReset",
    replace: true,
    after: "r.height=s.height,window.__painterWrapLS=0,t){",
  },
  {
    pkg: "element",
    anchor: "rn=(e,t,n)=>Mp(e,t,n).map(i=>i.text).join(`\n`)",
    marker: "__painterWrapTextProd",
    replace: true,
    after:
      'rn=(e,t,n)=>{const _ls=(typeof window!=="undefined"&&window.__painterWrapLS)||0;if(!_ls)return Mp(e,t,n).map(i=>i.text).join("\\n");try{const _cv=document.createElement("canvas");const _x=_cv.getContext("2d");const _w=s=>{_x.font=t;try{_x.letterSpacing=_ls+"px"}catch(err){}return _x.measureText(s).width};const o=[];for(const g of e.split("\\n")){if(_w(g)<=n){o.push(g);continue}let u="",f=0;for(const ch of g){_x.font=t;try{_x.letterSpacing=_ls+"px"}catch(err){}const cw=_x.measureText(ch).width;if(f+cw<=n||!u){u+=ch;f+=cw}else{o.push(u);u=ch;f=cw}}if(u)o.push(u)}return o.join("\\n")}catch(err){return Mp(e,t,n).map(i=>i.text).join("\\n")}}',
  },

  // —— 编辑态（wysiwyg textarea）：与渲染态对齐——垂直对齐 + 行距 + 字距（dev） ——
  {
    pkg: "excalidraw",
    anchor:
      "        opacity: updatedTextElement.opacity / 100,\n        maxHeight: `${editorMaxHeight}px`\n      });",
    marker: "__painterVerticalAlignEdit",
    after:
      "\n      /* __painterVerticalAlignEdit 编辑态文字与渲染态对齐：垂直对齐 + 行距 + 字距 */\n" +
      "      {\n" +
      "        const _pEl = updatedTextElement;\n" +
      "        /* 行距：原生编辑态 textarea 未显式设置 line-height，需同步 element.lineHeight，否则编辑态回落到 normal */\n" +
      "        editable.style.lineHeight = String(_pEl.lineHeight);\n" +
      "        /* 字距：customData.letterSpacing 是 Painter 扩展，原生 textarea 不识别，需手动映射 */\n" +
      "        const _pLS = _pEl.customData && _pEl.customData.letterSpacing;\n" +
      "        if (_pLS) { editable.style.letterSpacing = `${_pLS}px`; }\n" +
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
    pkg: "excalidraw",
    anchor: "ight-Qr)/N.zoom.value;",
    marker: "__painterVerticalAlignEdit",
    after:
      "/*__painterVerticalAlignEdit*/{let _pLh=H.fontSize*H.lineHeight;u.style.lineHeight=String(H.lineHeight);let _pLS=H.customData&&H.customData.letterSpacing;_pLS&&(u.style.letterSpacing=`${_pLS}px`);let _pCH=H.text.replace(/\\r\\n?/g,`\n`).split(`\n`).length*_pLh,_pFr=H.height-_pCH;if(_pFr>0){let _pVA=H.customData&&H.customData.verticalAlign,_pPd=_pVA===\"bottom\"?_pFr:_pVA===\"middle\"?_pFr/2:0;_pPd>0&&(u.style.paddingTop=`${_pPd}px`)}};",
  },
];

function patchTextFormatting(): Plugin {
  return {
    name: "painter-patch-text-formatting",
    transform(code, id) {
      const isElement = id.includes("@excalidraw/element/dist/")
      const isExcalidraw = id.includes("@excalidraw/excalidraw/dist/")
      if (!isElement && !isExcalidraw) return null
      let out = code
      let changed = false
      for (const p of TEXT_PATCHES) {
        if (p.pkg === "element" && !isElement) continue
        if (p.pkg === "excalidraw" && !isExcalidraw) continue
        if (out.includes(p.marker)) continue
        const at = out.indexOf(p.anchor)
        if (at < 0) {
          console.warn(`[text-format] 锚点未找到，跳过：${id} (${p.marker})`)
          continue
        }
        if (p.replace) {
          out = out.replace(p.anchor, p.after)
        } else {
          out = out.slice(0, at + p.anchor.length) + p.after + out.slice(at + p.anchor.length)
        }
        changed = true
      }
      return changed ? out : null
    },
  }
}

/**
 * 原生选中面板「操作」行注入翻转 / 镜像按钮。
 *
 * 原生 actionFlipHorizontal / actionFlipVertical 已在 actionManager 注册
 * （快捷键 Shift+H / Shift+V 就是它们），几何逻辑完整（处理箭头、绑定文字、
 * frame 成员、线性元素、旋转等边界），只是它没有 PanelComponent，因此
 * renderAction("flipHorizontal") 返回 null、原生面板不渲染翻转按钮。
 *
 * 这里直接在「操作」行的复制按钮之前注入两个 IconButton，点击时调用
 * app.actionManager.executeAction(flipAction, "api") 复用原生 perform，
 * 零自研翻转逻辑、零边界遗漏。IconButton / flipHorizontal / flipVertical /
 * app 在 dev bundle 单模块里均为顶层绑定，可直接引用。
 */
function patchFlipActions(): Plugin {
  return {
    name: "painter-patch-flip-actions",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist/")) return null;
      if (code.includes("__painterFlipActions")) return null;

      // dev（未压缩）：左侧面板操作行 = duplicate 紧跟 delete（该组合唯一，
      // 悬浮工具条 / compact 行的形态不同，不会误伤）。
      // 注入位置在 renderAction("duplicateSelection") 之前，使翻转按钮排在最前。
      const devAnchor =
        'renderAction("duplicateSelection"),\n        renderAction("deleteSelectedElements"),';
      if (code.includes(devAnchor)) {
        const injected =
          '/* __painterFlipActions */\n' +
          'jsx77(IconButton, { type: "button", icon: flipHorizontal, title: t("labels.flipHorizontal") + " — Shift+H", "aria-label": t("labels.flipHorizontal"), onClick: () => app.actionManager.executeAction(app.actionManager.actions.flipHorizontal, "api"), disabled: Object.keys(appState.selectedElementIds).length === 0 }),\n' +
          'jsx77(IconButton, { type: "button", icon: flipVertical, title: t("labels.flipVertical") + " — Shift+V", "aria-label": t("labels.flipVertical"), onClick: () => app.actionManager.executeAction(app.actionManager.actions.flipVertical, "api"), disabled: Object.keys(appState.selectedElementIds).length === 0 }),\n' +
          '        ';
        return code.replace(devAnchor, injected + devAnchor);
      }

      // prod（压缩）：renderAction 形参被压缩，flip 图标 / IconButton 名也压缩，
      // 无法在浏览器里稳定验证；保持安全 no-op（不注入、不破坏现有功能）。
      // 注：本项目的文字格式化等补丁在 prod 同样随 npm install 压缩名变化而失效，
      // dev 才是主要运行形态。prod 如需翻转按钮，可后续按当时压缩签名补一份锚点。
      return null;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    patchExcalidrawRender(),
    patchPaperTexture(),
    patchNativeColorPicker(),
    patchTextFormatting(),
    patchFlipActions(),
  ],
  // Electron 用 file:// 协议加载本地资源,必须用相对路径
  base: './',
  // Excalidraw 的补丁通过 transform 插件注入,依赖必须走源码转换而不是
  // 预打包缓存,否则渲染钩子会丢失;少量 CommonJS 依赖则必须预打包,
  // 否则源码直载时没有 default 导出会白屏
  optimizeDeps: {
    exclude: [
      '@excalidraw/excalidraw',
      '@excalidraw/element',
      '@excalidraw/common',
      '@excalidraw/math',
      '@excalidraw/fractional-indexing',
      '@excalidraw/laser-pointer',
      '@excalidraw/random-username',
    ],
    include: [
      'png-chunks-extract',
      'png-chunks-encode',
      'png-chunk-text',
      'lodash.throttle',
      'lodash.debounce',
      // zustand v4(Excalidraw 依赖)是 CJS,被排除预构建的 @excalidraw/* 链路
      // 引用时会以原生 ESM 直载导致命名导出解析失败、页面白屏
      'use-sync-external-store',
      'use-sync-external-store/shim',
      'use-sync-external-store/shim/with-selector',
      // zustand 也必须预打包:它被排除优化的 @excalidraw/* 裸引时自身也会
      // 走源码直载,其内部对 use-sync-external-store 的子路径引用无法被重写
      'zustand',
      'zustand/traditional',
      // 其余被 @excalidraw/* 链路引用的 CJS 包
      '@excalidraw/markdown-to-text',
      'pica',
      'fuzzy',
      'canvas-roundrect-polyfill',
      // mermaid 被 mermaid-to-excalidraw 源码直载,它自身是 ESM 但依赖
      // dayjs 等 CJS 包;整体预打包让它连带 CJS 依赖一起进产物
      'mermaid',
      'dayjs',
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 打包成单文件 chunk,便于 Electron 加载
    chunkSizeWarningLimit: 4000,
  },
})
