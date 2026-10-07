/**
 * Banner —— 顶部条件条（h40）。离线 / 更新已应用 / 容量预警 / 热键冲突共用。
 *
 * 两条纪律：
 *  - 第二行必须自带下一步动作（sync-indicator.md §3.2），只写原因不写怎么办等于甩锅；
 *  - 四个 offlineReason 的视觉权重完全相同，罕见分支不得加"事故级"样式。
 */
import { Info, RefreshCw, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';

export type BannerTone = 'info' | 'success' | 'warn' | 'danger';

const TONE: Record<BannerTone, { bg: string; fg: string; icon: LucideIcon }> = {
  info: { bg: 'var(--info-bg)', fg: 'var(--info-fg)', icon: Info },
  success: { bg: 'var(--success-bg)', fg: 'var(--success-fg)', icon: RefreshCw },
  warn: { bg: 'var(--warn-bg)', fg: 'var(--warn-fg)', icon: TriangleAlert },
  danger: { bg: 'var(--danger-bg)', fg: 'var(--danger-fg)', icon: TriangleAlert },
};

export interface BannerProps {
  tone?: BannerTone;
  icon?: LucideIcon;
  title: string;
  detail?: string;
  action?: { label: string; onSelect(): void };
  onDismiss?(): void;
  className?: string;
}

export function Banner({
  tone = 'warn',
  icon,
  title,
  detail,
  action,
  onDismiss,
  className = '',
}: BannerProps) {
  const c = TONE[tone];
  const Leading = icon ?? c.icon;
  return (
    <div
      role="status"
      className={[
        'flex shrink-0 items-center gap-2 px-[var(--space-6)] py-2',
        'min-h-[var(--banner-h)] border-b border-[var(--border-subtle)]',
        className,
      ].join(' ')}
      style={{ background: c.bg, color: c.fg }}
    >
      <Leading size={16} strokeWidth={2} aria-hidden className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="t-xs w-emph truncate-1">{title}</p>
        {detail && <p className="t-2xs clamp-2 opacity-90">{detail}</p>}
      </div>
      {action && (
        <Button size="sm" tone="ghost" onClick={action.onSelect} className="shrink-0">
          {action.label}
        </Button>
      )}
      {onDismiss && (
        <button
          type="button"
          aria-label="关闭提示"
          onClick={onDismiss}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] hover:bg-[var(--bg-surface-hover)]"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}
