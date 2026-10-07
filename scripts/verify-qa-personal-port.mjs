#!/usr/bin/env node
/**
 * QA 独立验证 ④：personalPort 真机执行（mock 掉 electron，让"从未被执行过"的代码跑起来）
 *
 * 背景：开发者诚实交代 `src/main/personalPort.ts` 是全项目唯一一层
 * "逻辑成立但从未被执行过"的代码——它 import electron，smoke 拉不起来，
 * 只过了类型检查与代码审阅。其中 `AppError(ERR_PAYLOAD_TOO_LARGE) → ok:false`
 * 那一段是容量闸**唯一**的界面出口：它错了，用户看到的就是一句"保存失败"。
 * "类型检查通过"不等于"这段代码是对的"，所以这里把它真跑一遍。
 *
 * 手法：用 node:module 的 resolve 钩子把 `electron` 解析到一个临时生成的桩上，
 * 只提供 personalPort 实际用到的 `app.getPath('userData')`。不改动任何产品代码，
 * 也不把桩文件留在仓库里。
 *
 * 重点验的三件事（都是"断言太弱就抓不到"的那类）：
 *   1. 容量闸被撞时，reason 必须是**带数字的容量文案**，不是"保存失败"；
 *   2. 撞闸时磁盘**一个字节都不写**（用文件是否存在 + 内容比对双重确认）；
 *   3. IPC 入参一律当不可信：`decisions` 畸形时必须回落到 ask（不覆盖的那一边）。
 *
 * 用法：npm run verify:qa-personal
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

/* ---------------- electron 桩：只提供 personalPort 真正用到的那一个方法 ---------------- */

