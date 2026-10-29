/**
 * 主窗口全局键位。
 *
 * 键位定义表在 shared/app-hotkeys.ts（默认值 + 标签 + 匹配器）；
 * settings.appHotkeys 的用户覆盖由调用方合并后传入本 hook。
 * 默认键位：
 *   Ctrl+Q / Ctrl+E   循环切换页面（Q 正序：主页 → 团队 → 我的；E 反序）
 *   Ctrl+N            新建入口（跟随当前页）
 *   Ctrl+F            搜索栏开关（已打开则退出；用自定义事件广播，避免把 ref 传进 hook）
 *   F5                立即拉取一次
 *   Ctrl+Space        迷你面板（Electron 下由主进程注册全局热键，这里是窗口内兜底）
 *   Ctrl+Tab          切到快捷面板（Electron 下由主进程把主窗口藏到托盘，真正互换）
 *   Ctrl+,            设置
 *   Ctrl+Shift+E      进入 / 退出管理员编辑态
 *   Ctrl+Enter        有未发布改动时直达发布
 *   Ctrl+B            展开 / 收起侧边栏
 *
 * 匹配用 acceleratorMatches：修饰键精确比对，Ctrl+Shift+E 不会被 Ctrl+E 吞掉。
 * Ctrl+Space 例外：它是全局热键不可用时的窗口内兜底，不走自定义表。
 *
 * K-09：热键注册失败必须显式告知（由调用方弹 Banner），这里只负责窗口内监听。
 */
import { useEffect } from 'react';
import { acceleratorMatches } from '../../shared/app-hotkeys.ts';

export interface GlobalHotkeyHandlers {
  /** Ctrl+Q：正序循环 主页 → 团队 → 我的。 */
  onCycleNext(): void;
  /** Ctrl+E：反序循环 我的 → 团队 → 主页。 */
  onCyclePrev(): void;
  onRefresh(): void;
  onToggleMini(): void;
  /**
   * Ctrl+Tab：主窗口 → 快捷面板（2026-10-21 用户要求「两面互换」）。
   * 面板里的 Ctrl+Tab 走 MiniPalette 自己的处理器（面板 → 主窗口）。
   */
  onSwitchToPalette(): void;
  onOpenSettings(): void;
  onToggleEdit(): void;
  onPublish(): void;
  /** Ctrl+N：新建入口，行为跟随当前页（我的入口=个人入口；团队页=编辑态下的团队入口）。 */
  onNewEntry(): void;
  /** Ctrl+B：展开 / 收起侧边栏（持久化在 settings.sidebarCollapsed）。 */
  onToggleSidebar(): void;
  /**
   * Ctrl+A：全选卡片（两级：先本组、再整页、第三次清空）。
   * **焦点在输入框里时这条键不会被接管**（守卫在下面），输入框的"全选文本"必须保持原生。
   */
  onSelectAll(): void;
  /** Ctrl+/：快捷键速查面板。 */
  onShowShortcuts(): void;
  /** Ctrl+Enter / Ctrl+Shift+E 这类"有条件生效"的键位，由调用方给出当前是否可用 */
  canPublish(): boolean;
  /** 动作 → 加速器（默认表已与 settings.appHotkeys 覆盖合并）。 */
  appHotkeys: Record<string, string>;
}

export function useGlobalHotkeys(h: GlobalHotkeyHandlers): void {
  const {
    onCycleNext, onCyclePrev, onRefresh, onToggleMini, onSwitchToPalette,
    onOpenSettings, onToggleEdit, onPublish, onNewEntry, onToggleSidebar, onShowShortcuts, canPublish, appHotkeys,
    onSelectAll,
  } = h;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* Ctrl+Tab：主窗口 ↔ 快捷面板互换（2026-10-21 用户要求）。
         只在这个窗口有焦点时生效（面板窗口不挂本 hook，它自己处理 Ctrl+Tab）。
         两条守卫：按住不放不连续切换；模态对话框开着时不抢 Tab——那里 Tab 是焦点陷阱，
         抢走会让键盘用户没法在对话框里移动。 */
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'Tab') {
        if (e.repeat) return;
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        e.preventDefault();
        onSwitchToPalette();
        return;
      }
      // Ctrl+Space 是独立的窗口内兜底（OS 级全局热键被占用时仍可唤起），不走自定义表。
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        onToggleMini();
        return;
      }
      // 其余动作全部走自定义表：修饰键精确比对，命中即执行。
      for (const [action, accel] of Object.entries(appHotkeys)) {
        if (!acceleratorMatches(accel, e)) continue;
        switch (action) {
          case 'tabTeam':
            e.preventDefault();
            onCycleNext();
            return;
          case 'tabPersonal':
            e.preventDefault();
            onCyclePrev();
            return;
          case 'newEntry':
            e.preventDefault();
            onNewEntry();
            return;
          case 'focusSearch':
            e.preventDefault();
            window.dispatchEvent(new Event('tl:focus-search'));
            return;
          case 'refresh':
            e.preventDefault();
            onRefresh();
            return;
          case 'settings':
            e.preventDefault();
            onOpenSettings();
            return;
          case 'toggleEdit':
            e.preventDefault();
            onToggleEdit();
            return;
          case 'selectAll': {
            /* 输入框/文本域/可编辑区里的 Ctrl+A 是"全选文本"，必须留给系统。
               其余键位保持既有行为（它们是无歧义的应用命令，且用户已按现状使用）——
               这条守卫只服务 Ctrl+A，见 2026-10-17 的批 4 说明。 */
            const target = e.target as HTMLElement | null;
            if (target && target.closest('input, textarea, [contenteditable="true"]')) return;
            e.preventDefault();
            onSelectAll();
            return;
          }
          case 'publish':
            // 有条件生效：没有未发布改动时放行给其他绑定（通常没有），不做任何事。
            if (!canPublish()) return;
            e.preventDefault();
            onPublish();
            return;
          case 'toggleSidebar':
            e.preventDefault();
            onToggleSidebar();
            return;
          case 'shortcuts':
            e.preventDefault();
            onShowShortcuts();
            return;
          default:
            return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appHotkeys, onCycleNext, onCyclePrev, onRefresh, onToggleMini, onSwitchToPalette, onOpenSettings, onToggleEdit, onPublish, onNewEntry, onToggleSidebar, onShowShortcuts, canPublish]);
}
