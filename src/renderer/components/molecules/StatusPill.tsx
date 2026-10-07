/**
 * StatusPill —— 状态徽标。
 *
 * 两个用途共用同一套配色映射：
 *  - 编辑模式徽标（唯一使用 pill 圆角的控件，靠形状而不是颜色辨识）
 *  - 发布对话框的校验结果块（圆角块形态，可带前置图标）
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type PillTone = 'neutral' | 'success' | 'warn' | 'danger' | 'busy' | 'draft';

const TONE: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--bg-surface-2)', fg: 'var(--fg-2)' },
  success: { bg: 'var(--success-bg)', fg: 'var(--success-fg)' },
  warn: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
  danger: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
  busy: { bg: 'var(--accent-tint)', fg: 'var(--accent-text)' },
  draft: { bg: 'var(--draft-badge-bg)', fg: 'var(--accent-text)' },
};

export interface StatusPillProps {
  tone?: PillTone;
  icon?: LucideIcon;
  iconSize?: 12 | 16;
  children: ReactNode;
  /** pill = 工具栏徽标；block = 对话框内的结果块（h32，p-x 12） */
  variant?: 'pill' | 'block';
  className?: string;
}

export function StatusPill({
  tone = 'neutral',
  icon: Leading,
  iconSize = 16,
  children,
  variant = 'pill',
  className = '',
}: StatusPillProps) {
  const c = TONE[tone];
  return (
    <span
      data-tone={tone}
      className={[
        'inline-flex items-center gap-1.5 t-xs',
        variant === 'pill'
          ? 'h-6 px-2 rounded-[var(--radius-pill)] w-emph'
          : 'min-h-8 px-3 py-1.5 rounded-[var(--radius-md)]',
        className,
      ].join(' ')}
      style={{ background: c.bg, color: c.fg }}
    >
      {Leading && <Leading size={iconSize} strokeWidth={iconSize === 12 ? 1.75 : 2} aria-hidden />}
      <span>{children}</span>
    </span>
  );
}
