#!/usr/bin/env node
/** 发布后链路验证:发布→退出编辑→已发布配置的 Obsidian/ima 卡片图标。 */
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
const inject = async (ex, wait = 600) => { const r = await ev(ex); await sleep(wait); return r; };

// 发布(编辑条按钮 → 对话框确认)
const pubBtn = await inject(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith('发布')); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
console.log('open publish dialog:', pubBtn);
console.log('dialog:', await ev(`JSON.stringify({open:!!document.querySelector('[role=dialog]'), text:document.querySelector('[role=dialog]')?.textContent?.replace(/\\s+/g,' ').slice(0,150)})`));
await inject(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.closest('[role=dialog]') && x.textContent.trim().startsWith('发布')); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
await sleep(2000);
console.log('after publish:', await ev(`JSON.stringify({dlgOpen:!!document.querySelector('[role=dialog]'), dlgText:document.querySelector('[role=dialog]')?.textContent?.replace(/\\s+/g,' ').slice(0,100) ?? null})`));

// 退出编辑(放弃改动按钮 → 确认)
await inject(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('放弃改动')); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
const hasConfirm = await ev(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('放弃') && b.closest('[role=dialog]'))`);
if (hasConfirm === true) await inject(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('放弃') && x.closest('[role=dialog]')); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
await sleep(900);

// 已发布配置的两张卡片
const cards = await ev(`(() => {
  const out = {};
  for (const name of ['Obsidian', 'ima']) {
    const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes(name));
    if (!c) { out[name] = 'missing'; continue; }
    const img = c.querySelector('img');
    out[name] = { emojiSpan: !!c.querySelector('span[style*=font-size]'), imgPng: !!(img && (img.src || '').startsWith('data:image/')), imgLen: img ? (img.src || '').length : 0 };
  }
  return JSON.stringify(out);
})()`);
console.log('published cards:', cards);

// 个人页回归:Obsidian 建个人入口(不选表情)→ 图标应立即出现
await inject(`(() => { const t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='我的入口'); if(!t) return 'NO'; t.click(); return 'OK'; })()`);
await sleep(600);
await inject(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='添加入口'); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
await inject(`(() => { const el=document.querySelector('input[aria-label="入口名称"]'); if(!el) return 'NO'; el.focus(); return 'OK'; })()`, 100);
await send('Input.insertText', { text: 'Obsidian' });
await inject(`(() => { const el=document.querySelector('input[aria-label="程序路径"]'); if(!el) return 'NO'; el.focus(); return 'OK'; })()`, 100);
await send('Input.insertText', { text: 'D:\\Program Files\\Obsidian\\Obsidian.exe' });
await inject(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='添加'); if(!b) return 'NO'; b.click(); return 'OK'; })()`);
await sleep(1200);
const personalCard = await ev(`(() => {
  const c = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Obsidian'));
  if (!c) return JSON.stringify({ there: false });
  const img = c.querySelector('img');
  return JSON.stringify({ there: true, imgPng: !!(img && (img.src || '').startsWith('data:image/')), imgLen: img ? (img.src || '').length : 0 });
})()`);
console.log('personal Obsidian card:', personalCard);
ws.close();
process.exit(0);
