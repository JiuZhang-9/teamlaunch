/**
 * ThemePicker —— 明暗主题三选一（浅色 / 深色 / 跟随系统）。
 *
 * 同一个控件同时服务于 设置·通用 与 工作区小窗（2026-10-18 用户要求小窗里也能切主题）：
 * 一处定义选项表，两处渲染同一套东西——"同功能同 UI"是这个项目的硬规矩。
 */
import { MonitorCog, Moon, Sun } from 'lucide-react';
import { Segmented } from './Segmented.tsx';
import type { Settings } from '../../../shared/schema/local.ts';

export type ThemeValue = Settings['theme'];

const OPTIONS: Array<{ value: ThemeValue; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: MonitorCog },
];

export interface ThemePickerProps {
  value: ThemeValue;
  onChange(v: ThemeValue): void;
  /** true = 只显示图标（窄容器，如工作区小窗）；文字进 aria-label / title。 */
  compact?: boolean;
}

export function ThemePicker({ value, onChange, compact = false }: ThemePickerProps) {
  return (
    <Segmented
      label="明暗主题"
      value={value}
      onChange={onChange}
      compact={compact}
      options={OPTIONS.map(({ value: v, label, Icon }) => ({
        value: v,
        label,
        icon: <Icon size={16} strokeWidth={2} aria-hidden />,
      }))}
    />
  );
}
