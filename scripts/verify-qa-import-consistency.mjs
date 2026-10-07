#!/usr/bin/env node
/**
 * QA 独立验证 ⑤：导入「预览 vs 提交」一致性（共用 measureImport 的实证）
 *
 * 设计意图：预览与提交必须共用同一个 `measureImport`。分成两处写就会出现
 * "预览说 3 条冲突、实际覆盖了 5 条"——用户事后才发现数据不对，
 * 根本不知道当初预览给错了数，属于最难的那一类静默数据丢失。
 *
 * 只 grep 一眼"两个函数都调用了 measureImport"是不够的：那只能证明它们
 * 引用了同一个符号，证明不了**算出来一样**。所以这里做两件事：
 *   1. 静态：确认两侧的调用点确实指向 shared 那一份（不是各 import 一份副本）；
 *   2. 实证：随机生成 N 组（现有配置 × 导入文件），比较预览给出的
 *      added / overwritten 与提交实际执行的 added / overwritten / skipped / copied。
 *      任一组对不上，就是分叉。
 *
 * 边界（开发者已验过一条，这里换成另一条更难的方向）：
 *   - 文件本身合法、**无冲突**、但"现有 + 导入"合并后超过 200 →
 *     预览会通过（它只看导入文件），只有提交才撞闸。提交必须零写入。
 *   - 导入文件内部有重复 id：total 计数与去重后的处置数必须自洽。
 *
 * 用法：npm run verify:qa-import
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolvePaths } from '../src/repositories/paths.ts';
import { PersonalRepository } from '../src/repositories/personal.repository.ts';
import { PersonalService } from '../src/services/personal.service.ts';
import { measureImport } from '../src/shared/personal-import.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ---------- 静态：两侧的 measureImport 必须来自同一个模块 ---------- */
const src = await readFile(new URL('../src/services/personal.service.ts', import.meta.url), 'utf8');
const callSites = [...src.matchAll(/measureImport\s*\(/g)].length;
const importLine = [...src.matchAll(/import\s*\{[^}]*measureImport[^}]*\}\s*from\s*'([^']+)'/g)].map((m) => m[1]);
check(
  '静态｜previewImport/commitImport 共用同一个 measureImport（2 处调用、1 个来源）',
  callSites === 2 && importLine.length === 1 && importLine[0].includes('shared/personal-import'),
  `调用点=${callSites} 来源=${JSON.stringify(importLine)}`,
);

const root = await mkdtemp(join(tmpdir(), 'tl-qa-import-'));
const service = new PersonalService(new PersonalRepository(resolvePaths(root)));

const entry = (id, name, target) => ({
  id,
  name,
  sort: 0,
  icon: { kind: 'fallback' },
  updatedAt: new Date().toISOString(),
  type: 'folder',
  target: target ?? `D:\\共享\\${name}`,
});
const cfg = (ids) => ({
  schemaVersion: 1,
  groups: [{ id: 'g-1', name: '我的入口', sort: 0, entries: ids.map((id) => entry(id, `N-${id}`)) }],
});

console.log('QA 独立验证 ⑤：导入「预览 vs 提交」一致性');
console.log('');

