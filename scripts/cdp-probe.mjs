#!/usr/bin/env node
/**
 * 临时 CDP 驱动（仅调查用，不进入产品）：
 *   node scripts/cdp-probe.mjs eval "<js>"          # 主窗口执行表达式
 *   node scripts/cdp-probe.mjs palette eval "<js>"  # 面板窗口执行
 *   node scripts/cdp-probe.mjs click <x> <y>        # 主窗口真实鼠标点击
 *   node scripts/cdp-probe.mjs key "Tab|Shift+Tab|Ctrl+Space|Escape|Enter"  # 主窗口真实按键
 *   node scripts/cdp-probe.mjs shot [file]          # 主窗口截图
 */
import { writeFileSync } from 'node:fs';

const DEBUG_HOST = process.env.TL_CDP_HOST ?? `http://127.0.0.1:${process.env.TL_CDP_PORT ?? '19222'}`;
const [, , mode, ...rest] = process.argv;

/** 组合键 → CDP 按键参数（够用即可：修饰键掩码 Alt=1 Ctrl=2 Meta=4 Shift=8）。 */
const KEYS = {
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 0 },
  'Shift+Tab': { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 },
  'Ctrl+Space': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, modifiers: 2 },
  'Ctrl+Tab': { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 2 },
  'Ctrl+W': { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, modifiers: 2 },
  'Ctrl+F': { key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 },
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 0 },
  'Ctrl+Enter': { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 2 },
};

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
} else if (mode === 'drag') {
  // 真实鼠标拖拽：按下 → 分步移动（buttons=1）→ 松手。合成 DOM 事件测不了命中/焦点路径。
  const [x1, y1, x2, y2, stepsRaw] = rest.map(Number);
  const steps = Number.isFinite(stepsRaw) && stepsRaw > 0 ? stepsRaw : 4;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, buttons: 1 });
  for (let i = 1; i <= steps; i += 1) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1, buttons: 0 });
  console.log('dragged', x1, y1, '→', x2, y2);
} else if (mode === 'key' || (mode === 'palette' && rest[0] === 'key')) {
  const comboName = mode === 'palette' ? rest[1] : rest[0];
  const combo = KEYS[comboName ?? ''];
  if (!combo) throw new Error(`unknown key combo ${comboName}（可用：${Object.keys(KEYS).join(' / ')}）`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...combo });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...combo });
  console.log('key', comboName);
} else if (mode === 'focus') {
  // 把目标窗口拿到前台（验证"已在前台时热键收起"这类分支用）。
  await send('Page.bringToFront');
  console.log('focused');
} else if (mode === 'shot' || (mode === 'palette' && rest[0] === 'shot')) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = (mode === 'palette' ? rest[1] : rest[0]) ?? 'shot.png';
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('saved', file);
} else {
  throw new Error(`unknown mode ${mode}`);
}
ws.close();
process.exit(0);
