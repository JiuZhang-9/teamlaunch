import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'docs/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/^#[0-9a-fA-F]{3,8}$/]:not([value="#fff"]):not([value="#ffffff"]):not([value="#000"]):not([value="#000000"])',
          message: '禁止硬编码色值（#fff/#000 除外）—— 一律走设计 Token。',
        },
      ],
    },
  },
  {
    // 渲染层：禁止直接依赖 electron 与 node:*，一切能力走 window.tl 抽象层。
    // 只罩 src/renderer —— 项目根的 vite.*.config.ts 是构建配置，用 node:* 天经地义。
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'node:*'],
              message: '渲染层禁止直接依赖 Electron / Node —— 一律走 window.tl 抽象层。',
            },
          ],
        },
      ],
    },
  },
  {
    // 服务侧（可独立迁移目录）：禁止依赖 electron，保持"迁独立服务器"可行性（架构 §3.2）。
    files: [
      'src/server/**',
      'src/discovery/**',
      'src/services/**',
      'src/repositories/**',
      'src/platform/**',
      'src/shared/**',
      'src/utils/**',
      'scripts/**',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron'],
              message: '该目录禁止依赖 electron —— 迁移可行性守卫（架构 §3.2）。',
            },
          ],
        },
      ],
    },
  },
  {
    // 主进程与 preload：electron 是它们的正常依赖（这正是它们存在的意义）。
    // 上一块的禁令不能罩到这里，否则窗口/IPC/preload 一行都写不了。
    files: ['src/main/**', 'src/preload/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
