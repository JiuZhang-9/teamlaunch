/**
 * 应用内快捷键的定义表（2026-10-02）。
 *
 *  - `DEFAULT_APP_HOTKEYS` 是内置键位；settings.appHotkeys 只存**覆盖值**，
 *    合并规则 = { ...默认, ...覆盖 }（用户没改过的动作永远跟随内置键位升级）。
 *  - 「全局快捷搜索热键」（settings.hotkey）不在本表内：它是 OS 级全局注册，
 *    与应用内键位是两个域；录制时的冲突检查会跨域提示。
 *  - 加速器格式与录制器一致：`Ctrl+Alt+Shift+主键`，主键单字符大写、特殊键原样（F5/Enter/,）。
 */
export type AppHotkeyAction =
  | 'tabTeam'
  | 'tabPersonal'
  | 'newEntry'
  | 'focusSearch'
  | 'refresh'
  | 'settings'
  | 'toggleEdit'
  | 'publish'
  | 'toggleSidebar'
  | 'shortcuts';

export const DEFAULT_APP_HOTKEYS: Record<AppHotkeyAction, string> = {
  tabTeam: 'Ctrl+Q',
  tabPersonal: 'Ctrl+E',
  newEntry: 'Ctrl+N',
  focusSearch: 'Ctrl+F',
  refresh: 'F5',
  settings: 'Ctrl+,',
  toggleEdit: 'Ctrl+Shift+E',
  publish: 'Ctrl+Enter',
  toggleSidebar: 'Ctrl+B',
  shortcuts: 'Ctrl+/',
};

export const APP_HOTKEY_LABELS: Record<AppHotkeyAction, string> = {
  tabTeam: '切换到团队入口',
  tabPersonal: '切换到我的入口',
  newEntry: '新建入口（跟随当前页）',
  focusSearch: '聚焦搜索栏',
  refresh: '刷新团队入口',
  settings: '打开设置',
  toggleEdit: '进出编辑模式',
  publish: '发布（有未发布改动时）',
  toggleSidebar: '展开或收起侧边栏',
  shortcuts: '快捷键速查',
};

/** 录制器与匹配器共用：把 KeyboardEvent 归一成 `Ctrl+Shift+E` 形态的加速器串。 */
export function acceleratorOf(e: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join('+');
}

/**
 * 加速器匹配：修饰键**精确**比对（Ctrl+Shift+E 不会被 Ctrl+E 命中），
 * 主键单字符不区分大小写。空串 = 未绑定，永不匹配。
 */
export function acceleratorMatches(
  accel: string | undefined,
  e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string },
): boolean {
  if (!accel) return false;
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  if (e.ctrlKey !== parts.includes('Ctrl')) return false;
  if (e.altKey !== parts.includes('Alt')) return false;
  if (e.shiftKey !== parts.includes('Shift')) return false;
  const want = key.length === 1 ? key.toLowerCase() : key;
  const got = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return want === got;
}
