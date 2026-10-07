import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

/**
 * 主进程单独构建：CommonJS，electron 与 node 内建模块全部 external。
 * 输出到 dist/main/index.cjs，作为 package.json 的 main 入口。
 */
export default defineConfig({
  build: {
    outDir: 'dist/main',
    emptyOutDir: true,
    sourcemap: true,
    target: 'node24',
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
