#!/usr/bin/env node
/**
 * 临时 CDP 驱动（仅调查用，不进入产品）：
 *   node scripts/cdp-probe.mjs eval "<js>"          # 主窗口执行表达式
 *   node scripts/cdp-probe.mjs palette eval "<js>"  # 面板窗口执行
 *   node scripts/cdp-probe.mjs click <x> <y>        # 主窗口真实鼠标点击
 *   node scripts/cdp-probe.mjs shot [file]          # 主窗口截图
 */
import { writeFileSync } from 'node:fs';

const DEBUG_HOST = 'http://127.0.0.1:19222';
const [, , mode, ...rest] = process.argv;

const pages = (await (await fetch(`${DEBUG_HOST}/json/list`)).json()).filter((p) => p.type === 'page');
const page = mode === 'palette' ? pages.find((p) => p.url.includes('#/palette')) : pages.find((p) => !p.url.includes('#/palette'));
if (!page) throw new Error('no page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)[m.error ? 'reject' : 'resolve'](m.error ? m : m.result);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) return { exception: r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails).slice(0, 500) };
  return r.result?.value;
}

if (mode === 'eval' || (mode === 'palette' && rest[0] === 'eval')) {
  const expr = mode === 'palette' ? rest[1] : rest[0];
  console.log(JSON.stringify(await evalJs(expr), null, 1));
} else if (mode === 'click') {
  const [x, y] = rest.map(Number);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
  }
  console.log('clicked', x, y);
} else if (mode === 'move') {
  // 悬停：真实鼠标移动（触发 :hover 伪类），供悬浮样式目检与 getComputedStyle 取证
  const [x, y] = rest.map(Number);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  console.log('moved', x, y);
} else if (mode === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = rest[0] ?? 'shot.png';
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('saved', file);
} else {
  throw new Error(`unknown mode ${mode}`);
}
ws.close();
process.exit(0);
