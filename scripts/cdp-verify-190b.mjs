#!/usr/bin/env node
/** 临时驱动（1.9.0 复测）：连锁收藏全链路 + 框选光圈 + Tab 翻页语义。跑完看输出。 */
const CDP_PORT = process.env.TL_CDP_PORT ?? '19222';
const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const page = list.filter((p) => p.type === 'page' && !p.url.includes('#/palette'))[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
console.log('  ws connected:', page.url.slice(-40));
const ev = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickAt = async (x, y, modifiers = 0) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1, modifiers });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0, modifiers });
};
const clickButtonByText = async (text, scope = 'document') => {
  const raw = await ev(
    `JSON.stringify((() => { const el = [...${scope}.querySelectorAll('button')].find(b => b.textContent.trim().includes('${text}') && (b.offsetParent !== null || getComputedStyle(b).position === 'fixed')); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })())`,
  );
  if (!raw || raw === 'null') throw new Error('button not found: ' + text);
  const [x, y] = JSON.parse(raw);
  await clickAt(x, y);
  await sleep(400);
};
const type = async (text) => { await send('Input.insertText', { text }); await sleep(150); };
const key = async (k, modifiers = 0, code) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code ?? k, windowsVirtualKeyCode: 0, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code ?? k, windowsVirtualKeyCode: 0, modifiers });
};
const out = (k, v) => console.log(`  ${k}: ${v}`);

/* 1. 隐私门（新档案首跑必有） */
const gate = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='允许并继续'&&x.offsetParent!==null); if(!b) return 'none'; const r=b.getBoundingClientRect(); return JSON.stringify([r.x+10,r.y+10]); })()`);
if (gate !== 'none') { const [x, y] = JSON.parse(gate); await clickAt(x, y); await sleep(600); out('隐私门', '已允许'); }

/* 2. 进个人入口页 */
await key('Escape');
await sleep(200);
await clickButtonByText('个人入口');
await sleep(400);

/* 3. 加两条入口（记事本 app + example.com 网页） */
for (const [name, kind, value, pathAria] of [['记事本', '软件', 'C:\\\\Windows\\\\System32\\\\notepad.exe', '程序路径'], ['测试网页', '网页', 'https://example.com', '网页地址']]) {
  await clickButtonByText('新建入口');
  await sleep(500);
  await ev(`(() => { const dlg=document.querySelector('[role=dialog]'); const b=[...dlg.querySelectorAll('button,[role=radio]')].find(x=>x.textContent.trim()==='${kind}'); b && b.click(); })()`);
  await sleep(200);
  await ev(`(() => { const el=document.querySelector('input[aria-label="入口名称"]'); el && el.focus(); })()`);
  await type(name);
  const hasPath = await ev(`!!document.querySelector('input[aria-label="${pathAria}"]')`);
  if (hasPath === true) {
    await ev(`(() => { const el=document.querySelector('input[aria-label="${pathAria}"]'); el && el.focus(); })()`);
    await type(value);
  } else {
    await ev(`(() => { const el=document.querySelector('input[aria-label="网页地址"]'); el && el.focus(); })()`);
    await type(value);
  }
  await ev(`(() => { const dlg=document.querySelector('[role=dialog]'); const b=[...dlg.querySelectorAll('button')].find(x=>x.textContent.trim()==='添加'); b && b.click(); })()`);
  await sleep(500);
}
const cards = await ev(`JSON.stringify([...document.querySelectorAll('[data-tl-card-id]')].map(c => c.getAttribute('data-tl-card-id')))`);
out('个人页卡片', cards);

/* 4. Ctrl+点两张卡 → 连锁条 → 收藏（先关掉可能开着的对话框 + 清残留清单） */
await key('Escape');
await sleep(300);
const hadBar = await ev(`!!([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '清空' && (b.offsetParent !== null || getComputedStyle(b).position === 'fixed')))`);
if (hadBar) { await clickButtonByText('清空'); out('清空旧清单', 'done'); }
const rects = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-tl-card-id]')].slice(0,2).map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; }))`));
await clickAt(rects[0][0], rects[0][1], 2);
await sleep(250);
await clickAt(rects[1][0], rects[1][1], 2);
await sleep(400);
const bar = await ev(`!!([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '收藏' && b.offsetParent !== null))`);
out('连锁条出现', bar);
await clickButtonByText('收藏');
await sleep(300);
await ev(`(() => { const el=document.querySelector('input[aria-label="连锁名称"]') || document.querySelector('input'); el && el.focus(); })()`);
await type('晨间套装');
await ev(`(() => { const dlg=[...document.querySelectorAll('[role=dialog]')].pop(); const b=dlg && [...dlg.querySelectorAll('button')].find(x=>x.textContent.trim()==='收藏'); b && b.click(); })()`);
await sleep(700);
const saved = await ev(`JSON.stringify({dialogLeft: document.querySelectorAll('[role=dialog]').length, badge: !!document.querySelector('[data-tl-card-id] .rounded-full[style*=accent]')})`);
out('保存连锁后', saved);

