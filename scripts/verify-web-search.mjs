#!/usr/bin/env node
/**
 * 网页搜索门禁（1.11.0，2026-11-21）。
 *
 * 覆盖：
 *   - 从浏览器 Preferences 结构里取默认搜索模板（Chromium 标准位置 + 旧字段兼容）；
 *   - `{searchTerms}` 替换、次要变量清理、非法/非 http 模板拒绝；
 *   - 网址/路径识别（这类输入不提供"网页搜索"）；
 *   - exe 名 ↔ 浏览器数据目录匹配（Chrome / Edge / 夸克 三种命名）；
 *   - 源码级接线：主窗口与快捷窗口都接 webSearch，底部行与 Alt+Enter 存在。
 *
 * 用法：node --experimental-transform-types scripts/verify-web-search.mjs
 */
import { readFile } from 'node:fs/promises';
import {
  buildWebSearchUrl,
  looksLikeUrlOrPath,
  parseDefaultSearchTemplate,
} from '../src/shared/web-search.ts';
import { matchBrowserDir } from '../src/main/defaultSearch.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ---- 模板解析 ---- */
const chromiumPrefs = {
  default_search_provider_data: {
    template_url_data: {
      short_name: '百度',
      keyword: 'baidu.com',
      search_url: 'https://www.baidu.com/s?ie={inputEncoding}&wd={searchTerms}',
    },
  },
};
const baidu = parseDefaultSearchTemplate(chromiumPrefs);
check('Chromium 标准位置：取到百度模板', baidu?.name === '百度' && baidu.template.includes('{searchTerms}'));
check(
  '旧字段 default_search_provider 兼容',
  parseDefaultSearchTemplate({ default_search_provider: { short_name: 'Bing', search_url: 'https://www.bing.com/search?q={searchTerms}' } })?.name === 'Bing',
);
check('缺 {searchTerms} 的模板不认', parseDefaultSearchTemplate({ default_search_provider_data: { template_url_data: { search_url: 'https://x.test/' } } }) === null);
check('坏数据不抛异常', parseDefaultSearchTemplate(null) === null && parseDefaultSearchTemplate('x') === null);
/* 新版 Chrome：只有 keyword / short_name，模板在浏览器二进制里（2026-11-21 本机实测）。 */
check(
  '新版 Chrome 镜像结构：bing.com → Bing',
  parseDefaultSearchTemplate({ default_search_provider_data: { mirrored_template_url_data: { short_name: 'Microsoft Bing', keyword: 'bing.com' } } })?.name === 'Bing',
);
check(
  '新版 Chrome 镜像结构：baidu.com → 百度',
  parseDefaultSearchTemplate({ default_search_provider_data: { mirrored_template_url_data: { short_name: '百度', keyword: 'baidu.com' } } })?.name === '百度',
);
check(
  '镜像结构带 search_url 时优先用模板',
  parseDefaultSearchTemplate({
    default_search_provider_data: { mirrored_template_url_data: { short_name: '内部搜索', keyword: 'corp', search_url: 'https://search.corp/s?q={searchTerms}' } },
  })?.template === 'https://search.corp/s?q={searchTerms}',
);

/* ---- URL 拼接 ---- */
const url = buildWebSearchUrl({ name: '百度', template: 'https://www.baidu.com/s?ie={inputEncoding}&wd={searchTerms}' }, 'hello 世界');
check('替换搜索词并编码', url !== null && url.includes('wd=hello%20%E4%B8%96%E7%95%8C'), url ?? 'null');
check('次要变量 {inputEncoding} 被清理，不留空占位', url !== null && !url.includes('{') && !url.includes('&&'), url ?? 'null');
check('空词返回 null', buildWebSearchUrl({ name: 'x', template: 'https://x.test/?q={searchTerms}' }, '   ') === null);
check('非 http(s) 模板拒绝', buildWebSearchUrl({ name: 'x', template: 'file:///c:/{searchTerms}' }, 'a') === null);
check('host 被变量清空的坏模板拒绝', buildWebSearchUrl({ name: 'x', template: 'https://{google:baseURL}/search?q={searchTerms}' }, 'a') === null);

/* ---- 网址/路径识别 ---- */
check('https 网址不提供网页搜索', looksLikeUrlOrPath('https://example.com/a'));
check('本机路径不提供网页搜索', looksLikeUrlOrPath('C:\\Program Files\\App') && looksLikeUrlOrPath('./rel') && looksLikeUrlOrPath('\\\\server\\share'));
check('普通词与域名仍提供网页搜索', !looksLikeUrlOrPath('员工手册') && !looksLikeUrlOrPath('example.com'));

/* ---- exe ↔ 数据目录匹配 ---- */
const dirs = [
  { id: 'chrome', name: 'Google Chrome', dir: 'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data', profiles: ['Default'] },
  { id: 'edge', name: 'Microsoft Edge', dir: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\Edge\\User Data', profiles: ['Default'] },
  { id: 'auto:quark', name: '夸克浏览器', dir: 'C:\\Users\\u\\AppData\\Local\\Quark\\User Data', profiles: ['Default'] },
  { id: 'opera', name: 'Opera', dir: 'C:\\Users\\u\\AppData\\Roaming\\Opera Software', profiles: ['Opera Stable'] },
];
check('chrome.exe → Chrome 数据目录', matchBrowserDir(dirs, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')?.id === 'chrome');
check('msedge.exe → Edge（包含匹配）', matchBrowserDir(dirs, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')?.id === 'edge');
check('quark.exe → 夸克数据目录', matchBrowserDir(dirs, 'C:\\Program Files\\Quark\\quark.exe')?.id === 'auto:quark');
check('未知 exe → null（调用方走系统默认/遍历回退）', matchBrowserDir(dirs, 'C:\\x\\unknown.exe') === null);

/* ---- 源码级接线 ---- */
const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
const shell = await read('src/renderer/components/organisms/MainWindowShell.tsx');
const palette = await read('src/renderer/components/organisms/MiniPalette.tsx');
const results = await read('src/renderer/components/organisms/PaletteResults.tsx');
const searchInput = await read('src/renderer/components/atoms/SearchInput.tsx');
const preload = await read('src/preload/index.ts');
const ipc = await read('src/main/ipc.ts');
check('主窗口接 Alt+Enter 与 webSearch', shell.includes('e.key === \'Enter\' && e.altKey') && shell.includes('api.webSearch.run'));
check('快捷窗口接 Alt+Enter 与 webSearch', palette.includes('e.key === \'Enter\' && e.altKey') && palette.includes('webSearch.onRun'));
check('结果区底部行存在且不参与 hits', results.includes('webSearch !== undefined') && results.includes('sticky bottom-0'));
check('搜索框按钮存在', searchInput.includes('onWebSearch'));
check('preload/main 两侧通道齐备', preload.includes("'tl:web-search'") && preload.includes("'tl:web-search-info'") && ipc.includes("'tl:web-search'") && ipc.includes("'tl:web-search-info'"));

console.log('');
console.log(failed === 0 ? '网页搜索门禁：全部通过。' : `网页搜索门禁：${failed} 项失败。`);
process.exit(failed === 0 ? 0 : 1);
