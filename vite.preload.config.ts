import { defineConfig } from 'vite';

/**
 * preload 单独构建：必须是 CommonJS，且不能把 electron 打进去（由宿主提供）。
 * 输出到 dist/preload/index.cjs，与主进程 windowManager.ts 里的 preload 路径一致。
 */
export default defineConfig({
  build: {
    outDir: 'dist/preload',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
