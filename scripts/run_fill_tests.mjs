// 通过 Vite 的 SSR 管线加载并运行 fillStrokes 单测：
// 与产品同一套模块解析（CJS 依赖如 polygon-clipping 由 Vite 转换），
// 避免 Node 原生 ESM 无法 named-import CJS 包的问题。
// 运行：node scripts/run_fill_tests.mjs

import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  logLevel: "error",
  ssr: {
    // 让 Vite 转换这些依赖而不是 external 化
    noExternal: ["polygon-clipping", "splaytree", "robust-predicates"],
  },
});

try {
  await server.ssrLoadModule("/scripts/test_fill_strokes.ts");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await server.close();
}
