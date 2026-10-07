/**
 * EmptyBlock —— 空 / 离线 / 错误三种内容的统一呈现。
 *
 * 最容易做错的一处（sync-indicator.md §4）：**有缓存但配置里 0 个入口 ≠ 故障**。
 * 这种场景必须走这里，用中性插画与说明文案，不得套用离线或错误配色，
 * 否则"管理员还没发内容"会被误报成"网络坏了"。
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface EmptyBlockProps {
  icon: LucideIcon;
  iconSize?: 16 | 20 | 24;
  title: string;
  detail: string;
  actions?: ReactNode;
  /** 迷你面板内的行内空态（h132，无插画放大） */
  compact?: boolean;
  className?: string;
}

export function EmptyBlock({
  icon: Glyph,
  iconSize = 24,
  title,
  detail,
  actions,
  compact = false,
  className = '',
}: EmptyBlockProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-2 text-center',
        compact ? 'h-[132px] px-[var(--space-3)]' : 'flex-1 px-[var(--space-6)] py-[var(--space-10)]',
        className,
      ].join(' ')}
      style={{ maxWidth: 'var(--empty-max-w)', margin: '0 auto' }}
    >
      <Glyph
        size={iconSize}
        strokeWidth={2}
        aria-hidden
        className="shrink-0"
        style={{ color: 'var(--empty-illustration-fg)' }}
      />
      <p className="t-base w-emph" style={{ color: 'var(--empty-title-fg)' }}>
        {title}
      </p>
      <p className="t-sm" style={{ color: 'var(--empty-desc-fg)' }}>
        {detail}
      </p>
      {actions && <div className="mt-2 flex items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
