#!/usr/bin/env node
/**
 * 本机程序索引门禁（2026-10-24）
 *
 * 三块，全部是"不启动 Electron 也能测"的部分：
 *  1. 扫描核心：假目录树 → 只收开始菜单 .lnk、去重（target+args）、过滤噪声/自启目录/自己；
 *  2. 拼音与打分：中文全拼/首字母、英文单词首字母、名称/目标文件名命中；
 *  3. 静态接线：启动路径真的调用了 startProgramIndex（K-13 的教训：实现了不等于接线了）。
 *
 * 用法：node --experimental-transform-types scripts/verify-programs.mjs
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { scanProgramRecords } from '../src/main/programScan.ts';
import { pinyinKeys } from '../src/main/programPinyin.ts';
import { scoreProgram, normalizeSearchText } from '../src/shared/program-match.ts';
import {
  isNoiseProgramName,
  isNoiseProgramTarget,
  normalizeProgramPath,
  programDedupeKey,
} from '../src/shared/program-filter.ts';
import { ProgramItemSchema } from '../src/shared/schema/programs.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ------------------------------------------------------------------ *
 * 1. 扫描核心
 * ------------------------------------------------------------------ */
const ROOT_A = 'C:\\StartMenuCommon';
const ROOT_B = 'C:\\StartMenuUser';

const tree = new Map([
  [
    ROOT_A,
    [
      { name: 'Alpha.lnk', isDirectory: false },
      { name: 'Beta.lnk', isDirectory: false },
      { name: 'DuplicateName.lnk', isDirectory: false },
      { name: 'Alpha其他参数.lnk', isDirectory: false },
      { name: '卸载 Alpha.lnk', isDirectory: false },
      { name: 'Setup.lnk', isDirectory: false },
      { name: '帮助.lnk', isDirectory: false },
      { name: 'Folder', isDirectory: true },
      { name: '启动', isDirectory: true },
      { name: 'ExcludedSelf.lnk', isDirectory: false },
    ],
  ],
  [
    join(ROOT_A, 'Folder'),
    [{ name: 'Inner.lnk', isDirectory: false }],
  ],
  [
    join(ROOT_A, '启动'),
    [{ name: 'AutoStart.lnk', isDirectory: false }],
  ],
]);

const links = new Map([
  [join(ROOT_A, 'Alpha.lnk'), { target: 'C:\\Apps\\alpha.exe', args: '', cwd: 'C:\\Apps' }],
  [join(ROOT_A, 'Beta.lnk'), { target: 'C:\\Apps\\beta.exe', args: '--profile work', cwd: 'C:\\Apps' }],
  [join(ROOT_A, 'DuplicateName.lnk'), { target: 'C:\\Apps\\alpha.exe', args: '' }],
  [join(ROOT_A, 'Alpha其他参数.lnk'), { target: 'C:\\Apps\\alpha.exe', args: '--safe' }],
  [join(ROOT_A, '卸载 Alpha.lnk'), { target: 'C:\\Apps\\unins000.exe', args: '' }],
  [join(ROOT_A, 'Setup.lnk'), { target: 'C:\\Apps\\setup.exe', args: '' }],
  [join(ROOT_A, '帮助.lnk'), { target: 'C:\\Apps\\help.chm', args: '' }],
  [join(ROOT_A, 'Folder', 'Inner.lnk'), { target: 'C:\\Apps\\gamma.exe', args: '' }],
  [join(ROOT_A, '启动', 'AutoStart.lnk'), { target: 'C:\\Apps\\autostart.exe', args: '' }],
  [join(ROOT_A, 'ExcludedSelf.lnk'), { target: 'C:\\Apps\\TeamLaunch.exe', args: '' }],
]);

const scan = await scanProgramRecords({
  roots: [
    { dir: ROOT_A, source: '开始菜单' },
    { dir: ROOT_B, source: '开始菜单' },
  ],
  listDir: async (dir) => {
    const entries = tree.get(dir);
    if (!entries) throw new Error('ENOENT');
    return entries;
  },
  readShortcut: (p) => links.get(p) ?? null,
  excludeTargets: new Set([normalizeProgramPath('C:\\Apps\\TeamLaunch.exe')]),
  yieldEvery: 2,
  yieldFn: async () => {},
});

const names = scan.records.map((r) => r.name);
check('读到 1 个根（另一个不存在不报错）', scan.rootsRead === 1, `rootsRead=${scan.rootsRead}`);
check(
  '收集正确的程序（去重 / 保留不同参数 / 进子目录）',
  names.length === 4 && names.includes('Alpha') && names.includes('Beta') && names.includes('Alpha其他参数') && names.includes('Inner'),
  names.join(' | '),
);
check('同名目标 + 同参数只保留第一条', names.filter((n) => n === 'Alpha').length === 1);
check(
  '保留快捷方式参数与工作目录',
  scan.records.find((r) => r.name === 'Beta')?.args === '--profile work' &&
    scan.records.find((r) => r.name === 'Beta')?.cwd === 'C:\\Apps',
);
check('过滤卸载/安装器/非 exe/自启目录/自己', !names.some((n) => /卸载|Setup|帮助|AutoStart|ExcludedSelf/.test(n)));
check('记录保留 sourcePath（原始 .lnk）', scan.records.every((r) => /\.lnk$/i.test(r.sourcePath)));

