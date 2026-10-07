/**
 * Toast —— 轻量反馈条 + 视口容器。
 *
 * 规格要点：打开失败类 Toast 带「查看诊断」「反馈给管理员」动作（AC-12）；
 * DROPPED 类必须由用户确认（duration 0，不自动消失）。
 */
import { CircleCheck, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ToastItem, ToastTone } from '../../store/toastStore.tsx';

const TONE: Record<ToastTone, { icon: LucideIcon; fg: string; border: string }> = {
  info: { icon: Info, fg: 'var(--info-fg)', border: 'var(--accent-border)' },
  success: { icon: CircleCheck, fg: 'var(--success-fg)', border: 'var(--success-fg)' },
  warn: { icon: TriangleAlert, fg: 'var(--warn-fg)', border: 'var(--warn-fg)' },
  danger: { icon: TriangleAlert, fg: 'var(--danger-fg)', border: 'var(--danger-fg)' },
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss(): void }) {
  const c = TONE[item.tone];
  const Glyph = c.icon;
  return (
    <div
      role="status"
      aria-live={item.tone === 'danger' ? 'assertive' : 'polite'}
      className="pointer-events-auto flex w-[380px] items-start gap-2 rounded-[var(--radius-lg)] border p-3"
      style={{ background: 'var(--toast-bg)', boxShadow: 'var(--toast-elev)', borderColor: c.border }}
    >
      <Glyph size={16} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" style={{ color: c.fg }} />
      <div className="min-w-0 flex-1">
        <p className="t-sm w-emph text-[var(--fg)]">{item.title}</p>
        {item.detail && <p className="t-xs mt-0.5 text-[var(--muted)]">{item.detail}</p>}
        {item.actions && item.actions.length > 0 && (
          <div className="mt-2 flex gap-2">
            {item.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  a.onSelect();
                  onDismiss();
                }}
                className="rounded-[var(--radius-sm)] px-2 py-1 t-xs text-[var(--accent-text)] hover:bg-[var(--accent-tint)]"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={onDismiss}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--bg-surface-hover)]"
      >
        <X size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss(id: number): void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none absolute right-[var(--space-6)] bottom-[var(--space-6)] z-[var(--z-toast)] flex flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}
