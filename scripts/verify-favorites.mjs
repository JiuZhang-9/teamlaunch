#!/usr/bin/env node
/**
 * 收藏统一门禁（2026-10-30，1.7.0；2026-11-21，1.10.0 扩手动排序）。
 *
 * 判定本体在 src/shared/favorites.ts：旧「固定」并入收藏、单条 toggle、多选一次设定、
 * 显示顺序（唯一口径）、拖拽重排。这里覆盖这些分支，并做源码级接线断言：
 *   - 主窗口与快捷窗口都挂 FavoriteProvider；
 *   - store 走主进程 toggle / setMany / reorder 并订阅跨窗口广播；
 *   - 快捷窗口的收藏段用 kind='favorite'；
 *   - 主页与搜索浮层都只走 favoriteIdsForDisplay（不允许再各自 reverse）。
 *
 * 用法：node --experimental-transform-types scripts/verify-favorites.mjs
 */
import { readFile } from 'node:fs/promises';
import {
  favoriteIdsForDisplay,
  mergeLegacyPinned,
  moveFavoriteId,
  normalizeFavorites,
  reorderFavorites,
  setFavoriteManyInList,
  toggleFavoriteInList,
} from '../src/shared/favorites.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const expect = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? '' : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};
const ids = (list) => list.map((item) => item.entryId);

const at = '2026-10-30T00:00:00.000Z';
const a = { entryId: 'a', addedAt: '2026-10-01T00:00:00.000Z' };
const b = { entryId: 'b', addedAt: '2026-10-02T00:00:00.000Z' };
const c = { entryId: 'c', addedAt: '2026-10-03T00:00:00.000Z' };

expect('坏数据按空处理', normalizeFavorites({ nope: true }), []);
expect('按 id 去重并保留首次顺序', ids(normalizeFavorites([a, a, b])), ['a', 'b']);
expect('合法 sort 保留、坏 sort 丢弃', normalizeFavorites([{ ...a, sort: 3 }, { ...b, sort: -1 }]), [
  { entryId: 'a', addedAt: a.addedAt, sort: 3 },
  b,
]);

/* ---- 显示顺序（唯一口径） ---- */
expect('老数据（无 sort）：最近收藏在前', favoriteIdsForDisplay([a, b]), ['b', 'a']);
expect(
  '显式 sort：按 sort 升序',
  favoriteIdsForDisplay([
    { ...a, sort: 1 },
    { ...b, sort: 0 },
  ]),
  ['b', 'a'],
);
expect('刚收藏（无 sort）排在已排序项之前', favoriteIdsForDisplay([{ ...b, sort: 0 }, { ...c }]), ['c', 'b']);

/* ---- 单条 / 批量 ---- */
expect('单条收藏排显示最前', ids(toggleFavoriteInList([a], 'b', at)), ['b', 'a']);
expect('单条取消收藏', ids(toggleFavoriteInList([a, b], 'a', at)), ['b']);
expect('批量设为收藏：按传入顺序排最前', ids(setFavoriteManyInList([a], ['b', 'c'], true, at)), ['b', 'c', 'a']);
expect(
  '批量取消收藏',
  ids(setFavoriteManyInList([a, b, c], ['a', 'c'], false, at)),
  ['b'],
);

/* ---- 旧固定迁移 ---- */
expect('旧固定并入：最近固定的排在显示最前', ids(mergeLegacyPinned([a], ['a', 'b', 'c'], at)), ['c', 'b', 'a']);

/* ---- 拖拽重排（1.10.0） ---- */
expect(
  'reorder：传入顺序在前，未出现的按原显示顺序跟随',
  ids(reorderFavorites([a, b, c], ['c', 'a'])),
  ['c', 'a', 'b'],
);
expect(
  'reorder：写入连续 sort',
  reorderFavorites([a, b, c], ['c', 'a']).map((item) => item.sort),
  [0, 1, 2],
);
expect('move：拖到末尾', moveFavoriteId(['a', 'b', 'c'], 'a', 3), ['b', 'c', 'a']);
expect('move：拖到开头', moveFavoriteId(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
expect('move：中间往后一格', moveFavoriteId(['a', 'b', 'c'], 'b', 3), ['a', 'c', 'b']);

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
const app = await read('src/renderer/App.tsx');
const paletteRoot = await read('src/renderer/pages/PaletteRoot.tsx');
const store = await read('src/renderer/store/favoriteStore.tsx');
const source = await read('src/renderer/lib/palette-source.ts');
const home = await read('src/renderer/pages/HomePageView.tsx');
const windowSearch = await read('src/renderer/pages/WindowSearchView.tsx');
const shell = await read('src/renderer/components/organisms/MainWindowShell.tsx');
check('主窗口挂 FavoriteProvider（并开启旧固定迁移）', app.includes('FavoriteProvider migrateLegacyPinned'));
check('快捷窗口挂 FavoriteProvider', paletteRoot.includes('FavoriteProvider'));
check(
  'store 走主进程 toggle / reorder + 跨窗口广播',
  store.includes('api.favorites.toggle') &&
    store.includes('api.favorites.reorder') &&
    store.includes('api.events.onFavoritesChanged'),
);
check('快捷窗口收藏段使用 kind=favorite', source.includes("kind: 'favorite'"));
check('主页收藏只走 favoriteIdsForDisplay（store 提供）', home.includes('favoriteIds') && !home.includes('[...favorites].reverse()'));
check(
  '主窗口搜索把 reorder 接到 PaletteResults',
  windowSearch.includes('onReorderFavorites={onReorderFavorites}') && shell.includes('onReorderFavorites={reorderFavorites}'),
);

console.log('');
console.log(failed === 0 ? '收藏统一门禁：全部通过。' : `收藏统一门禁：${failed} 项失败。`);
process.exit(failed === 0 ? 0 : 1);
