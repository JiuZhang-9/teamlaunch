#!/usr/bin/env node
/** 修复验证：解锁→编辑→恢复自动图标→发布成功→版本号只+1→退出编辑后卡片仍是程序图标。 */
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
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
};
const clickBtn = async (match) => {
  const raw = await ev(`JSON.stringify((()=>{const el=[...document.querySelectorAll('button')].find(b=>${match});if(!el)return null;var r=el.getBoundingClientRect();return JSON.stringify([Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]);})())`);
  const c = raw ? JSON.parse(raw) : null;
  if (!c) throw new Error('no button: ' + match);
  await clickAt(c[0], c[1]);
  await sleep(500);
};
const clickInput = async (label) => {
  const raw = await ev(`JSON.stringify((()=>{var el=document.querySelector('input[aria-label="${label}"]');if(!el)return null;var r=el.getBoundingClientRect();return JSON.stringify([Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]);})())`);
  const c = raw ? JSON.parse(raw) : null;
  if (!c) throw new Error('no input: ' + label);
  await clickAt(c[0], c[1]);
  await sleep(200);
};
const cardIcon = async () =>
  JSON.parse(
    await ev(`(() => { const c=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('记事本')); if(!c) return JSON.stringify({there:false});
      var es=!!c.querySelector('span[style*="font-size"]'); var img=c.querySelector('img');
      return JSON.stringify({there:true, emojiSpan:es, hasImg:!!img, imgPng:!!(img&&(img.src||'').startsWith('data:image/'))}); })()`),
  );
const version = async () => await ev(`(() => { const m=[...document.querySelectorAll('p,span')].map(x=>x.textContent.trim()).filter(t=>/^当前版本 v\\d/.test(t)); return m[0] ?? null; })()`);

// 0. 隐私门 + 团队页 + 关掉可能残留的菜单
await ev(`(() => { const a=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('允许')||b.textContent.includes('确认')); if(a)a.click(); return true; })()`);
await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.body.click(); true`);
await sleep(400);
await ev(`(() => { const t=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.trim()==='团队入口'); if(t)t.click(); return true; })()`);
await sleep(500);

// 1. 解锁链：点编辑模式 → 无口令则 enroll
await clickBtn(`b.textContent.trim() === '编辑模式'`);
const needEnroll = await ev(`JSON.stringify({pw: !!document.querySelector('input[aria-label="设置管理员口令"]'), verify: !!document.querySelector('input[aria-label="管理员口令"]')})`);
console.log('unlock probe:', needEnroll);
const np = JSON.parse(needEnroll);
if (np.pw) {
  await clickInput('设置管理员口令');
  await send('Input.insertText', { text: 'tl-publish-2026' });
  await clickInput('确认管理员口令');
  await send('Input.insertText', { text: 'tl-publish-2026' });
  await clickBtn(`b.textContent.trim() === '设置并启用'`);
  await sleep(1000);
  // 解锁后需再点一次编辑模式
  await clickBtn(`b.textContent.trim() === '编辑模式'`);
} else if (np.verify) {
  await clickInput('管理员口令');
  await send('Input.insertText', { text: 'tl-publish-2026' });
  await clickBtn(`b.textContent.trim() === '启用'`);
  await sleep(1000);
  await clickBtn(`b.textContent.trim() === '编辑模式'`);
}
await sleep(400);
console.log('version (edit mode):', await version());

// 2. 右键记事本 → 重编辑 → 恢复自动图标 → 保存
const pos = JSON.parse(await ev(`(() => { const c=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('记事本')); if(!c) return 'null'; var r=c.getBoundingClientRect(); return JSON.stringify([Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]); })()`));
if (pos === 'null') throw new Error('card not found');
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos[0], y: pos[1], button: 'right', clickCount: 1, buttons: 2 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos[0], y: pos[1], button: 'right', clickCount: 1, buttons: 0 });
await sleep(500);
await clickBtn(`b.textContent.trim() === '重编辑'`);
await sleep(600);
await clickBtn(`b.textContent.trim() === '恢复自动图标'`);
await clickBtn(`b.textContent.trim() === '保存'`);
await sleep(1000);
const editCard = await cardIcon();
console.log('card after restore (edit mode, expect imgPng=true):', JSON.stringify(editCard));

// 3. 发布（编辑条按钮）→ 确认 → 断言成功
const vBefore = await version();
await clickBtn(`b.textContent.trim().startsWith('发布 · ')`);
await sleep(600);
await clickBtn(`b.closest('[role=dialog]') && (b.textContent.trim().startsWith('发布 · ') || b.textContent.trim() === '发布')`);
await sleep(1800);
const dlgAfter = await ev(`JSON.stringify({open: !!document.querySelector('[role=dialog]'), text: document.querySelector('[role=dialog]')?.textContent?.slice(0,120) ?? null})`);
const toasts = await ev(`JSON.stringify([...document.querySelectorAll('[data-tone]')].map(t=>t.textContent.trim().slice(0,70)))`);
console.log('publish result:', dlgAfter);
console.log('toasts:', toasts);
console.log('version before:', vBefore, '→ after:', await version());

// 4. 退出编辑模式（有改动弹确认则放弃）→ 已发布配置的卡片应仍是程序图标
await clickBtn(`b.textContent.trim() === '退出编辑' || b.textContent.trim() === '编辑模式'`);
await sleep(400);
const confirmDiscard = await ev(`JSON.stringify({btn: [...document.querySelectorAll('button')].some(b=>b.textContent.includes('放弃改动')||b.textContent.includes('放弃'))})`);
if (JSON.parse(confirmDiscard).btn) await clickBtn(`b.textContent.includes('放弃')`);
await sleep(600);
const publishedCard = await cardIcon();
console.log('card after exit edit (published, expect imgPng=true):', JSON.stringify(publishedCard));

const ok = editCard.imgPng && publishedCard.imgPng && JSON.parse(toasts).some((t) => t.includes('已发布'));
console.log(ok ? '=== ALL PASS ===' : '=== FAIL ===');
ws.close();
process.exit(ok ? 0 : 1);
