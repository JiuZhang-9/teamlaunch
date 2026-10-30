/**
 * HelpDialog —— 帮助中心（标题栏 ? 按钮 与 Ctrl+/ 共用，用户定稿 2026-10-05）。
 *
 * 结构：快捷键速查（数据与设置·快捷键页同源，改键自动跟随）+ 使用说明（可持续补充的章节）。
 * Ctrl+/ 直达本对话框；标题栏 ？ 按钮（圆形）也从这里进。
 */
import { useMemo } from 'react';
import { Dialog } from './Dialog.tsx';
import { APP_HOTKEY_LABELS, DEFAULT_APP_HOTKEYS, type AppHotkeyAction } from '../../../shared/app-hotkeys.ts';
import { useSettings } from '../../store/settingsStore.tsx';
import type { ReactNode } from 'react';

function Kbd({ children }: { children: string }) {
  return (
    <span className="t-xs t-mono shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-2)] px-1.5 py-0.5 text-[var(--fg-2)]">
      {children}
    </span>
  );
}

function SheetRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 py-1">
      <span className="t-sm min-w-0 truncate-1 text-[var(--fg)]">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="t-xs w-emph mb-1 text-[var(--muted)]">{title}</p>
      {children}
    </div>
  );
}

export function HelpDialog({ onClose }: { onClose(): void }) {
  const { settings } = useSettings();
  const effective = useMemo(() => ({ ...DEFAULT_APP_HOTKEYS, ...settings.appHotkeys }), [settings.appHotkeys]);
  const keyOf = (id: AppHotkeyAction): string[] => {
    const accel = effective[id];
    return accel && accel.trim().length > 0 ? [accel] : ['未绑定'];
  };

  return (
    <Dialog title="帮助" width="normal" onClose={onClose}>
      <Section title="页面与入口">
        <SheetRow label={APP_HOTKEY_LABELS.tabTeam} keys={keyOf('tabTeam')} />
        <SheetRow label={APP_HOTKEY_LABELS.tabPersonal} keys={keyOf('tabPersonal')} />
        <SheetRow label={APP_HOTKEY_LABELS.newEntry} keys={keyOf('newEntry')} />
        <SheetRow label={APP_HOTKEY_LABELS.focusSearch} keys={keyOf('focusSearch')} />
        <SheetRow label={APP_HOTKEY_LABELS.refresh} keys={keyOf('refresh')} />
        <SheetRow label="粘贴快捷添加（焦点不在输入框时）" keys={['Ctrl+V']} />
      </Section>
      <Section title="界面">
        <SheetRow label={APP_HOTKEY_LABELS.settings} keys={keyOf('settings')} />
        <SheetRow label={APP_HOTKEY_LABELS.toggleSidebar} keys={keyOf('toggleSidebar')} />
        <SheetRow label={APP_HOTKEY_LABELS.shortcuts} keys={keyOf('shortcuts')} />
      </Section>
      <Section title="编辑与发布（管理员）">
        <SheetRow label={APP_HOTKEY_LABELS.toggleEdit} keys={keyOf('toggleEdit')} />
        <SheetRow label={APP_HOTKEY_LABELS.publish} keys={keyOf('publish')} />
      </Section>
      <Section title="全局">
        <SheetRow label="全局唤醒热键（任何应用里：开 / 收当前那个窗口）" keys={settings.hotkey === 'none' ? ['未设置'] : [settings.hotkey]} />
        <SheetRow label="本机程序搜索热键（任何应用里：搜开始菜单程序）" keys={settings.searchHotkey === 'none' ? ['未设置'] : [settings.searchHotkey]} />
        <SheetRow label="主窗口 ↔ 快捷窗口互换" keys={['Ctrl+Tab']} />
        <SheetRow label="卡片在组内换位（键盘）" keys={['Alt+↑', 'Alt+↓']} />
        <SheetRow label="关闭对话框 / 快捷窗口" keys={['Esc']} />
      </Section>
      <p className="t-2xs mt-1 text-[var(--meta)]">改键在 设置 · 快捷键；这里的展示会跟着你的覆盖值变化。</p>

      <Section title="使用说明">
        <div className="flex flex-col gap-2 t-sm text-[var(--fg-2)]">
          <p>· 复制了网址或程序路径后，在窗口空白处直接按 Ctrl+V，可以快速添加入口。</p>
          <p>· 快捷搜索面板（全局热键唤起）里：↑↓ 或 Tab / Shift+Tab 换选中项，⏎ / 空格 直接打开；Ctrl+Tab 直接换回主窗口（在主窗口按则换回面板）；复制了网址或路径后唤起面板，顶部会出现一行候选，⏎ / 空格 直接打开、Ctrl+⏎ 加为入口。</p>
          <p>· 面板里输入程序名会同时搜「开始菜单」里的程序（不用先加为入口）：⏎ / 空格 直接启动，Ctrl+⏎ 或行尾「+」加为入口。Ctrl+Alt+F 可以直接打开程序搜索；没有快捷方式的软件不会出现在这里，可以手动添加。</p>
          <p>· 主窗口搜索框（Ctrl+F 开关）：点一下或按 Ctrl+F 且还没输入时，会先显示剪贴板候选、收藏和最近打开；输入后同样能搜本机程序。↑↓←→ / Tab 选择，⏎ / 空格 打开，Ctrl+⏎ 或行尾「+」加为入口。再按 Ctrl+F、点顶栏 / 侧栏等搜索框以外的地方或按 Esc 可退出搜索；搜索框前的小房子回主页，搜索框后的按钮在 团队入口 / 我的入口 之间一键切换，Ctrl+E / Ctrl+Q 正 / 反循环切页。</p>
          <p>· 应用入口打不开（比如换了电脑）：右键卡片选「在本机重新定位…」，在本机重新指一次程序位置，本机会记住。</p>
          <p>· 卡片上没显示程序图标：通常是目标路径在这台电脑上不存在；重新定位后图标会自动恢复。</p>
          <p>· 左下角「工作区」按钮：展开页面操作（新建 / 批量添加 / 导入 / 导出）、同步状态、手动刷新与诊断入口。</p>
          <p>· 侧栏收起时不用先展开：搜索栏同行的工作栏里放着同一套操作；放不下的会收进最右侧「更多」。</p>
          <p>· 收起侧栏：Ctrl+B 或标题栏左上角的按钮；再按一次恢复。</p>
        </div>
        <p className="t-2xs mt-2 text-[var(--meta)]">更多使用说明持续补充中。</p>
      </Section>
    </Dialog>
  );
}
