// 传递闭包扫描:从被排除预构建的 @excalidraw/* 出发,沿裸引用链
// 找出所有会被"源码直载"的 CJS 包(它们必须加入 optimizeDeps.include,
// 否则浏览器以原生 ESM 加载 CJS 文件会报"没有 default/命名导出"而白屏)
const fs = require('fs');
const path = require('path');
const root = 'F:/03ccc-学习/VibeCoding/Trae Code/Painter/node_modules';

const excluded = ['@excalidraw/excalidraw','@excalidraw/element','@excalidraw/common','@excalidraw/math','@excalidraw/fractional-indexing','@excalidraw/laser-pointer','@excalidraw/random-username'];
const alreadyIncluded = new Set([
  'png-chunks-extract','png-chunk-text','png-chunks-encode','lodash.throttle','lodash.debounce',
  'use-sync-external-store','use-sync-external-store/shim','use-sync-external-store/shim/with-selector',
  'zustand','zustand/traditional','@excalidraw/markdown-to-text','pica','fuzzy','canvas-roundrect-polyfill',
]);
// react 系 Vite 总会自动预构建,不用管
const skip = new Set(['react','react-dom','react/jsx-runtime','react/jsx-dev-runtime','react-dom/client','scheduler']);

function pkgMainFields(pj) {
  return { main: pj.main, module: pj.module, type: pj.type, exports: pj.exports };
}
function isEsmPkg(pj) {
  return pj.type === 'module' || !!pj.module ||
    (pj.exports && JSON.stringify(pj.exports).includes('"import"'));
}
function readPkg(pkgName) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, pkgName, 'package.json'), 'utf8'));
  } catch { return null; }
}
// 找包的入口目录(dist 或 main 指向的目录)里所有 js/mjs 文件
function entryFiles(pkgName) {
  const pj = readPkg(pkgName);
  if (!pj) return [];
  const candidates = [];
  const mainDir = pj.main ? path.dirname(path.join(pkgName, pj.main)) : null;
  for (const d of [path.join(pkgName, 'dist'), mainDir && mainDir.replace(/\\/g, '/')]) {
    if (d && !candidates.includes(d)) candidates.push(d);
  }
  const files = [];
  for (const d of candidates) {
    const abs = path.join(root, d);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isFile() && /\.m?js$/.test(e.name)) files.push(path.join(abs, e.name));
    }
  }
  return files;
}
function importsOf(files) {
  const specs = new Set();
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/from\s*["']([^"'.][^"']*)["']/g)) specs.add(m[1]);
    for (const m of code.matchAll(/import\s*\(\s*["']([^"'.][^"']*)["']\s*\)/g)) specs.add(m[1]);
    for (const m of code.matchAll(/require\s*\(\s*["']([^"'.][^"']*)["']\s*\)/g)) specs.add(m[1]);
  }
  return [...specs].filter(s => !s.includes('*'));
}

const visited = new Set();   // 已遍历的包
const cjsNeeds = new Set();  // 需要加入 include 的 CJS 包
const queue = [...excluded];
while (queue.length) {
  const pkg = queue.shift();
  if (visited.has(pkg)) continue;
  visited.add(pkg);
  const files = entryFiles(pkg);
  if (!files.length) continue;
  for (const spec of importsOf(files)) {
    const parts = spec.split('/');
    const dep = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (skip.has(dep) || visited.has(dep)) continue;
    const pj = readPkg(dep);
    if (!pj) continue;
    if (!isEsmPkg(pj)) {
      // CJS 包:若还没在 include 里,记下(整包名即可,子路径入口单独判断)
      if (!alreadyIncluded.has(dep)) cjsNeeds.add(dep);
      // CJS 包的依赖也会被 esbuild 打进同一 chunk,不必继续遍历
    } else {
      // ESM 包会被源码直载,继续遍历它的依赖
      queue.push(dep);
    }
  }
}

console.log('=== 还需要加入 optimizeDeps.include 的 CJS 包 ===');
[...cjsNeeds].sort().forEach(s => console.log("      '" + s + "',"));
console.log('=== 已遍历包数:', visited.size, '===');
