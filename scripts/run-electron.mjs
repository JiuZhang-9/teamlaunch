#!/usr/bin/env node
/**
 * 启动 Electron 的包装脚本。
 *
 * 为什么不能直接 `electron .`：
 *   环境全局注入了 `ELECTRON_RUN_AS_NODE=1`，直起 electron 会被当成普通 Node 进程，
 *   不会创建窗口、也不会加载主进程。必须先从子进程环境里把这个变量删掉。
 *
 * 用法：
 *   node scripts/run-electron.mjs            # 用打包产物
 *   TL_DEV_URL=http://127.0.0.1:5180 node scripts/run-electron.mjs   # 连 Vite dev server
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// `--` 之后的参数原样透传给 Electron（如 --remote-debugging-port=9222，供 UI 自动化连 CDP）。
const sep = process.argv.indexOf('--');
const extraArgs = sep >= 0 ? process.argv.slice(sep + 1) : [];

const child = spawn(electronPath, ['.', ...extraArgs], { env, stdio: 'inherit', shell: false });
child.on('exit', (code) => process.exit(code ?? 0));
