/**
 * 主窗口 / 快捷窗口的可见性状态机（2026-10-27，1.2.0）。
 *
 * 这一版只解决一件事：**两面不允许同时可见**，且 Ctrl+Space 永远先照顾主窗口。
 * 背景（用户 2026-10-27 反馈）：主窗口明明在屏幕上，按 Ctrl+Space 却弹出快捷窗口；
 * 想把 Ctrl+Space 的下一个目标换回主窗口，还得手动关快捷窗口、再关主窗口两步。
 *
 * 定稿语义（用户确认）：
 *  - Ctrl+Tab 负责两面互换，Ctrl+Space 只负责开关「当前可见的那一面」；
 *  - 快捷窗口开着时 Ctrl+Space 只收起快捷窗口（回主窗口用 Ctrl+Tab）；
 *  - 主窗口在屏幕上（有焦点 / 被别的窗口挡住 / 最小化）时，Ctrl+Space 只作用于主窗口；
 *  - 两面都不可见时，Ctrl+Space 打开上次**显示**过的那一面；
 *  - 打开一面时另一面让位：托盘开 → 隐藏；托盘关 → 最小化（保留任务栏入口，藏了也找得回来）。
 *
 * 为什么放在 shared：判定必须能不启动 Electron 就测（scripts/verify-surface.mjs 覆盖全部分支）。
 * windowManager 只负责把真实窗口状态喂进来，再按返回的 plan 执行。
 */

export type Surface = 'main' | 'palette';

export interface SurfaceSnapshot {
  mainExists: boolean;
  /** BrowserWindow.isVisible()。注意：Windows 上最小化的窗口这里仍可能是 true。 */
  mainVisible: boolean;
  mainMinimized: boolean;
  mainFocused: boolean;
  paletteExists: boolean;
  paletteVisible: boolean;
  /** 最后一次「显示」的是哪一面。刻意不是「最后收起」——切换过程中收起的一方不该抢走目标。 */
  activeSurface: Surface;
  trayEnabled: boolean;
}

export type SurfacePlan =
  | { kind: 'noop' }
  | { kind: 'hidePalette' }
  | { kind: 'hideMain'; minimize: boolean }
  | { kind: 'focusMain' }
  | { kind: 'showMain' }
  | { kind: 'showPalette'; hideMain: 'hide' | 'minimize' | 'none' };

export type SurfaceIntent = 'toggle' | 'showMain' | 'showPalette';

/** 主窗口是否真的在屏幕上：最小化不算（Windows 上 isVisible() 对最小化窗口会撒谎）。 */
export function isMainOnScreen(s: SurfaceSnapshot): boolean {
  return s.mainExists && s.mainVisible && !s.mainMinimized;
}

export function planSurface(intent: SurfaceIntent, s: SurfaceSnapshot): SurfacePlan {
  if (intent === 'showMain') {
    return s.mainExists ? { kind: 'showMain' } : { kind: 'noop' };
  }

  if (intent === 'showPalette') {
    if (!s.paletteExists) return { kind: 'noop' };
    /* 只有主窗口真的在屏幕上才需要让位；已经最小化/隐藏的保持原状——
       把「最小化」改成「隐藏」会让用户在任务栏里也找不到它。 */
    return {
      kind: 'showPalette',
      hideMain: isMainOnScreen(s) ? (s.trayEnabled ? 'hide' : 'minimize') : 'none',
    };
  }

  /* ---------- toggle（Ctrl+Space） ---------- */
  // 快捷窗口可见：只收起它（用户定稿：回主窗口走 Ctrl+Tab，不在这里代劳）。
  if (s.paletteVisible) return { kind: 'hidePalette' };

  // 最小化：还原并聚焦（最小化在任务栏里，用户按热键就是要它回来）。
  if (s.mainExists && s.mainMinimized) return { kind: 'focusMain' };

  // 在屏幕上且在最前：收起来。托盘关着时只能最小化，否则藏了没有任何可见入口。
  if (isMainOnScreen(s) && s.mainFocused) return { kind: 'hideMain', minimize: !s.trayEnabled };

  // 在屏幕上但被别的窗口挡住：拉到前台，绝不去开快捷窗口。
  if (isMainOnScreen(s)) return { kind: 'focusMain' };

  /* 两面都不可见：打开上次显示过的那一面（保留 1.1.3 的「刚收起面板就再开面板」手感）。
     主窗口已被销毁（原生关窗的极端情况）时退回快捷窗口。 */
  if (s.activeSurface === 'main') {
    if (s.mainExists) return { kind: 'showMain' };
    return s.paletteExists ? { kind: 'showPalette', hideMain: 'none' } : { kind: 'noop' };
  }
  if (s.paletteExists) return { kind: 'showPalette', hideMain: 'none' };
  return s.mainExists ? { kind: 'showMain' } : { kind: 'noop' };
}
