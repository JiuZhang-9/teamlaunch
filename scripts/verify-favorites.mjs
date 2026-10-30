#!/usr/bin/env node
/**
 * 收藏统一门禁（2026-10-30，1.7.0）。
 *
 * 判定本体在 src/shared/favorites.ts：旧「固定」并入收藏、单条 toggle、多选一次设定、
 * 最近收藏倒序。这里覆盖这些分支，并做四条源码级接线断言：
 *   - 主窗口与快捷窗口都挂 FavoriteProvider；
 *   - store 走主进程 toggle / setMany 并订阅跨窗口广播；
 *   - 快捷窗口的收藏段用 kind='favorite'。
 *
 * 用法：node --experimental-transform-types scripts/verify-favorites.mjs
 */
import { readFile } from 'node:fs/promises';
import {
  favoriteIdsNewestFirst,
  mergeLegacyPinned,
  normalizeFavorites,
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

const at = '2026-10-30T00:00:00.000Z';
const a = { entryId: 'a', addedAt: '2026-10-01T00:00:00.000Z' };
const b = { entryId: 'b', addedAt: '2026-10-02T00:00:00.000Z' };

expect('坏数据按空处理', normalizeFavorites({ nope: true }), []);
expect('按 id 去重并保留首次顺序', normalizeFavorites([a, a, b]), [a, b]);

expect('单条收藏追加到末尾', toggleFavoriteInList([a], 'b', at), [a, { entryId: 'b', addedAt: at }]);
expect('单条取消收藏', toggleFavoriteInList([a, b], 'a', at), [b]);

expect('批量设为收藏：先摘掉再按传入顺序追加', setFavoriteManyInList([a], ['b', 'c'], true, at), [
  a,
  { entryId: 'b', addedAt: at },
  { entryId: 'c', addedAt: at },
]);
expect('批量取消收藏', setFavoriteManyInList([a, b, { entryId: 'c', addedAt: at }], ['a', 'c'], false, at), [b]);

expect('旧固定并入：去重后追加', mergeLegacyPinned([a], ['a', 'b', 'c'], at), [
  a,
  { entryId: 'b', addedAt: at },
  { entryId: 'c', addedAt: at },
]);
expect('快捷面：最近收藏在前', favoriteIdsNewestFirst([a, b]), ['b', 'a']);

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
const app = await read('src/renderer/App.tsx');
const paletteRoot = await read('src/renderer/pages/PaletteRoot.tsx');
const store = await read('src/renderer/store/favoriteStore.tsx');
const source = await read('src/renderer/lib/palette-source.ts');
check('主窗口挂 FavoriteProvider（并开启旧固定迁移）', app.includes('FavoriteProvider migrateLegacyPinned'));
check('快捷窗口挂 FavoriteProvider', paletteRoot.includes('FavoriteProvider'));
check('store 走主进程 toggle + 跨窗口广播', store.includes('api.favorites.toggle') && store.includes('api.events.onFavoritesChanged'));
check('快捷窗口收藏段使用 kind=favorite', source.includes("kind: 'favorite'"));

console.log('');
console.log(failed === 0 ? '收藏统一门禁：全部通过。' : `收藏统一门禁：${failed} 项失败。`);
process.exit(failed === 0 ? 0 : 1);
