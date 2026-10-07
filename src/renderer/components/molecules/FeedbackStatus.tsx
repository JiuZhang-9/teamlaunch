/**
 * FeedbackStatus —— 反馈投递状态条（AC-13 / AC-13a）。
 *
 * 【红线】最严重的一类伪造：**排队中的反馈绝不能显示成已发送**。
 *    PENDING 必须是 warn + clock + 「反馈已保存，稍后自动发送」；
 *    用 circle-check 就是伪造状态。SENT 只允许在服务端确认后置位。
 *    离线不是失败——写进待发送队列就是 PENDING，不得渲染成红色错误。
 */
import { CircleCheck, Clock, RotateCcw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';

export type FeedbackStatusKind = 'pending' | 'sent' | 'dropped' | 'rate_limited';

const MAP: Record<
  FeedbackStatusKind,
  { icon: LucideIcon; bg: string; fg: string; text: string; live: 'polite' | 'assertive' }
> = {
  pending: {
    icon: Clock,
    bg: 'var(--feedback-pending-bg)',
    fg: 'var(--feedback-pending-fg)',
    text: '反馈已保存，稍后自动发送',
    live: 'polite',
  },
  sent: {
    icon: CircleCheck,
    bg: 'var(--feedback-sent-bg)',
    fg: 'var(--feedback-sent-fg)',
    text: '反馈已发送给管理员',
    live: 'polite',
  },
  dropped: {
    icon: TriangleAlert,
    bg: 'var(--feedback-dropped-bg)',
    fg: 'var(--feedback-dropped-fg)',
    text: '这条反馈没能发送，可以重新提交。',
    live: 'assertive',
  },
  rate_limited: {
    icon: Clock,
    bg: 'var(--feedback-pending-bg)',
    fg: 'var(--feedback-pending-fg)',
    text: '这台设备短时间内反馈太多，请稍后再试',
    live: 'assertive',
  },
};

export interface FeedbackStatusProps {
  kind: FeedbackStatusKind;
  /** DROPPED 必须写明具体原因（AC-13a：不得只说"失败"） */
  detail?: string;
  onRetry?(): void;
}

export function FeedbackStatus({ kind, detail, onRetry }: FeedbackStatusProps) {
  const m = MAP[kind];
  const Glyph = m.icon;
  return (
    <div
      role="status"
      aria-live={m.live}
      data-feedback-state={kind}
      className="flex min-h-8 items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5"
      style={{ background: m.bg, color: m.fg }}
    >
      <Glyph size={16} strokeWidth={2} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 t-xs">
        {m.text}
        {detail && <span className="block t-2xs opacity-90">{detail}</span>}
      </span>
      {kind === 'dropped' && onRetry && (
        <Button size="sm" tone="secondary" icon={RotateCcw} onClick={onRetry} className="shrink-0">
          重新提交
        </Button>
      )}
    </div>
  );
}
