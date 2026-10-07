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
        <SheetRow label="全局快捷搜索热键（任何应用里）" keys={settings.hotkey === 'none' ? ['未设置'] : [settings.hotkey]} />
        <SheetRow label="卡片在组内换位（键盘）" keys={['Alt+↑', 'Alt+↓']} />
        <SheetRow label="关闭对话框 / 快捷窗口" keys={['Esc']} />
      </Section>
      <p className="t-2xs mt-1 text-[var(--meta)]">改键在 设置 · 快捷键；这里的展示会跟着你的覆盖值变化。</p>

      <Section title="使用说明">
        <div className="flex flex-col gap-2 t-sm text-[var(--fg-2)]">
          <p>· 复制了网址或程序路径后，在窗口空白处直接按 Ctrl+V，可以快速添加入口。</p>
          <p>· 应用入口打不开（比如换了电脑）：右键卡片选「在本机重新定位…」，在本机重新指一次程序位置，本机会记住。</p>
          <p>· 卡片上没显示程序图标：通常是目标路径在这台电脑上不存在；重新定位后图标会自动恢复。</p>
          <p>· 左下角「工作区」按钮：展开同步状态、手动刷新与诊断入口。</p>
          <p>· 收起侧栏：Ctrl+B 或标题栏左上角的按钮；再按一次恢复。</p>
        </div>
        <p className="t-2xs mt-2 text-[var(--meta)]">更多使用说明持续补充中。</p>
      </Section>
    </Dialog>
  );
}
