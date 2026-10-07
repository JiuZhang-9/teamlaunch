#!/usr/bin/env node
/** 本轮修复验证:团队草稿态图标直传 entry——①恢复自动图标立即生效 ②草稿新建 local 入口有图标。 */
const list = await (await fetch('http://127.0.0.1:19222/json/list')).json();
const page = list.filter((p) => p.type === 'page' && !p.url.includes('#/palette'))[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));

const ev = async (ex) => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inject = async (ex, wait = 550) => { const r = await ev(ex); await sleep(wait); return r; };

/** 所有交互走注入 .click():本实例 Input 真点击对 React 合成事件不生效。 */
const clickBtn = async (jsFind) => {
  const r = await ev(`(() => { const el = [...document.querySelectorAll('button')].find(b => (${jsFind})); if (!el) return 'NO'; el.click(); return 'OK'; })()`);
  if (r !== 'OK') throw new Error('clickBtn failed: ' + jsFind + ' -> ' + r);
  await sleep(500);
};
const fillInput = async (label, text) => {
  const r = await ev(`(() => { const el = document.querySelector('input[aria-label="${label}"]'); if (!el) return 'NO'; el.focus(); return 'OK'; })()`);
  if (r !== 'OK') throw new Error('fillInput failed: ' + label);
  await send('Input.insertText', { text });
  await sleep(200);
};
const pickFirstEmoji = async () => {
  await clickBtn(`b.textContent.includes('挑个表情')`);
  const r = await ev(`(() => { const el = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') ?? '').startsWith('选择表情')); if (!el) return 'NO'; el.click(); return 'OK'; })()`);
  if (r !== 'OK') throw new Error('no emoji');
  await sleep(300);
};
const cardIcon = (name) =>
  ev(
    `(() => { const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${name}'));
      if (!c) return JSON.stringify({ there: false });
      const img = c.querySelector('img');
      return JSON.stringify({ there: true, emojiSpan: !!c.querySelector('span[style*=font-size]'), hasImg: !!img, imgPng: !!(img && (img.src || '').startsWith('data:image/')), imgLen: img ? (img.src || '').length : 0 });
    })()`,
  ).then((s) => JSON.parse(s));

// 0. 隐私门 + 团队页
await ev(`(() => { const a = [...document.querySelectorAll('button')].find(b => b.textContent.includes('允许') || b.textContent.includes('确认')); if (a) a.click(); return true; })()`);
await sleep(400);
await ev(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find(x => x.textContent.trim() === '团队入口'); if (t) t.click(); return true; })()`);
await sleep(600);

// 1. 进编辑模式(若已处于编辑态则跳过)
const alreadyEditing = await ev(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('放弃改动') || b.textContent.trim().startsWith('发布'))`);
if (alreadyEditing !== true) {
  await clickBtn(`b.textContent.trim() === '编辑模式'`);
}
const editingNow = await ev(`JSON.stringify({ editing: [...document.querySelectorAll('button')].some(b => b.textContent.includes('放弃改动') || b.textContent.trim().startsWith('发布')) })`);
console.log('edit mode:', editingNow);

// 2. 新建 Obsidian(app + 表情)
await clickBtn(`b.textContent.trim() === '新建入口'`);
await fillInput('入口名称', 'Obsidian');
await fillInput('程序路径', 'D:\\Program Files\\Obsidian\\Obsidian.exe');
await pickFirstEmoji();
await clickBtn(`b.textContent.trim() === '添加到草稿'`);
await sleep(800);
console.log('Obsidian after add (expect emojiSpan=true):', JSON.stringify(await cardIcon('Obsidian')));

// 3. 右键(注入 contextmenu)→ 重编辑 → 恢复自动图标 → 保存
await inject(`(() => {
  const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Obsidian'));
  if (!c) return 'NO';
  const r = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  return 'OK';
})()`, 600);
await clickBtn(`b.textContent.trim() === '重编辑'`);
await sleep(500);
await clickBtn(`b.textContent.trim() === '恢复自动图标'`);
await clickBtn(`b.closest('[role=dialog]') && b.textContent.trim() === '保存'`);
await sleep(1000);
const step3 = await cardIcon('Obsidian');
console.log('Obsidian after restore (expect emojiSpan=false, imgPng=true):', JSON.stringify(step3));

// 4. 新建 ima(app, local) → 草稿态就应有图标
await clickBtn(`b.textContent.trim() === '新建入口'`);
await fillInput('入口名称', 'ima');
await fillInput('程序路径', '${process.env.LOCALAPPDATA}\\ima.copilot\\Application\\ima.copilot.exe');
await clickBtn(`b.textContent.trim() === '添加到草稿'`);
await sleep(1200);
const step4 = await cardIcon('ima');
console.log('ima draft card (expect imgPng=true):', JSON.stringify(step4));

const ok = step3.there && step3.imgPng && !step3.emojiSpan && step4.there && step4.imgPng;
console.log(ok ? '=== EDIT-MODE PASS ===' : '=== EDIT-MODE FAIL ===');
ws.close();
process.exit(ok ? 0 : 1);
