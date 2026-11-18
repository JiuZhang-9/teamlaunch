#!/usr/bin/env node
/**
 * 最近打开扩展门禁（2026-11-18）。
 *
 * 判定本体在 src/shared/recent.ts：旧 { entryId, at } 迁移、四类直接项 + 连锁记录、
 * 同目标/同连锁去重前移、上限、开关过滤、与现有入口按 target/url 合并。
 * 这里覆盖这些分支，并做几条源码级接线断言（记录点与两处开关）。
 *
 * 用法：node --experimental-transform-types scripts/verify-recent.mjs
 */
import { readFile } from 'node:fs/promises';
import {
  RECENT_LIMIT,
  directRecentInput,
  filterRecentForDisplay,
  makeRecent,
  parseRecentRecords,
  probeOfRecent,
  recentDisplayId,
  recentDisplayName,
  recentKey,
  recentPathBase,
  renameRecentTitle,
  upsertRecent,
} from '../src/shared/recent.ts';
import { findEntryIndex } from '../src/shared/entry-match.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const expect = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? '' : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

const at = '2026-11-18T00:00:00.000Z';

/* ---------- 解析 / 旧格式迁移 ---------- */
expect('非数组按空处理', parseRecentRecords({ nope: true }), []);
expect('坏 JSON 按空处理', parseRecentRecords('{nope'), []);
expect('旧格式 { entryId, at } 迁移为入口记录', parseRecentRecords([{ entryId: 'e1', at }]), [
  { kind: 'entry', entryId: 'e1', at },
]);
expect('缺 at 的记录丢弃', parseRecentRecords([{ entryId: 'e1' }]), []);
expect('未知 kind 丢弃', parseRecentRecords([{ kind: 'device', id: 'x', at }]), []);
expect('app 记录缺 target 丢弃', parseRecentRecords([{ kind: 'app', name: 'x', at }]), []);
expect('app 记录补空字段', parseRecentRecords([{ kind: 'app', name: '记事本', target: 'C:\\Windows\\notepad.exe', at }]), [
  { kind: 'app', name: '记事本', target: 'C:\\Windows\\notepad.exe', sourcePath: null, args: '', cwd: '', at },
]);
expect('web 标题与 URL 保留', parseRecentRecords([{ kind: 'web', name: '示例', url: 'https://example.com/a', at }]), [
  { kind: 'web', name: '示例', url: 'https://example.com/a', at },
]);
expect('chain 只存 chainId', parseRecentRecords([{ kind: 'chain', chainId: 'c1', at }]), [
  { kind: 'chain', chainId: 'c1', at },
]);
expect('同键记录只保留第一条', parseRecentRecords([
  { kind: 'entry', entryId: 'e1', at },
  { kind: 'entry', entryId: 'e1', at: '2026-11-17T00:00:00.000Z' },
]), [{ kind: 'entry', entryId: 'e1', at }]);

const lots = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) => ({
  kind: 'entry',
  entryId: `e${i}`,
  at,
}));
check(`解析上限 ${RECENT_LIMIT} 条`, parseRecentRecords(lots).length === RECENT_LIMIT);

/* ---------- 键 / 去重 / 前移 ---------- */
check(
  '路径键忽略大小写与斜杠方向',
  recentKey({ kind: 'folder', name: 'A', target: 'C:\\Work\\Foo', at }) ===
    recentKey({ kind: 'folder', name: 'A', target: 'c:/work/foo', at }),
);
check(
  'URL 键大小写敏感（路径部分不能 lowercase）',
  recentKey({ kind: 'web', name: 'A', url: 'https://example.com/A', at }) !==
    recentKey({ kind: 'web', name: 'A', url: 'https://example.com/a', at }),
);
check(
  'app 键区分参数',
  recentKey({ kind: 'app', name: 'A', target: 'C:\\a.exe', sourcePath: null, args: '--one', cwd: '', at }) !==
    recentKey({ kind: 'app', name: 'A', target: 'C:\\a.exe', sourcePath: null, args: '--two', cwd: '', at }),
);

const old = makeRecent({ kind: 'entry', entryId: 'e1' }, '2026-11-01T00:00:00.000Z');
const newer = makeRecent({ kind: 'entry', entryId: 'e2' }, '2026-11-02T00:00:00.000Z');
expect('同键重复打开只前移', upsertRecent([old, newer], makeRecent({ kind: 'entry', entryId: 'e1' }, at)), [
  makeRecent({ kind: 'entry', entryId: 'e1' }, at),
  newer,
]);
check('超过上限截断', upsertRecent(parseRecentRecords(lots), makeRecent({ kind: 'chain', chainId: 'c-new' }, at)).length === RECENT_LIMIT);

