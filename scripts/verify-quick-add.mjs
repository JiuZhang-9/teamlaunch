#!/usr/bin/env node
/**
 * 快捷添加落点门禁（2026-10-29，1.6.0，用户拍板方案 A）。
 *
 * 判定本体在 src/shared/quick-add.ts：编辑中 → 团队草稿，否则 → 我的入口。
 * 这里覆盖两个分支，并做三条源码级接线断言：
 *   - 粘贴 / 快捷窗口 / 剪贴板候选共用的 workbenchStore 走 quickAddScope；
 *   - 拖拽 onDropFiles 走 quickAddScope，编辑态调用 edit.createEntries；
 *   - 扫描 / 批量 / 导入书签**不**走 quick-add，仍是明确的个人语义（用户要求先不动）。
 *
 * 用法：node --experimental-transform-types scripts/verify-quick-add.mjs
 */
import { readFile } from 'node:fs/promises';
import { quickAddScope } from '../src/shared/quick-add.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

check('未编辑：落「我的入口」', quickAddScope({ editing: false }) === 'personal', quickAddScope({ editing: false }));
check('编辑中：落团队草稿', quickAddScope({ editing: true }) === 'team', quickAddScope({ editing: true }));

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

const workbench = await read('src/renderer/store/workbenchStore.tsx');
check('workbenchStore 的粘贴 / 面板加为入口走 quickAddScope', workbench.includes('quickAddScope({ editing: editingLock })'));

const shell = await read('src/renderer/components/organisms/MainWindowShell.tsx');
check('拖拽落点走 quickAddScope', shell.includes('quickAddScope({ editing })'));
check('拖拽编辑态写入团队草稿', shell.includes('edit.createEntries(inputs, targetGroup ?? undefined)'));

for (const rel of [
  'src/renderer/pages/BatchAddDialogView.tsx',
  'src/renderer/pages/ScanPickerDialogView.tsx',
  'src/renderer/pages/BookmarkImportDialogView.tsx',
]) {
  const text = await read(rel);
  check(`${rel.split('/').pop()} 不参与快捷添加改道（仍是个人语义）`, !text.includes('quickAddScope'));
}

console.log('');
console.log(failed === 0 ? '快捷添加落点门禁：全部通过。' : `快捷添加落点门禁：${failed} 项失败。`);
process.exit(failed === 0 ? 0 : 1);
