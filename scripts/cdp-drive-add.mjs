#!/usr/bin/env node
/** 临时 UI 驱动（调查用）：真实点击走完「添加入口（个人/网页）」全流程并验证分组头。 */
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
  const raw = await ev(
    `JSON.stringify((() => { const el = [...document.querySelectorAll('button')].find(function (b) { return ${match}; }); ` +
      `if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })())`,
  );
  const c = raw ? JSON.parse(raw) : null;
  if (!c) throw new Error('button not found: ' + match + ' | raw=' + raw);
  await clickAt(c[0], c[1]);
  await sleep(350);
  return c;
};
const clickInput = async (ariaLabel) => {
  const raw = await ev(
    `JSON.stringify((() => { var el = document.querySelector('input[aria-label="${ariaLabel}"]'); ` +
      `if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })())`,
  );
  const c = raw ? JSON.parse(raw) : null;
  if (!c) throw new Error('input not found: ' + ariaLabel + ' | raw=' + raw);
  await clickAt(c[0], c[1]);
  await sleep(200);
};

// 0. 过隐私门（有确认按钮时）+ 切到「我的入口」
await ev(`(() => {
  const ack = [...document.querySelectorAll('button')].find(b => b.textContent.includes('允许') || b.textContent.includes('确认'));
  if (ack) ack.click();
  return true;
})()`);
await sleep(300);
await clickButton("b.textContent.trim() === '我的入口'");
// 1. 工具栏「添加入口」
const probe = await ev(`JSON.stringify({ url: location.hash, btn: [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '添加入口').length, dpr: window.devicePixelRatio })`);
console.log('probe:', probe);
await clickButton("b.textContent.trim() === '添加入口'");
// 2. 类型 = 网页
await clickButton("b.getAttribute('role') === 'radio' && b.textContent.trim() === '网页'");
// 3. 名称 + 网址
await clickInput('入口名称');
await send('Input.insertText', { text: '团队文档' });
await clickInput('网页地址');
await send('Input.insertText', { text: 'https://docs.example.com' });
// 4. 确认添加
await clickButton("b.textContent.trim() === '添加'");
await sleep(500);

// 5. 验证：对话框关闭、卡片存在、分组头出现「在此组添加」+「⋯ 分组操作」
const result = await ev(
  `(() => {
    const dialogs = document.querySelectorAll('[role=dialog]').length;
    const addInGroup = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === '在此组添加').length;
    const groupActions = [...document.querySelectorAll('button')].filter(x => (x.getAttribute('aria-label') ?? '').includes('分组操作')).length;
    const cardThere = [...document.querySelectorAll('button')].some(b => b.textContent.includes('团队文档') && b.textContent.includes('docs.example.com'));
    return JSON.stringify({ dialogs, addInGroup, groupActions, cardThere });
  })()`,
);
console.log(result);
ws.close();
process.exit(0);
