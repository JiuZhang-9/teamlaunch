import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

/**
 * Vite 配置 —— 渲染层专用。
 * 输出 dist/renderer，主进程稍后从该目录加载 index.html。
 * 渲染层不得 import electron，因此这里不需要任何 external 处理。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  root: '.',
  base: './',
  server: {
    port: 5180,
    // true = 端口被占时**报错退出**，而不是静默漂到 5181。
    // 漂移造成过"汇报 5180、实际跑在 5181"的事故：两边都是活的、都会返回 200，
    // 但只有后者服务的是当前代码，排查时极难发现。宁可起不来，也不要悄悄换端口。
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': new URL('./src/renderer', import.meta.url).pathname,
      '@shared': new URL('./src/shared', import.meta.url).pathname,
    },
  },
});
