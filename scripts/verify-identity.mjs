#!/usr/bin/env node
/**
 * 入口身份色门禁（2026-11-08，方案 B）。
 *
 * 覆盖：同一 id 稳定、范围 1..6、空 id 不抛、不同 id 能分散。
 * 判定本体在 src/shared/identity.ts，不启动 Electron 也能跑。
 */
import { IDENTITY_TONE_COUNT, identityTone } from '../src/shared/identity.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const samples = ['e-notepad', 'e-calc', '团队-wiki', 'p-weekly', 'e-1', 'e-2', ''];
for (const id of samples) {
  const tone = identityTone(id);
  check(`范围 1..${IDENTITY_TONE_COUNT}：${id || '(空 id)'}`, tone >= 1 && tone <= IDENTITY_TONE_COUNT, `tone=${tone}`);
}

check('同一 id 永远同一档', identityTone('e-notepad') === identityTone('e-notepad'));
check('不同 id 至少能分到 3 档', new Set(samples.filter(Boolean).map(identityTone)).size >= 3);

console.log(failed === 0 ? '\nPASS: 入口身份色门禁全绿' : `\nFAIL: ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
