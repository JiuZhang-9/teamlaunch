#!/usr/bin/env node
/**
 * 窗口可见性状态机门禁（2026-10-27，1.2.0）。
 *
 * 覆盖 Ctrl+Space 的全部分支：快捷窗口可见、主窗口有焦点 / 被挡住 / 最小化、
 * 两面都藏、托盘开 / 关、主窗口已销毁。判定本体在 src/shared/surface-machine.ts，
 * 不启动 Electron 也能跑——这正是把它放进 shared 的原因。
 *
 * 用法：node --experimental-transform-types scripts/verify-surface.mjs
 */
import { isMainOnScreen, planSurface } from '../src/shared/surface-machine.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const base = {
  mainExists: true,
  mainVisible: true,
  mainMinimized: false,
  mainFocused: false,
  paletteExists: true,
  paletteVisible: false,
  activeSurface: 'main',
  trayEnabled: true,
};

const snap = (over = {}) => ({ ...base, ...over });
const expectPlan = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? '' : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
};

/* ------------------------------------------------------------------ *
 * 1. 「在屏幕上」的判定：最小化不算
 * ------------------------------------------------------------------ */
check('可见且未最小化 → 在屏幕上', isMainOnScreen(snap()) === true);
check('最小化 → 不在屏幕上（Windows 的 isVisible 会撒谎）', isMainOnScreen(snap({ mainMinimized: true })) === false);
check('隐藏 → 不在屏幕上', isMainOnScreen(snap({ mainVisible: false })) === false);
check('已销毁 → 不在屏幕上', isMainOnScreen(snap({ mainExists: false, mainVisible: false })) === false);

/* ------------------------------------------------------------------ *
 * 2. Ctrl+Space（toggle）
 * ------------------------------------------------------------------ */
expectPlan(
  '快捷窗口可见：只收快捷窗口（即使主窗口也在屏幕上）',
  planSurface('toggle', snap({ paletteVisible: true })),
  { kind: 'hidePalette' },
);

expectPlan(
  '主窗口在最前 + 托盘开：收进托盘',
  planSurface('toggle', snap({ mainFocused: true, trayEnabled: true })),
  { kind: 'hideMain', minimize: false },
);

expectPlan(
  '主窗口在最前 + 托盘关：只能最小化',
  planSurface('toggle', snap({ mainFocused: true, trayEnabled: false })),
  { kind: 'hideMain', minimize: true },
);

expectPlan(
  '主窗口被别的窗口挡住：拉到前台，绝不开快捷窗口',
  planSurface('toggle', snap({ mainFocused: false })),
  { kind: 'focusMain' },
);

expectPlan(
  '主窗口最小化：还原并聚焦',
  planSurface('toggle', snap({ mainMinimized: true, mainFocused: false })),
  { kind: 'focusMain' },
);

expectPlan(
  '两面都藏 + 上次是主窗口：打开主窗口',
  planSurface('toggle', snap({ mainVisible: false, activeSurface: 'main' })),
  { kind: 'showMain' },
);

expectPlan(
  '两面都藏 + 上次是快捷窗口：打开快捷窗口',
  planSurface('toggle', snap({ mainVisible: false, activeSurface: 'palette' })),
  { kind: 'showPalette', hideMain: 'none' },
);

expectPlan(
  '主窗口已销毁 + 快捷窗口可用：退回快捷窗口',
  planSurface('toggle', snap({ mainExists: false, mainVisible: false, activeSurface: 'main' })),
  { kind: 'showPalette', hideMain: 'none' },
);

expectPlan(
  '两面都已销毁：不动作（不抛错）',
  planSurface('toggle', snap({ mainExists: false, mainVisible: false, paletteExists: false })),
  { kind: 'noop' },
);

/* ------------------------------------------------------------------ *
 * 3. 显式打开主窗口 / 快捷窗口（托盘、通知、Ctrl+Tab、Ctrl+Alt+F）
 * ------------------------------------------------------------------ */
expectPlan('显式打开主窗口：执行 showMain', planSurface('showMain', snap()), { kind: 'showMain' });
expectPlan('主窗口已销毁：显式打开不动作', planSurface('showMain', snap({ mainExists: false })), { kind: 'noop' });

expectPlan(
  '打开快捷窗口 + 主窗口在屏幕上 + 托盘开：主窗口隐藏',
  planSurface('showPalette', snap({ trayEnabled: true })),
  { kind: 'showPalette', hideMain: 'hide' },
);

expectPlan(
  '打开快捷窗口 + 主窗口在屏幕上 + 托盘关：主窗口最小化',
  planSurface('showPalette', snap({ trayEnabled: false })),
  { kind: 'showPalette', hideMain: 'minimize' },
);

expectPlan(
  '打开快捷窗口 + 主窗口已最小化：不动主窗口（任务栏入口保留）',
  planSurface('showPalette', snap({ mainMinimized: true })),
  { kind: 'showPalette', hideMain: 'none' },
);

expectPlan(
  '打开快捷窗口但窗口不存在：不动作（由调用方预热）',
  planSurface('showPalette', snap({ paletteExists: false })),
  { kind: 'noop' },
);

/* ------------------------------------------------------------------ *
 * 4. 互斥不变量：任何「打开一面」的计划都必须处理另一面
 * ------------------------------------------------------------------ */
const showPalettePlans = [
  planSurface('showPalette', snap({ trayEnabled: true })),
  planSurface('showPalette', snap({ trayEnabled: false })),
  planSurface('toggle', snap({ mainVisible: false, activeSurface: 'palette' })),
];
check(
  '打开快捷窗口的计划都带 hideMain 字段（互斥不靠调用方自觉）',
  showPalettePlans.every((p) => p.kind !== 'showPalette' || 'hideMain' in p),
);

console.log(failed === 0 ? '\nPASS: 窗口状态机门禁全绿' : `\nFAIL: ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
