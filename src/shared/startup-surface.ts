/**
 * 启动时打开哪一面（2026-11-07，用户拍板：手动启动恢复上次关闭的窗口）。
 *
 * 纯判定放 shared：不启动 Electron 也能测（scripts/verify-surface.mjs 覆盖）。
 * 规则：
 *  - 手动启动：恢复上次显示过的那一面；没有记录（首装）→ 快捷搜索栏。
 *  - 开机自启：静默后台，不弹任何窗口。
 *  - 例外：自启 + 托盘关闭 → 没有任何可见入口，退回主窗口，别把应用藏成孤儿。
 */
import type { Surface } from './surface-machine.ts';

export type StartupSurface = 'none' | Surface;

export interface StartupInput {
  autostart: boolean;
  trayEnabled: boolean;
  lastSurface: Surface | null;
}

export function planStartupSurface(input: StartupInput): StartupSurface {
  if (!input.autostart) return input.lastSurface ?? 'palette';
  return input.trayEnabled ? 'none' : 'main';
}