/* ---------- 开关过滤 ---------- */
const mixed = [
  makeRecent({ kind: 'entry', entryId: 'e1' }, at),
  makeRecent({ kind: 'app', name: '记事本', target: 'C:\\Windows\\notepad.exe', sourcePath: null, args: '', cwd: '' }, at),
  makeRecent({ kind: 'folder', name: '资料', target: 'D:\\资料' }, at),
  makeRecent({ kind: 'web', name: '示例', url: 'https://example.com' }, at),
  makeRecent({ kind: 'chain', chainId: 'c1' }, at),
];
expect('关闭开关只留入口记录', filterRecentForDisplay(mixed, false), [mixed[0]]);
check('开启开关全部保留', filterRecentForDisplay(mixed, true).length === mixed.length);

/* ---------- 与现有入口合并 ---------- */
const appEntry = {
  id: 'entry-notepad',
  name: '记事本',
  type: 'app',
  target: 'C:\\Windows\\notepad.exe',
  sourcePath: null,
  args: '',
  cwd: '',
  expandEnv: true,
  sort: 0,
  description: null,
  icon: { kind: 'local' },
  iconAssetHash: null,
  updatedAt: at,
};
const appRecord = mixed[1];
check('app 探针大小写不敏感命中现有入口', findEntryIndex([appEntry], probeOfRecent(appRecord)) === 0);
const webEntry = {
  id: 'entry-web',
  name: '示例',
  type: 'web',
  url: 'https://example.com',
  sort: 0,
  description: null,
  icon: { kind: 'fallback' },
  iconAssetHash: null,
  updatedAt: at,
};
check('web 探针命中现有入口', findEntryIndex([webEntry], probeOfRecent(mixed[3])) === 0);
check('entry/chain 记录不参与探针合并', probeOfRecent(mixed[0]) === null && probeOfRecent(mixed[4]) === null);

/* ---------- 直接项 → 记录 ---------- */
expect('app 入口转直接记录', directRecentInput(appEntry), {
  kind: 'app',
  name: '记事本',
  target: 'C:\\Windows\\notepad.exe',
  sourcePath: null,
  args: '',
  cwd: '',
});
expect('web 入口转直接记录', directRecentInput(webEntry), {
  kind: 'web',
  name: '示例',
  url: 'https://example.com',
});
const longName = '名'.repeat(80);
const longFolder = {
  id: 'f',
  name: longName,
  type: 'folder',
  target: 'D:\\资料',
  sort: 0,
  description: null,
  icon: { kind: 'local' },
  iconAssetHash: null,
  updatedAt: at,
};
check('直接记录名称截到 40', directRecentInput(longFolder).name.length === 40);

/* ---------- 显示 ---------- */
check('文件夹显示名取 basename', recentDisplayName({ kind: 'folder', name: '', target: 'D:\\项目\\资料' }) === '资料');
check('文件夹根路径回退自身', recentPathBase('D:\\') === 'D:');
check('程序显示名优先记录名', recentDisplayName(appRecord) === '记事本');
check('网页缺名回退 URL', recentDisplayName({ kind: 'web', name: '', url: 'https://example.com' }) === 'https://example.com');
const idApp = recentDisplayId(appRecord);
check('合成 id 稳定且 <=64', idApp === recentDisplayId(appRecord) && idApp.length <= 64);
check('连锁 id 沿用 chain: 前缀', recentDisplayId(mixed[4]) === 'chain:c1');
check('不同目标的合成 id 不同', idApp !== recentDisplayId(mixed[2]));
expect('网页标题回写', renameRecentTitle([mixed[3]], recentKey(mixed[3]), '真实标题')[0].name, '真实标题');
expect('非网页记录不被标题回写', renameRecentTitle([mixed[0]], recentKey(mixed[0]), '真实标题'), [mixed[0]]);

/* ---------- 源码级接线 ---------- */
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
const workbench = await read('src/renderer/store/workbenchStore.tsx');
const palette = await read('src/renderer/lib/palette-source.ts');
const mini = await read('src/renderer/pages/MiniPaletteView.tsx');
const main = await read('src/renderer/components/organisms/MainWindowShell.tsx');
const results = await read('src/renderer/components/organisms/PaletteResults.tsx');
const schema = await read('src/shared/schema/local.ts');
const settings = await read('src/renderer/components/organisms/SettingsPanel.tsx');

check('workbench 记录入口/直接项/连锁三种动作',
  workbench.includes('recordEntryOpen') && workbench.includes('recordDirectOpen') && workbench.includes('recordChainOpen'));
check('palette 用 findEntryIndex 合并现有入口', palette.includes('findEntryIndex') && palette.includes('probeOfRecent'));
check('两处窗口都传 recentIncludeUnlisted', mini.includes('recentIncludeUnlisted') && main.includes('recentIncludeUnlisted'));
check('PaletteResults 有开关与隐藏提示', results.includes('recentIncludeUnlisted') && results.includes('已隐藏'));
check('settings schema 默认开启', /recentIncludeUnlisted:\s*z\.boolean\(\)\.default\(true\)/.test(schema));
check('设置面板暴露开关', settings.includes('recentIncludeUnlisted'));

if (failed > 0) {
  console.error(`\nverify:recent FAILED — ${failed} 项`);
  process.exit(1);
}
console.log('\nverify:recent PASS');
