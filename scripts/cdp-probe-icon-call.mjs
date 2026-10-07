#!/usr/bin/env node
/** 直接调 window.tl.entries.icon,看主进程对 ima 的真实返回。 */
const list = await (await fetch('http://127.0.0.1:19222/json/list')).json();
const page = list.filter((p) => p.type === 'page' && !p.url.includes('#/palette'))[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
await new Promise((r) => (ws.onopen = r));

const ev = async (ex) => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result?.value;

const imaEntry = {
  id: 'e-test-ima',
  type: 'app',
  name: 'ima-probe',
  sort: 0,
  target: '${process.env.LOCALAPPDATA}\\ima.copilot\\Application\\ima.copilot.exe',
  icon: { kind: 'local' },
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const obsEntry = {
  id: 'e-test-obs',
  type: 'app',
  name: 'obs-probe',
  sort: 0,
  target: 'D:\\Program Files\\Obsidian\\Obsidian.exe',
  icon: { kind: 'local' },
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const probe = (entry) => ev(`window.tl.entries.icon(${JSON.stringify(entry)}).then(u => u ? u.slice(0, 40) + '... len=' + u.length : 'NULL').catch(e => 'ERR ' + e.message)`);
console.log('ima:', await probe(imaEntry));
console.log('obsidian:', await probe(obsEntry));
ws.close();
process.exit(0);