/* ------------------------------------------------------------------ *
 * 2. 拼音与打分
 * ------------------------------------------------------------------ */
const wx = { name: '微信', target: 'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe', ...pinyinKeys('微信') };
const chrome = { name: 'Google Chrome', target: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ...pinyinKeys('Google Chrome') };
const qq = { name: 'QQ音乐', target: 'C:\\Apps\\qqmusic.exe', ...pinyinKeys('QQ音乐') };
const nv = { name: '女装店', target: 'C:\\Apps\\shop.exe', ...pinyinKeys('女装店') };

check('微信 → weixin / wx', wx.py === 'weixin' && wx.pyInit === 'wx', `${wx.py}/${wx.pyInit}`);
check('Google Chrome → googlechrome / gc', chrome.py === 'googlechrome' && chrome.pyInit === 'gc', `${chrome.py}/${chrome.pyInit}`);
check('QQ音乐 → qqyinyue / qyy', qq.py === 'qqyinyue' && qq.pyInit === 'qyy', `${qq.py}/${qq.pyInit}`);
check('ü 归一成 v（女装店 → nvzhuangdian / nzd）', nv.py === 'nvzhuangdian' && nv.pyInit === 'nzd', `${nv.py}/${nv.pyInit}`);
check('ü 查询（nv）命中', scoreProgram(nv, 'nv') >= 70, `score=${scoreProgram(nv, 'nv')}`);

check('首字母搜索命中（wx）', scoreProgram(wx, 'wx') >= 80, `score=${scoreProgram(wx, 'wx')}`);
check('全拼搜索命中（weixin）', scoreProgram(wx, 'weixin') >= 80, `score=${scoreProgram(wx, 'weixin')}`);
check('汉字搜索命中（微信）', scoreProgram(wx, '微信') >= 70, `score=${scoreProgram(wx, '微信')}`);
check('拼音前缀命中（weix）', scoreProgram(wx, 'weix') >= 70, `score=${scoreProgram(wx, 'weix')}`);
check('英文名称包含命中（chrome）', scoreProgram(chrome, 'chrome') >= 70, `score=${scoreProgram(chrome, 'chrome')}`);
check('英文首字母完全一致优先（gc）', scoreProgram(chrome, 'gc') >= 80, `score=${scoreProgram(chrome, 'gc')}`);
check('无关查询不命中', scoreProgram(wx, 'zzzz') === 0);
check('归一化去空格/分隔符', normalizeSearchText('Visual Studio-Code') === 'visualstudiocode');

/* ------------------------------------------------------------------ *
 * 3. 噪声 / 去重键 / schema 上限
 * ------------------------------------------------------------------ */
check('名称噪声：卸载 / 版本号 / 位数', ['卸载 Foo', '1.4.0', '(x64)', 'uninstall'].every(isNoiseProgramName));
check('名称不误伤：Visual Studio Code', !isNoiseProgramName('Visual Studio Code'));
check('目标噪声：unins000 / setup / 更新器', ['C:\\X\\unins000.exe', 'C:\\X\\setup.exe', 'C:\\X\\Updater.exe'].every(isNoiseProgramTarget));
check('目标不误伤：Code.exe', !isNoiseProgramTarget('C:\\Apps\\Code.exe'));
check(
  '路径归一（斜杠/大小写）',
  normalizeProgramPath('C:/Program Files/X/A.EXE') === 'c:\\program files\\x\\a.exe',
);
check(
  '去重键区分参数',
  programDedupeKey('C:\\Apps\\alpha.exe', '') !== programDedupeKey('C:\\Apps\\alpha.exe', '--safe'),
);
const baseItem = {
  id: 'sys-test', name: 'A'.repeat(40), target: 'C:\\Apps\\a.exe', sourcePath: 'C:\\Start\\A.lnk',
  args: '', cwd: '', source: '开始菜单', py: 'a', pyInit: 'a',
};
check('程序名 40 字可合成合法 Entry', ProgramItemSchema.safeParse(baseItem).success);
check(
  '程序名超过 40 字必须被 schema 拒绝（合成 Entry 会整条失效）',
  !ProgramItemSchema.safeParse({ ...baseItem, name: 'A'.repeat(41) }).success,
);

/* ------------------------------------------------------------------ *
 * 4. 静态接线（K-13：实现 ≠ 接线）
 * ------------------------------------------------------------------ */
const [mainSrc, windowSrc, hotkeySrc] = await Promise.all([
  readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/windowManager.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/hotkey.ts', import.meta.url), 'utf8'),
]);
check('启动路径调用 startProgramIndex', /startProgramIndex\(/.test(mainSrc));
check('快捷窗口打开时检查索引 TTL', /ensureProgramsFresh\(\)/.test(windowSrc));
check('程序搜索热键接到 handleHotkeySearch', /handleHotkeySearch/.test(hotkeySrc) && /'search'/.test(hotkeySrc));

// 供将来扩展：避免未使用 import 被 lint 报错（pathToFileURL 目前无用）
console.log(failed === 0 ? '\nPASS: 本机程序索引门禁全绿' : `\nFAIL: ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
