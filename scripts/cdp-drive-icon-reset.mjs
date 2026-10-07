#!/usr/bin/env node
/** 临时验证（本轮修复用）：个人入口 选表情→保存→重编辑→恢复自动图标→保存，断言卡片图标从表情变回程序图标。 */
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
const clickRightAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1, buttons: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1, buttons: 0 });
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

const cardState = async () =>
  JSON.parse(
    await ev(
      `(() => { const card = [...document.querySelectorAll('button')].find(b => b.textContent.includes('记事本') && b.textContent.includes('notepad')); ` +
        `if (!card) return JSON.stringify({ there: false }); ` +
        `var emojiSpan = !!card.querySelector('span[style*="font-size"]'); ` +
        `var img = card.querySelector('img'); ` +
        `return JSON.stringify({ there: true, emojiSpan, hasImg: !!img, imgIsPng: !!(img && (img.src||'').startsWith('data:image/')) }); })()`,
    ),
  );

// 0. 过隐私门 + 切到「我的入口」（页签用注入 click：Input 点击 tab 偶发不生效）
await ev(`(() => { const ack = [...document.querySelectorAll('button')].find(b => b.textContent.includes('允许') || b.textContent.includes('确认')); if (ack) ack.click(); return true; })()`);
await sleep(300);
await ev(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.trim() === '我的入口'); if (t) t.click(); return !!t; })()`);
await sleep(400);

// 1. 工具栏「添加入口」→ EntryEditDialog（personal create）
await clickButton("b.textContent.trim() === '添加入口'");
await clickInput('入口名称');
await send('Input.insertText', { text: '记事本' });
await clickInput('程序路径');
await send('Input.insertText', { text: 'C:\\Windows\\System32\\notepad.exe' });
// 2. 挑个表情（选面板里第一个）
await clickButton("b.textContent.includes('挑个表情')");
const picked = await ev(
  `(() => { const el = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('选择表情')); ` +
    `if (!el) return 'null'; var r = el.getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), el.textContent]); })()`,
);
const pc = JSON.parse(picked);
await clickAt(pc[0], pc[1]);
await sleep(300);
console.log('picked emoji:', pc[2]);
await clickButton("b.textContent.trim() === '添加'");
await sleep(1200);

// 3. 断言：卡片存在且渲染表情
const afterAdd = await cardState();
console.log('after add (expect emojiSpan=true, hasImg=false):', afterAdd);
if (!afterAdd.there || !afterAdd.emojiSpan) throw new Error('STEP3 FAIL: emoji not rendered after add');

// 4. 右键卡片 → 重编辑 → 恢复自动图标 → 保存
const cardPos = JSON.parse(
  await ev(
    `(() => { const card = [...document.querySelectorAll('button')].find(b => b.textContent.includes('记事本') && b.textContent.includes('notepad')); ` +
      `var r = card.getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]); })()`,
  ),
);
await clickRightAt(cardPos[0], cardPos[1]);
await sleep(400);
await clickButton("b.textContent.trim() === '重编辑'");
await sleep(500);
const dialogProbe = await ev(
  `JSON.stringify({ dialog: document.querySelectorAll('[role=dialog]').length, hasRestore: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '恢复自动图标') })`,
);
console.log('edit dialog (expect hasRestore=true):', dialogProbe);
if (!JSON.parse(dialogProbe).hasRestore) throw new Error('STEP4 FAIL: restore button missing in edit dialog');
await clickButton("b.textContent.trim() === '恢复自动图标'");
const afterRestore = await ev(
  `JSON.stringify({ hasRestore: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '恢复自动图标') })`,
);
console.log('after click restore (expect hasRestore=false):', afterRestore);
await clickButton("b.textContent.trim() === '保存'");
await sleep(1500);

// 5. 断言：卡片从表情变成提取到的程序图标
const afterSave = await cardState();
console.log('after save (expect emojiSpan=false, imgIsPng=true):', afterSave);
const ok = afterSave.there && !afterSave.emojiSpan && afterSave.imgIsPng;
console.log(ok ? 'PASS: 恢复自动图标后卡片显示程序图标' : 'FAIL');
ws.close();
process.exit(ok ? 0 : 1);
