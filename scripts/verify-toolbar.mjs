#!/usr/bin/env node
/**
 * 工作栏溢出判定门禁（2026-10-27，1.3.0）。
 *
 * 判定本体在 src/shared/toolbar-overflow.ts：给定实测按钮宽度与可用宽度，
 * 决定「能直接显示几个、剩下的进更多」。这里覆盖全部分支，不启动 Electron / React。
 *
 * 用法：node --experimental-transform-types scripts/verify-toolbar.mjs
 */
import { fitItems } from '../src/shared/toolbar-overflow.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const expect = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? '' : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

expect('没有动作：不出现更多', fitItems([], 200, 4, 40), { visibleCount: 0, overflow: false, usedWidth: 0 });

expect(
  '全部放得下：不出现更多',
  fitItems([80, 80], 200, 4, 40),
  { visibleCount: 2, overflow: false, usedWidth: 164 },
);

expect(
  '刚好放得下（含间距）：不出现更多',
  fitItems([80, 80], 164, 4, 40),
  { visibleCount: 2, overflow: false, usedWidth: 164 },
);

expect(
  '放不下：保留放得下的，其余进更多',
  fitItems([80, 80, 80], 200, 4, 40),
  { visibleCount: 1, overflow: true, usedWidth: 124 },
);

expect(
  '可用宽度刚好等于「第一个 + 更多」：显示 1 个 + 更多',
  fitItems([100, 80], 144, 4, 40),
  { visibleCount: 1, overflow: true, usedWidth: 144 },
);

expect(
  '连「更多」都放不下：显示 0 个，仍报更多',
  fitItems([80], 30, 4, 40),
  { visibleCount: 0, overflow: true, usedWidth: 40 },
);

expect(
  '第一个按钮就超预算：显示 0 个 + 更多',
  fitItems([200], 150, 4, 40),
  { visibleCount: 0, overflow: true, usedWidth: 40 },
);

expect(
  '间距参与计算：三个都放得下',
  fitItems([50, 50, 50], 200, 10, 40),
  { visibleCount: 3, overflow: false, usedWidth: 170 },
);

expect(
  '间距参与计算：溢出时只留第一个',
  fitItems([50, 50, 50], 150, 10, 40),
  { visibleCount: 1, overflow: true, usedWidth: 100 },
);

expect(
  '可用宽度为 0：不崩，返回 0 + 更多',
  fitItems([80], 0, 4, 40),
  { visibleCount: 0, overflow: true, usedWidth: 40 },
);

/* 边界：第一个按钮宽度恰好等于预算（budget = available - more - gap） */
expect(
  '第一个按钮恰好等于预算：显示 1 个',
  fitItems([100, 100], 144, 4, 40),
  { visibleCount: 1, overflow: true, usedWidth: 144 },
);

console.log(failed === 0 ? '\nPASS: 工作栏溢出判定全绿' : `\nFAIL: ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
