#!/usr/bin/env node
/** 临时取证（调查用）：复刻用户拖拽 #2 → #1 的完整操作，输出插桩轨迹。 */
const list = await (await fetch('http://127.0.0.1:19222/json/list')).json();
const page = list.filter((p) => p.type === 'page' && !p.url.includes('#/palette'))[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const ev = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
};
const clickButton = async (match) => {
  const c = JSON.parse(await ev(
    `JSON.stringify((() => { const el = [...document.querySelectorAll('button')].find(function (b) { return ${match}; }); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })())`,
  ));
  if (!c) throw new Error('btn not found: ' + match);
  await clickAt(c[0], c[1]);
  await sleep(350);
  return c;
};
const typeInto = async (ariaLabel, text) => {
  const c = JSON.parse(await ev(
    `JSON.stringify((() => { const el = document.querySelector('input[aria-label="${ariaLabel}"]'); if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })())`,
  ));
  if (!c) throw new Error('input not found: ' + ariaLabel);
  await clickAt(c[0], c[1]);
  await send('Input.insertText', { text });
  await sleep(200);
};

// 0. 隐私门（如有）+ 切到「我的入口」
await ev(`(() => { const ack = [...document.querySelectorAll('button')].find(b => b.textContent.includes('允许') || b.textContent.includes('确认')); if (ack) ack.click(); return true; })()`);
await sleep(300);
await clickButton("b.textContent.trim() === '我的入口'");

// 1. UI 添加第二张卡（网页）
await clickButton("b.textContent.trim() === '添加入口'");
await clickButton("b.getAttribute('role') === 'radio' && b.textContent.trim() === '网页'");
await typeInto('入口名称', '第二个应用');
await typeInto('网页地址', 'https://two.example.com');
await clickButton("b.textContent.trim() === '添加'");
await sleep(400);

// 2. 复刻用户拖拽：#2 拖到 #1 左半区（真实坐标 + 真实节奏）
const trace = await ev(`(async () => {
  window.__tlDrag = [];
  const cardOf = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.includes(t));
  const src = cardOf('第二个应用');
  const dst = cardOf('团队文档');
  if (!src || !dst) return JSON.stringify({ error: 'cards not found' });
  const dt = new DataTransfer();
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 150));
  const r = dst.getBoundingClientRect();
  const at = (fx) => ({ bubbles: true, cancelable: true, dataTransfer: dt, clientX: Math.round(r.left + r.width * fx), clientY: Math.round(r.top + r.height / 2) });
  // 悬停目标卡左半区（用户想插到它前面）
  dst.dispatchEvent(new DragEvent('dragover', at(0.25)));
  await new Promise(r2 => setTimeout(r2, 150));
  dst.dispatchEvent(new DragEvent('drop', at(0.25)));
  src.dispatchEvent(new DragEvent('dragend', at(0.25)));
  await new Promise(r2 => setTimeout(r2, 400));
  const g = await window.tl.personal.get();
  return JSON.stringify({ trace: window.__tlDrag, order: g.groups[0].entries.map(e => e.name) });
})()`);
console.log(trace);
ws.close();
process.exit(0);
