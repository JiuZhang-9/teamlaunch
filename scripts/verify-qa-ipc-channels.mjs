#!/usr/bin/env node
/**
 * QA 独立验证 ①：IPC 通道契约枚举比对（静态，不起 Electron）
 *
 * 为什么要这道门：`contextIsolation: true` 下渲染层只能通过 preload 的白名单
 * 说话，于是"preload 声明了、主进程没注册"这类断线**不会被任何类型检查、
 * lint、构建发现**——类型检查看的是 `TeamLaunchApi` 这个接口，而接口从来
 * 不说对面有没有人接。历史上这里出过一次（preload 有、主进程零注册），
 * 表现是"点了没反应"，全绿。能抓到它的只有**两侧枚举比对**。
 *
 * 四个集合，两两比对：
 *   INVOKE  <- preload 侧 ipcRenderer.invoke('tl:x')  （请求/响应，必须有 handle）
 *   HANDLE  <- 主进程侧 ipcMain.handle('tl:x')
 *   LISTEN  <- preload 侧 ipcRenderer.on('tl:x')      （推送，必须有 send）
 *   SEND    <- 主进程侧 webContents.send('tl:x')
 *
 * 判定：
 *   INVOKE \ HANDLE  → P0（契约存在但未接通，功能彻底失效）
 *   LISTEN \ SEND    → P0（UI 订阅了一个永远不会来的消息）
 *   SEND \ LISTEN    → P1（主进程在往一个没人听的通道推，功能同样失效）
 *   HANDLE \ INVOKE  → P2（死注册，无用代码，误导后来者）
 *
 * 用法：npm run verify:qa-channels
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const FILES = [
  'src/preload/index.ts',
  'src/main/ipc.ts',
  'src/main/index.ts',
  'src/main/hotkey.ts',
  'src/main/syncBridge.ts',
  'src/main/windowManager.ts',
  'src/main/tray.ts',
  'src/main/opener.ts',
  'src/main/backendService.ts',
  'src/main/serverPort.ts',
  'src/main/localStore.ts',
  'src/main/deviceIdentity.ts',
  'src/main/feedbackOutbox.ts',
  'src/main/syncClient.ts',
  'src/main/syncTransport.ts',
  'src/main/personalPort.ts',
];

const CHANNEL = /'(tl:[a-z0-9-]+)'/g;

/** 逐文件抽出"某类调用点"用到的通道，带上文件:行号作为证据。 */
function collect(file, text, patterns) {
  const found = new Map();
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      const channel = m[1];
      if (!found.has(channel)) found.set(channel, []);
      found.get(channel).push(`${file}:${line}`);
    }
  }
  return found;
}

const INVOKE_RE = [/\binvoke(?:<[^>]*>)?\(\s*'(tl:[a-z0-9-]+)'/g];
const LISTEN_RE = [/ipcRenderer\.on\(\s*'(tl:[a-z0-9-]+)'/g, /ipcRenderer\.once\(\s*'(tl:[a-z0-9-]+)'/g, /\bsubscribe(?:<[^>]*>)?\(\s*'(tl:[a-z0-9-]+)'/g];
const HANDLE_RE = [/ipcMain\.handle\(\s*'(tl:[a-z0-9-]+)'/g, /ipcMain\.handleOnce\(\s*'(tl:[a-z0-9-]+)'/g];
const SEND_RE = [/webContents\.send\(\s*'(tl:[a-z0-9-]+)'/g];

const invoke = new Map();
const listen = new Map();
const handle = new Map();
const send = new Map();

for (const rel of FILES) {
  let text;
  try {
    text = await readFile(join(ROOT, rel), 'utf8');
  } catch {
    continue; // 文件不存在就跳过，不算失败
  }
  for (const [ch, at] of collect(rel, text, INVOKE_RE)) merge(invoke, ch, at);
  for (const [ch, at] of collect(rel, text, LISTEN_RE)) merge(listen, ch, at);
  for (const [ch, at] of collect(rel, text, HANDLE_RE)) merge(handle, ch, at);
  for (const [ch, at] of collect(rel, text, SEND_RE)) merge(send, ch, at);
}

function merge(target, channel, at) {
  if (!target.has(channel)) target.set(channel, []);
  target.get(channel).push(...at);
}

let failed = 0;
const line = (s) => console.log(s);

line('QA 独立验证 ①：IPC 通道契约枚举比对');
line('');
line(`  INVOKE（preload 发起）${invoke.size} 个 · HANDLE（主进程注册）${handle.size} 个`);
line(`  LISTEN（preload 订阅）${listen.size} 个 · SEND（主进程推送）${send.size} 个`);
line('');

/* ---- 1. 每个 invoke 必须有对应 handle（断线 = P0） ---- */
line('— 请求/响应通道：invoke → handle —');
const missingHandle = [];
for (const ch of [...invoke.keys()].sort()) {
  const ok = handle.has(ch);
  if (!ok) missingHandle.push(ch);
  line(`  ${ok ? 'PASS' : 'FAIL'}  ${ch}${ok ? '' : ` — preload 在 ${invoke.get(ch).join(', ')} 发起，主进程零注册`}`);
}
if (missingHandle.length > 0) failed += missingHandle.length;

line('');
line('— 推送通道：ipcRenderer.on → webContents.send —');
const missingSend = [];
for (const ch of [...listen.keys()].sort()) {
  const ok = send.has(ch);
  if (!ok) missingSend.push(ch);
  line(`  ${ok ? 'PASS' : 'FAIL'}  ${ch}${ok ? '' : ` — preload 在 ${listen.get(ch).join(', ')} 订阅，主进程无人推送`}`);
}
if (missingSend.length > 0) failed += missingSend.length;

line('');
line('— 反向：主进程推送必须有 preload 订阅（否则界面永远收不到）—');
const orphanSend = [];
for (const ch of [...send.keys()].sort()) {
  if (listen.has(ch)) continue;
  orphanSend.push(ch);
  line(`  FAIL  ${ch} — 主进程在 ${send.get(ch).join(', ')} 推送，preload 无任何订阅者（contextIsolation 下渲染层收不到）`);
}
failed += orphanSend.length;

line('');
line('— 反向：主进程注册必须有 preload 调用（死注册只报 P2，不阻断）—');
const deadHandle = [];
for (const ch of [...handle.keys()].sort()) {
  if (invoke.has(ch)) continue;
  deadHandle.push(ch);
  line(`  WARN  ${ch} — 主进程在 ${handle.get(ch).join(', ')} 注册，preload 无调用者（死代码）`);
}

line('');
line('结论：');
line(`  P0 断线通道（invoke 无 handle）：${missingHandle.length === 0 ? '无' : missingHandle.join(', ')}`);
line(`  P0 空订阅通道（on 无 send）：${missingSend.length === 0 ? '无' : missingSend.join(', ')}`);
line(`  P1 无听众推送（send 无 on）：${orphanSend.length === 0 ? '无' : orphanSend.join(', ')}`);
line(`  P2 死注册（handle 无 invoke）：${deadHandle.length === 0 ? '无' : deadHandle.join(', ')}`);
line('');

if (failed > 0) {
  console.error(`QA 通道门禁：${failed} 项失败。`);
  process.exit(1);
}
console.log('QA 通道门禁：全部通过（P2 死注册不阻断，见上）。');