const root = await mkdtemp(join(tmpdir(), 'tl-qa-personal-'));
const stubDir = await mkdtemp(join(tmpdir(), 'tl-qa-stub-'));
const stubFile = join(stubDir, 'electron-stub.mjs');
await writeFile(
  stubFile,
  `const dir = ${JSON.stringify(root)};\n` +
  "export const app = { getPath: (name) => (name === 'userData' ? dir : dir) };\n" +
  "export const contextBridge = { exposeInMainWorld() {} };\n" +
  "export const ipcRenderer = { invoke: async () => null, on() {}, removeListener() {} };\n" +
  "export const ipcMain = { handle() {} };\n" +
  "export const clipboard = { writeText() {} };\n" +
  "export const shell = { showItemInFolder() {}, openPath: async () => '' };\n" +
  "export const dialog = { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true }) };\n",
  'utf8',
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
      return { url: pathToFileURL(stubFile).href, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { commitPersonalImport, previewPersonalImport, savePersonal } = await import(
  '../src/main/personalPort.ts'
);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const note = (s) => console.log(`       └ ${s}`);

const PERSONAL_FILE = join(root, 'config', 'personal.json');
const entry = (id, name) => ({
  id,
  name,
  sort: 0,
  icon: { kind: 'fallback' },
  updatedAt: new Date().toISOString(),
  type: 'folder',
  target: `D:\\共享\\${name}`,
});
const configOf = (n, groupId = 'g-1') => ({
  schemaVersion: 1,
  groups: [
    {
      id: groupId,
      name: '我的入口',
      sort: 0,
      entries: Array.from({ length: n }, (_, k) => entry(`e-${k}`, `入口${k}`)),
    },
  ],
});

const readPersonal = async () => {
  try {
    return JSON.parse(await readFile(PERSONAL_FILE, 'utf8'));
  } catch {
    return null;
  }
};
const countOnDisk = async () => {
  const c = await readPersonal();
  return c === null ? 0 : c.groups.reduce((n, g) => n + g.entries.length, 0);
};

console.log('QA 独立验证 ④：personalPort 真机执行（electron 已 mock）');
console.log(`  存储根：${root}`);
console.log('');

try {
  /* ========== 1. 正常保存 ========== */
  const ok = await savePersonal(configOf(3));
  check('1｜合法配置保存成功并回带规范配置', ok.ok === true && ok.config?.groups?.[0]?.entries?.length === 3, `ok=${ok.ok}`);
  check('1｜落盘内容与回带值一致', (await countOnDisk()) === 3, `磁盘 ${await countOnDisk()} 条`);

  /* ========== 2. 容量闸：200 / 201 边界两侧 ========== */
  const at200 = await savePersonal(configOf(200));
  check('2｜正好 200 条 → 放行', at200.ok === true, `ok=${at200.ok} reason=${at200.ok ? '-' : at200.reason}`);

  const before201 = await readFile(PERSONAL_FILE, 'utf8');
  const at201 = await savePersonal(configOf(201));
  check('2｜201 条 → 被拦（ok=false）', at201.ok === false, `ok=${at201.ok}`);
  check(
    '2｜201 条的 reason 是带数字的容量文案，不是"保存失败"（personalPort.ts:97 分支真被执行）',
    at201.ok === false && /200/.test(at201.reason ?? '') && /入口/.test(at201.reason ?? ''),
    `reason=${JSON.stringify(at201.reason ?? '')}`,
  );
  if (at201.ok === false && !/200/.test(at201.reason ?? '')) {
    note('这条 reason 里没有上限数字 → AppError→ok:false 的转换退化成了通用文案，');
    note('用户会看到"保存失败"却不知道是撞了上限。');
  }
  check('2｜201 条被拦后磁盘一个字节都没变', (await readFile(PERSONAL_FILE, 'utf8')) === before201);

  /* ========== 3. schema 校验：details 必须带字段路径 ========== */
  const bad = await savePersonal({ groups: [{ id: 'g', name: '', sort: 'x', entries: 'nope' }] });
  check('3｜schema 不过 → ok=false 且带 details', bad.ok === false && Array.isArray(bad.details) && bad.details.length > 0, `details=${JSON.stringify(bad.details ?? null).slice(0, 120)}`);
  check('3｜details 含字段路径（形如 groups.0.name）', bad.ok === false && (bad.details ?? []).some((d) => /groups/.test(d)), `details=${JSON.stringify(bad.details ?? []).slice(0, 120)}`);

  /* ========== 4. 不可信 IPC 入参 ========== */
  const nullish = await savePersonal(null);
  check('4｜savePersonal(null) → ok=false（不抛 rejection）', nullish.ok === false, `ok=${nullish.ok}`);
  const str = await savePersonal('{"groups":[]}');
  check('4｜savePersonal(字符串) → ok=false', str.ok === false, `ok=${str.ok}`);

  /* ========== 5. 导入：decisions 畸形必须回落到 ask（不覆盖的那一边） ========== */
  await savePersonal(configOf(1, 'g-1'));
  const importText = JSON.stringify(configOf(1, 'g-1')); // 与现有 e-0 同 id → 必然冲突
  const preview = await previewPersonalImport({ text: importText, current: { schemaVersion: 1, groups: [] } });
  check('5｜预览识别出 1 条 id 冲突', preview.ok === true && preview.preview.conflicts.length === 1, `conflicts=${preview.ok ? preview.preview.conflicts.length : '-'}`);

  const beforeMalformed = await readFile(PERSONAL_FILE, 'utf8');
  const malformed = await commitPersonalImport({ text: importText, decisions: 'overwrite' });
  check(
    '5｜decisions 是字符串（畸形）→ 回落 ask → needs-decision，绝不静默覆盖（AC-15）',
    malformed.kind === 'needs-decision',
    `kind=${malformed.kind}`,
  );
  check('5｜needs-decision 期间磁盘未改动', (await readFile(PERSONAL_FILE, 'utf8')) === beforeMalformed);

  const malformed2 = await commitPersonalImport({ text: importText, decisions: { policy: 'OVERWRITE' } });
  check('5｜policy 大小写不符（不在白名单）→ 同样回落 ask', malformed2.kind === 'needs-decision', `kind=${malformed2.kind}`);

  const malformed3 = await commitPersonalImport({ text: importText, decisions: { policy: 'copy', perEntry: { 'e-0': 'delete-everything' } } });
  check('5｜perEntry 里的未知动作被丢弃（不落到覆盖）', malformed3.kind === 'applied' && malformed3.result.overwritten === 0, `kind=${malformed3.kind} result=${JSON.stringify(malformed3.result ?? null)}`);

  /* ========== 6. text 缺失 → 明确原因 + 零写入 ========== */
  const beforeEmpty = await readFile(PERSONAL_FILE, 'utf8');
  const noText = await commitPersonalImport({ decisions: { policy: 'overwrite' } });
  check('6｜缺 text → kind=error 且原因可展示', noText.kind === 'error' && typeof noText.reason === 'string' && noText.reason.length > 0, `reason=${noText.reason}`);
  check('6｜缺 text 时磁盘零改动', (await readFile(PERSONAL_FILE, 'utf8')) === beforeEmpty);
  const badType = await commitPersonalImport({ text: 12345 });
  check('6｜text 不是字符串 → kind=error', badType.kind === 'error', `kind=${badType.kind}`);

  /* ========== 7. 预览只读磁盘，不采信调用方带来的 current ========== */
  // current 故意给一份"与磁盘完全不同"的：预览若采信它，冲突数就会算错。
  const stale = { schemaVersion: 1, groups: [{ id: 'g-x', name: 'x', sort: 0, entries: [] }] };
  const p2 = await previewPersonalImport({ text: importText, current: stale });
  const p3 = await previewPersonalImport({ text: importText, current: { schemaVersion: 1, groups: [{ id: 'g-1', name: '我的入口', sort: 0, entries: [entry('e-0', '入口0'), entry('e-99', '入口99')] }] } });
  check(
    '7｜预览无视调用方传入的 current，两次不同 current 得到同一份冲突判定（真值只有磁盘）',
    p2.ok === true && p3.ok === true && p2.preview.conflicts.length === p3.preview.conflicts.length,
    `stale=${p2.ok ? p2.preview.conflicts.length : '-'} vs rich=${p3.ok ? p3.preview.conflicts.length : '-'}`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(stubDir, { recursive: true, force: true });
}

console.log('');
console.log(`合计 ${failed === 0 ? '全部通过' : `${failed} 项失败`}。`);
process.exit(failed === 0 ? 0 : 1);
