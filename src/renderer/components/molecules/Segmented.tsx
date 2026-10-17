/**
 * Segmented —— 2~4 选一的横向分段控件（从 SettingsPanel 里提出来，2026-10-18）。
 *
 * 提取的动机只有一个：**工作区小窗与设置页要用同一个控件**。抄一份到小窗里，
 * 两处的选中态、键盘行为、令牌就会各自演化（这个项目已经因为"两份实现"栽过几次）。
 * `compact` 是给窄容器（236px 小窗）用的图标态：只留图标，文字进 aria-label / title。
 */
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string | number> {
  /** 控件的无障碍名（radiogroup 的 label）。 */
  label: string;
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange(v: T): void;
  /** true = 只显示图标（窄容器）；文字仍进 aria-label 与 title，不丢信息。 */
  compact?: boolean;
  className?: string;
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  compact = false,
  className = '',
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={['flex items-center gap-1', className].join(' ')}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={compact ? o.label : undefined}
            title={compact ? o.label : undefined}
            onClick={() => onChange(o.value)}
            className={[
              'flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] t-sm',
              compact ? 'w-8 justify-center px-0' : 'px-3',
              'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
              selected ? 'w-emph' : 'hover:bg-[var(--bg-surface-hover)]',
            ].join(' ')}
            style={{
              background: selected ? 'var(--tab-bg-selected)' : 'transparent',
              color: selected ? 'var(--fg)' : 'var(--fg-2)',
            }}
          >
            {o.icon}
            {!compact && o.label}
          </button>
        );
      })}
    </div>
  );
}
