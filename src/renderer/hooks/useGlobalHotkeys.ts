/**
 * 主窗口全局键位。
 *
 * 键位定义表在 shared/app-hotkeys.ts（默认值 + 标签 + 匹配器）；
 * settings.appHotkeys 的用户覆盖由调用方合并后传入本 hook。
 * 默认键位：
 *   Ctrl+Q / Ctrl+E   切换团队 / 我的入口（不占用数字位，便于将来新增页签）
 *   Ctrl+N            新建入口（跟随当前页）
 *   Ctrl+F            聚焦搜索框（用自定义事件广播，避免把 ref 传进 hook）
 *   F5                立即拉取一次
 *   Ctrl+Space        迷你面板（Electron 下由主进程注册全局热键，这里是窗口内兜底）
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
  onTabTeam(): void;
  onTabPersonal(): void;
  onRefresh(): void;
  onToggleMini(): void;
  onOpenSettings(): void;
  onToggleEdit(): void;
  onPublish(): void;
  /** Ctrl+N：新建入口，行为跟随当前页（我的入口=个人入口；团队页=编辑态下的团队入口）。 */
  onNewEntry(): void;
  /** Ctrl+B：展开 / 收起侧边栏（持久化在 settings.sidebarCollapsed）。 */
  onToggleSidebar(): void;
  /** Ctrl+/：快捷键速查面板。 */
  onShowShortcuts(): void;
  /** Ctrl+Enter / Ctrl+Shift+E 这类"有条件生效"的键位，由调用方给出当前是否可用 */
  canPublish(): boolean;
  /** 动作 → 加速器（默认表已与 settings.appHotkeys 覆盖合并）。 */
  appHotkeys: Record<string, string>;
}

export function useGlobalHotkeys(h: GlobalHotkeyHandlers): void {
  const {
    onTabTeam, onTabPersonal, onRefresh, onToggleMini,
    onOpenSettings, onToggleEdit, onPublish, onNewEntry, onToggleSidebar, onShowShortcuts, canPublish, appHotkeys,
  } = h;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
            onTabTeam();
            return;
          case 'tabPersonal':
            e.preventDefault();
            onTabPersonal();
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
  }, [appHotkeys, onTabTeam, onTabPersonal, onRefresh, onToggleMini, onOpenSettings, onToggleEdit, onPublish, onNewEntry, onToggleSidebar, onShowShortcuts, canPublish]);
}
