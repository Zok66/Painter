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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), patchExcalidrawRender()],
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
      // 其余被 @excalidraw/* 链路引用的 CJS 包(scripts/scan-cjs-deps.cjs 扫描)
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
