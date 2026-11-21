#!/usr/bin/env node
/**
 * 书签浏览器识别门禁（1.10.0，2026-11-21）。
 *
 * 背景：用户反馈"明明电脑上有好几种浏览器，为什么只识别 Chrome 和 Edge"。
 * 根因是旧的固定路径白名单；现在改为"固定表 + 动态扫描"，这个门禁用临时目录
 * 构造几种真实形态，断言：
 *   - 不在固定表里的 Chromium 浏览器（夸克 / 豆包 / 任意 vendor/product）能被发现；
 *   - Opera 这种"宿主目录下直接是 profile"的形态能被发现；
 *   - 非浏览器目录不会被误报；
 *   - 固定表目录使用友好名、动态目录用目录名/映射名；
 *   - scan 只读 list 登记过的目录，且能正确解析 Bookmarks。
 *
 * 用法：node --experimental-transform-types scripts/verify-bookmarks.mjs
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listBookmarkBrowsersAt, scanBookmarks } from '../src/main/bookmarks.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const BOOKMARKS = JSON.stringify({
  roots: {
    bookmark_bar: {
      children: [
        { type: 'url', name: 'Example', url: 'https://example.com/' },
        { type: 'folder', name: '组', children: [{ type: 'url', name: '', url: 'https://team.test/' }] },
      ],
    },
  },
});

async function touch(path, content = '') {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function makeProfile(dataDir, profile) {
  await mkdir(join(dataDir, profile), { recursive: true });
  await writeFile(join(dataDir, profile, 'Bookmarks'), BOOKMARKS, 'utf8');
}

const base = await mkdtemp(join(tmpdir(), 'tl-bookmarks-'));
const local = join(base, 'Local');
const roaming = join(base, 'Roaming');

try {
  /* 固定表：Chrome */
  await touch(join(local, 'Google', 'Chrome', 'User Data', 'Local State'));
  await makeProfile(join(local, 'Google', 'Chrome', 'User Data'), 'Default');

  /* 动态：夸克（vendor/User Data，无固定表） */
  await touch(join(local, 'Quark', 'User Data', 'Local State'));
  await makeProfile(join(local, 'Quark', 'User Data'), 'Default');

  /* 动态：豆包（有 Bookmarks，没有 Local State 也要认） */
  await makeProfile(join(local, 'Doubao', 'User Data'), 'Profile 1');

  /* 动态：任意 vendor/product/User Data */
  await touch(join(local, 'FakeVendor', 'FakeBrowser', 'User Data', 'Local State'));
  await makeProfile(join(local, 'FakeVendor', 'FakeBrowser', 'User Data'), 'Default');

  /* Opera：宿主目录下直接是 profile */
  await makeProfile(join(roaming, 'Opera Software'), 'Opera Stable');

  /* 非浏览器目录：不能被误报 */
  await touch(join(local, 'NotABrowser', 'readme.txt'), 'not a browser');
  await touch(join(roaming, 'SomeApp', 'data.txt'), 'not a browser');

  /* Electron 应用：userData 里有 Chromium 的 Local State，但没有 Bookmarks——
     2026-11-21 实机就是这么把几十个 AppData 目录误报成浏览器的。 */
  await touch(join(roaming, 'ElectronApp', 'Local State'), '{}');
  await mkdir(join(roaming, 'ElectronApp', 'Default'), { recursive: true });

  const browsers = await listBookmarkBrowsersAt(local, roaming);
  const names = browsers.map((b) => b.name);
  const byName = (name) => browsers.find((b) => b.name === name);

  check('固定表目录用友好名（Google Chrome）', byName('Google Chrome') !== undefined, names.join(' / '));
  check('固定表 id 保持稳定（chrome）', byName('Google Chrome')?.id === 'chrome');
  check('动态发现夸克（目录名映射为中文）', byName('夸克浏览器') !== undefined, names.join(' / '));
  check('动态发现豆包（无 Local State，仅凭 Bookmarks）', byName('豆包浏览器') !== undefined, names.join(' / '));
  check('动态发现任意 vendor/product 浏览器', byName('FakeBrowser') !== undefined, names.join(' / '));
  check('Opera 宿主目录形态被发现并保留固定表名', byName('Opera') !== undefined, names.join(' / '));
  check('非浏览器目录不误报', byName('NotABrowser') === undefined && byName('SomeApp') === undefined);
  check('Electron 应用（有 Local State、无 Bookmarks）不误报', byName('ElectronApp') === undefined);
  check('夸克 profile 列表正确', JSON.stringify(byName('夸克浏览器')?.profiles) === JSON.stringify(['Default']));
  check('Chrome 只出现一次', browsers.filter((b) => b.name === 'Google Chrome').length === 1);

  /* scan：只认 list 登记过的目录 */
  const chrome = byName('Google Chrome');
  const chromeSources = await scanBookmarks(chrome?.id);
  check('scan 已知浏览器：读到 1 个 profile', chromeSources.length === 1);
  check('scan 解析书签：标题/网址正确', chromeSources[0]?.items[0]?.title === 'Example' && chromeSources[0]?.items[0]?.url === 'https://example.com/');
  check('scan 解析嵌套文件夹', chromeSources[0]?.items.some((item) => item.url === 'https://team.test/'));

  const quark = byName('夸克浏览器');
  const quarkSources = await scanBookmarks(quark?.id);
  check('scan 动态发现浏览器也能读', quarkSources.length === 1 && quarkSources[0]?.items.length === 2);

  check('scan 未登记 id 返回空（不按任意路径读盘）', (await scanBookmarks('auto:c:\\not\\allowed')).length === 0);
} finally {
  await rm(base, { recursive: true, force: true });
}

console.log('');
console.log(failed === 0 ? '书签识别门禁：全部通过。' : `书签识别门禁：${failed} 项失败。`);
process.exit(failed === 0 ? 0 : 1);
