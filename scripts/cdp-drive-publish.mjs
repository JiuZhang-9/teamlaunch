#!/usr/bin/env node
/** 临时复现（本轮用）：团队编辑态 发布链全流程，抓真实报错与版本号变化。 */
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
  if (!c) throw new Error('button not found: ' + match);
  await clickAt(c[0], c[1]);
  await sleep(400);
  return c;
};
const clickInput = async (ariaLabel) => {
  const raw = await ev(
    `JSON.stringify((() => { var el = document.querySelector('input[aria-label="${ariaLabel}"]'); ` +
      `if (!el) return null; var r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })())`,
  );
  const c = raw ? JSON.parse(raw) : null;
  if (!c) throw new Error('input not found: ' + ariaLabel);
  await clickAt(c[0], c[1]);
  await sleep(200);
};
const readState = async () =>
  JSON.parse(
    await ev(
      `(() => { const dlg = document.querySelector('[role=dialog]'); ` +
        `const toasts = [...document.querySelectorAll('[class*=toast],[data-tone]')].map(t=>t.textContent.trim().slice(0,60)); ` +
        `const bar = [...document.querySelectorAll('p,span')].map(x=>x.textContent.trim()).find(t=>/^当前版本 v|^已编辑|^v\\d/.test(t)); ` +
        `const err = dlg ? [...dlg.querySelectorAll('p')].map(p=>p.textContent.trim()).filter(t=>t.length>6&&t.length<80) : []; ` +
        `return JSON.stringify({ dialog: dlg ? dlg.querySelector('h1,h2,[data-title]')?.textContent?.trim() ?? 'open' : null, bar, toasts, dialogTexts: err.slice(0,6) }); })()`,
    ),
  );

// 0. 隐私门 + 团队入口页
await ev(`(() => { const ack = [...document.querySelectorAll('button')].find(b => b.textContent.includes('允许') || b.textContent.includes('确认')); if (ack) ack.click(); return true; })()`);
await sleep(300);
await ev(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.trim() === '团队入口'); if (t) t.click(); return true; })()`);
await sleep(500);
console.log('state0:', JSON.stringify(await readState()));

// 1. 空状态「添加第一个入口」→（未解锁则先弹解锁）
await clickButton("b.textContent.trim() === '添加第一个入口'");
console.log('after addFirst:', JSON.stringify(await readState()));

// 2. 若弹出设置口令：填两遍 → 设置并启用
const hasEnroll = await ev(`JSON.stringify({ pw: !!document.querySelector('input[aria-label="设置管理员口令"]'), d: document.querySelectorAll('[role=dialog]').length })`);
console.log('enroll probe:', hasEnroll);
if (JSON.parse(hasEnroll).pw) {
  await clickInput('设置管理员口令');
  await send('Input.insertText', { text: 'tl-publish-2026' });
  await clickInput('确认管理员口令');
  await send('Input.insertText', { text: 'tl-publish-2026' });
  await clickButton("b.textContent.trim() === '设置并启用'");
  await sleep(1200);
  console.log('after enroll:', JSON.stringify(await readState()));
  // 再点一次空状态按钮进入编辑
  await clickButton("b.textContent.trim() === '添加第一个入口'");
}

// 3. EntryEditDialog：app + 记事本 + 表情
await clickInput('入口名称');
await send('Input.insertText', { text: '记事本' });
await clickInput('程序路径');
await send('Input.insertText', { text: 'C:\\Windows\\System32\\notepad.exe' });
await clickButton("b.textContent.includes('挑个表情')");
const picked = await ev(
  `(() => { const el = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('选择表情')); if (!el) return 'null'; var r = el.getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]); })()`,
);
const pc = JSON.parse(picked);
await clickAt(pc[0], pc[1]);
await sleep(300);
await clickButton("b.textContent.trim() === '添加到草稿'");
await sleep(600);
console.log('after addEntry:', JSON.stringify(await readState()));

// 4. 编辑条「发布」→ 发布对话框 → 点发布，抓真实结果
await clickButton("b.textContent.trim() === '发布'");
await sleep(500);
console.log('publish dialog:', JSON.stringify(await readState()));
await clickButton("b.textContent.trim() === '发布' || b.textContent.startsWith('发布 · ')");
await sleep(1500);
console.log('after publish #1:', JSON.stringify(await readState()));

// 5. 再发布一次，对比版本号与错误
const pubAgain = await ev(`JSON.stringify({ bar: [...document.querySelectorAll('p,span')].map(x=>x.textContent.trim()).find(t=>/^当前版本 v|^已编辑/.test(t)) })`);
console.log('before publish #2:', pubAgain);
const stillOpen = await ev(`JSON.stringify({ hasPubBtn: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '发布' || b.textContent.startsWith('发布 · ')) })`);
if (JSON.parse(stillOpen).hasPubBtn) {
  await clickButton("b.textContent.trim() === '发布' || b.textContent.startsWith('发布 · ')");
  await sleep(1500);
  console.log('after publish #2:', JSON.stringify(await readState()));
}

// 6. 抓 IPC 侧证据：主进程团队数据版本（via window.tl 快照，如可达）
const snap = await ev(`JSON.stringify(window.tl && window.tl.sync ? (window.tl.sync.snapshot ? window.tl.sync.snapshot() : 'no-snapshot-fn') : 'no-sync')`);
console.log('snapshot probe:', String(snap).slice(0, 300));
ws.close();
process.exit(0);