/* 5. 落盘验证（老连锁迁移 + 新连锁收藏） */
const disk = await ev(`JSON.stringify({fav: (await fetch('http://127.0.0.1:19222/json/version')).ok})`);
out('（磁盘校验在脚本外做）', disk);

/* 6. 搜索快速访问出现连锁格 */
await key('f', 2, 'KeyF');
await sleep(700);
const tiles = await ev(`JSON.stringify([...document.querySelectorAll('[data-tl-tile]')].map(t => t.textContent.trim()).slice(0, 10))`);
out('快速访问格', tiles);
await ev(`(() => { const inp=[...document.querySelectorAll('input')].find(i=>i.placeholder&&i.placeholder.includes('搜索')); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(inp,'老连锁'); inp.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(500);
const chainRow = await ev(`JSON.stringify((() => { const rows=[...document.querySelectorAll('[role=option],[class*=ResultRow],[data-tl-palette-hit]')]; const tag=[...document.querySelectorAll('span')].find(s=>s.textContent.trim()==='连锁'); return {rows: rows.length, chainTag: !!tag}; })())`);
out('搜「老连锁」', chainRow);
await key('Escape');
await sleep(300);

/* 7. 框选光圈：从空白处拖过第一张卡，途中取样 */
const pr = JSON.parse(await ev(`JSON.stringify((() => { const c=document.querySelectorAll('[data-tl-card-id]')[0]; const panel=document.querySelector('#tl-panel-personal'); const pc=panel.getBoundingClientRect(); const r=c.getBoundingClientRect(); return [Math.round(pc.left + pc.width/2), Math.round(pc.bottom - 40), Math.round(r.left + r.width/2), Math.round(r.top + r.height/2)]; })())`));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pr[0], y: pr[1], button: 'left', clickCount: 1, buttons: 1 });
for (let i = 1; i <= 8; i += 1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pr[0] + (pr[2] - pr[0]) * i / 8), y: Math.round(pr[1] + (pr[3] - pr[1]) * i / 8), buttons: 1 });
  await sleep(30);
}
await sleep(60);
const midDrag = await ev(`JSON.stringify((() => { const hits=[...document.querySelectorAll('[data-tl-marquee-hit=true]')]; const rect=document.querySelector('.tl-marquee-rect'); if (hits.length === 0) return {hit:0, marqueeRect: !!rect, rectVisible: rect?getComputedStyle(rect).display:null}; const c=hits[0]; const cs=getComputedStyle(c); return {hit:hits.length, delay:c.style.transitionDelay, outline: cs.outlineColor, shadowGlow: cs.boxShadow.includes('rgba')}; })())`);
out('拖框中命中卡', midDrag);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pr[2], y: pr[3], button: 'left', clickCount: 1, buttons: 0 });
await sleep(500);
const afterUp = await ev(`JSON.stringify((() => { const c=document.querySelector('[data-tl-card-id]'); return {glowKept: (c.getAttribute('style')||'').includes('color-mix'), badge: !!c.querySelector('span[aria-hidden]')}; })())`);
out('松手后选中卡', afterUp);

/* 8. Tab 翻页语义：焦点不落到卡片上 */
const before = await ev(`document.activeElement.tagName`);
await key('Tab', 0, 'Tab');
await sleep(500);
const after = await ev(`JSON.stringify({active: document.activeElement.tagName, scroll: Math.round((document.querySelector('#tl-panel-personal .tl-scroll')||{scrollTop:0}).scrollTop)})`);
out(`Tab 前 active=${before}`, after);
console.log('DONE');
process.exit(0);