try {
  /* ---------- 实证：随机对照，预览数 == 提交数 ---------- */
  const policies = ['skip', 'overwrite', 'copy'];
  let mismatch = 0;
  let rounds = 0;
  const rng = (() => {
    let s = 20260930;
    return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  })();

  for (let i = 0; i < 30; i += 1) {
    const existingIds = Array.from({ length: Math.floor(rng() * 5) }, (_, k) => `x${k}`);
    const incomingIds = Array.from({ length: 1 + Math.floor(rng() * 5) }, (_, k) => (rng() < 0.5 ? `x${k}` : `y${k}`));
    const current = cfg(existingIds);
    const incoming = cfg(incomingIds);
    const policy = policies[i % policies.length];

    const preview = measureImport(incoming, current);
    // 每个随机组合都用全新目录，避免上一轮落盘影响下一轮
    const r = await mkdtemp(join(tmpdir(), 'tl-qa-import-r-'));
    const svc = new PersonalService(new PersonalRepository(resolvePaths(r)));
    await svc.save(current);
    const outcome = await svc.commitImport(JSON.stringify(incoming), { policy });
    await rm(r, { recursive: true, force: true });

    if (outcome.kind !== 'applied') {
      mismatch += 1;
      continue;
    }
    rounds += 1;
    const addedOk = outcome.result.added === preview.added;
    const settled = outcome.result.overwritten + outcome.result.skipped + outcome.result.copied;
    const settledOk = settled === preview.conflicts.length;
    if (!addedOk || !settledOk) {
      mismatch += 1;
      if (mismatch <= 3) {
        console.log(`       └ 分叉：existing=${existingIds.join(',')} incoming=${incomingIds.join(',')} policy=${policy}`);
        console.log(`          预览 added=${preview.added} conflicts=${preview.conflicts.length} / 提交 ${JSON.stringify(outcome.result)}`);
      }
    }
  }
  check(
    '实证｜30 组随机组合：预览的 added 与冲突数 == 提交的实际处置数（零分叉）',
    mismatch === 0,
    `有效轮次=${rounds} 分叉=${mismatch}`,
  );

  /* ---------- 边界：导入文件内部有重复 id ---------- */
  const dupIncoming = {
    schemaVersion: 1,
    groups: [{ id: 'g-1', name: '我的入口', sort: 0, entries: [entry('d-1', 'A'), entry('d-1', 'A 重复'), entry('d-2', 'B')] }],
  };
  const dupPreview = measureImport(dupIncoming, cfg([]));
  check(
    '边界｜导入文件内重复 id：total 按条数计（3），冲突/新增按去重后计（2）',
    dupPreview.total === 3 && dupPreview.added === 2 && dupPreview.conflicts.length === 0,
    `total=${dupPreview.total} added=${dupPreview.added} conflicts=${dupPreview.conflicts.length}`,
  );

  /* ---------- 边界：文件合法、无冲突、合并后超限 ---------- */
  const r2 = await mkdtemp(join(tmpdir(), 'tl-qa-import-cap-'));
  try {
    const svc2 = new PersonalService(new PersonalRepository(resolvePaths(r2)));
    await svc2.save(cfg(Array.from({ length: 150 }, (_, k) => `cur-${k}`)));
    const incoming100 = cfg(Array.from({ length: 100 }, (_, k) => `new-${k}`));

    const pv = await svc2.previewImport(JSON.stringify(incoming100), await svc2.load());
    check(
      '边界｜150 + 100：预览通过（文件合法、无冲突、added=100）',
      pv.ok === true && pv.preview.conflicts.length === 0 && pv.preview.added === 100,
      `ok=${pv.ok} added=${pv.ok ? pv.preview.added : '-'} conflicts=${pv.ok ? pv.preview.conflicts.length : '-'}`,
    );

    const file = join(r2, 'config', 'personal.json');
    const before = await readFile(file, 'utf8');
    const commit = await svc2.commitImport(JSON.stringify(incoming100), { policy: 'overwrite' });
    check('边界｜150 + 100：提交被容量闸拦下（kind=error）', commit.kind === 'error', `kind=${commit.kind}`);
    check(
      '边界｜150 + 100：reason 是容量文案（不是"导入失败"）',
      commit.kind === 'error' && /200/.test(commit.reason ?? ''),
      `reason=${JSON.stringify(commit.reason ?? '')}`,
    );
    check('边界｜150 + 100：落盘一个字节都没变', (await readFile(file, 'utf8')) === before);
    const after = JSON.parse(await readFile(file, 'utf8'));
    const total = after.groups.reduce((n, g) => n + g.entries.length, 0);
    check('边界｜150 + 100：现有数据仍是 150 条，且未被塞进空分组', total === 150, `磁盘 ${total} 条`);
  } finally {
    await rm(r2, { recursive: true, force: true });
  }

  /* ---------- 边界：正好合并到 200 ---------- */
  const r3 = await mkdtemp(join(tmpdir(), 'tl-qa-import-cap2-'));
  try {
    const svc3 = new PersonalService(new PersonalRepository(resolvePaths(r3)));
    await svc3.save(cfg(Array.from({ length: 150 }, (_, k) => `cur-${k}`)));
    const incoming50 = cfg(Array.from({ length: 50 }, (_, k) => `new-${k}`));
    const commit = await svc3.commitImport(JSON.stringify(incoming50), { policy: 'overwrite' });
    check(
      '边界｜150 + 50 = 正好 200：放行（≤200，不是 <200）',
      commit.kind === 'applied' && commit.result.added === 50,
      `kind=${commit.kind} added=${commit.kind === 'applied' ? commit.result.added : '-'}`,
    );
  } finally {
    await rm(r3, { recursive: true, force: true });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log('');
console.log(`合计 ${failed === 0 ? '全部通过' : `${failed} 项失败`}。`);
process.exit(failed === 0 ? 0 : 1);
