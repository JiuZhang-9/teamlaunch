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
  | 'selectAll'
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
  selectAll: 'Ctrl+A',
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
  selectAll: '全选卡片（先本组、再整页、第三次清空）',
  shortcuts: '快捷键速查',
};

/**
 * KeyboardEvent 的主键名 → 加速器里的写法。
 *
 * 为什么必须归一：空格键的 `e.key` 是**一个空格字符** `' '`，直接拼进加速器会得到
 * `'Ctrl+ '`（尾随空格）——Electron 的 globalShortcut 认为它非法，注册静默失败，
 * 而匹配器按 `+` 拆开再 trim 后只剩 `['Ctrl']`，窗口内也永远匹配不上。
 * 结果就是"改成别的键之后再想设回 Ctrl+空格就设不回去了"（2026-10-19 用户报）。
 *
 * **输入法兜底（2026-10-19 第二轮）**：中文输入法占用 Ctrl+空格（中英切换）时，
 * 浏览器可能拿不到正常的 `e.key`——只给 `'Process'` / `'Unidentified'`（keyCode 229）。
 * 这时退回用 `e.code`（物理键位，不受输入法影响）翻译，至少让"录制"这一步能拿到键名；
 * 能不能真的全局注册由系统决定（注册失败会如实报冲突，见 hotkey.ts）。
 */
export function acceleratorKeyName(key: string, code?: string): string {
  if (key === ' ' || key === 'Spacebar' || key === 'Space') return 'Space';
  const unusable = key === '' || key === 'Process' || key === 'Unidentified' || key === 'Dead';
  if (unusable && typeof code === 'string' && code.length > 0) {
    if (code === 'Space') return 'Space';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    if (code === 'Escape') return 'Esc';
    if (code === 'Enter' || code === 'NumpadEnter') return 'Enter';
    if (code === 'Tab') return 'Tab';
    return code;
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

/** 录制器与匹配器共用：把 KeyboardEvent 归一成 `Ctrl+Shift+E` 形态的加速器串。 */
export function acceleratorOf(e: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  code?: string;
}): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(acceleratorKeyName(e.key, e.code));
  return parts.join('+');
}

/**
 * 加速器匹配：修饰键**精确**比对（Ctrl+Shift+E 不会被 Ctrl+E 命中），
 * 主键单字符不区分大小写。空串 = 未绑定，永不匹配。
 */
export function acceleratorMatches(
  accel: string | undefined,
  e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code?: string },
): boolean {
  if (!accel) return false;
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  if (e.ctrlKey !== parts.includes('Ctrl')) return false;
  if (e.altKey !== parts.includes('Alt')) return false;
  if (e.shiftKey !== parts.includes('Shift')) return false;
  /* 两边都过同一个归一（' ' ↔ 'Space' / 输入法的 Process ↔ code）：只归一存起来的那边，
     按空格时照样匹配不上。 */
  return key.toLowerCase() === acceleratorKeyName(e.key, e.code).toLowerCase();
}
