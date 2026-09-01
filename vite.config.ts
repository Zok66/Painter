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
 * 且导出走的是同一条渲染路径，所以导出的 PNG / SVG 自带纹理。
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
 * 原生 ColorInput 取色器增强。
 *
 * 原生 Excalidraw ColorInput 的十六进制输入框右侧只有一个铅笔 EyeDropper 按钮。
 * 这里在 EyeDropper 按钮之前注入一个系统取色触发按钮（window.__painterNativeSysColor，
 * 定义在 src/nativeColorPatch.tsx），点击唤起系统颜色选择器，与铅笔取色笔并列。
 *
 * dev（格式化源码）与 prod（压缩）分别用不同的锚点定位 EyeDropper 按钮的 jsx 调用，
 * 在其前面插入一个兄弟 jsx 元素。匹配不上时原样返回，最坏情况只是没有该系统取色按钮。
 */
function patchNativeColorPicker(): Plugin {
  return {
    name: "painter-patch-native-color-picker",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist/")) return;
      if (code.includes("__painterNativeSysColor")) return;

      // dev：格式化源码，EyeDropper 按钮 ref 为 eyeDropperTriggerRef
      const devAt = code.indexOf("ref: eyeDropperTriggerRef,");
      if (devAt >= 0) {
        const jsxAt = code.lastIndexOf("jsx13(", devAt);
        if (jsxAt >= 0) {
          const before = code.slice(0, jsxAt);
          const after = code.slice(jsxAt);
          const insert =
            "/* @__PURE__ */ window.__painterNativeSysColor && jsx13(window.__painterNativeSysColor, { color, onChange }),\n                ";
          return before + insert + after;
        }
      }

      // prod：压缩，EyeDropper ref 为短名（如 b），className 用 clsx 短名（如 Hw）
      // 定位 "ref:b,className:Hw(\"excalidraw-eye-dropper-trigger\"" 前的 ul( 调用
      const prodPat = 'ref:b,className:Hw("excalidraw-eye-dropper-trigger"';
      const prodAt = code.indexOf(prodPat);
      if (prodAt >= 0) {
        const jsxAt = code.lastIndexOf("ul(", prodAt);
        if (jsxAt >= 0) {
          const seg = code.slice(jsxAt, prodAt);
          // 确认中间只是合法属性，避免误命中其它 ref:b
          if (seg.startsWith("ul(") && seg.includes(prodPat)) {
            const before = code.slice(0, jsxAt);
            const after = code.slice(jsxAt);
            const insert =
              "window.__painterNativeSysColor&&ul(window.__painterNativeSysColor,{color:void 0,onChange:t}),";
            return before + insert + after;
          }
        }
      }

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
      'png-chunk-text',
      'png-chunks-encode',
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
