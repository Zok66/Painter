import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Electron 用 file:// 协议加载本地资源,必须用相对路径
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // 打包成单文件 chunk,便于 Electron 加载
    chunkSizeWarningLimit: 4000,
  },
})
