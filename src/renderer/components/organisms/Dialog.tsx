/**
 * 对话框外壳（06/07/08/10 共用）。
 *
 * 约束：
 *  - 宽度恒定（480 / 600）。展开问题列表时**不改变宽度**，只在内容区内部滚动——
 *    宽度跳变会让确认按钮位置移动，是误点的主要来源（06 §7.5）。
 *  - 不使用毛玻璃 / Mica / Acrylic，遮罩只是纯色降透明度。
 *  - `onClose` 为空表示不可关闭（隐私说明门用）。
 */
import { X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

export interface DialogProps {
  title: string;
  titleId?: string;
  describedBy?: string;
  width?: 'normal' | 'wide' | 'xwide';
  onClose?(): void;
  initialFocus?: RefObject<HTMLElement | null>;
  footer?: ReactNode;
  /** 覆写内容区类名（设置对话框用：左侧栏 + 独立滚动的内容列，不需要外层整体滚动）。 */
  bodyClassName?: string;
  children: ReactNode;
}

const WIDTH = { normal: 'var(--dialog-w)', wide: 'var(--dialog-w-wide)', xwide: 'var(--dialog-w-xwide)' } as const;

export function Dialog({
  title,
  titleId = 'tl-dialog-title',
  describedBy,
  width = 'normal',
  onClose,
  initialFocus,
  footer,
  bodyClassName,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = initialFocus?.current ?? panelRef.current;
    target?.focus();
  }, [initialFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const nodes = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((n) => n.offsetParent !== null);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    }
  };

  return (
    // flex（而非 grid）居中：flex item 的百分比 max-height 有确定解析，
    // 容器变小（缩放放大/窗口缩小）时对话框收缩而不是溢出被裁。
    <div className="absolute inset-0 z-[var(--z-dialog-backdrop)] flex items-center justify-center p-[var(--space-6)]">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'var(--bg-canvas)', opacity: 0.72 }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative z-[var(--z-dialog)] flex max-h-[min(640px,100%)] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)]"
        style={{ width: WIDTH[width], maxWidth: '100%', background: 'var(--bg-overlay)', boxShadow: 'var(--elev-3)' }}
      >
        <header className="flex shrink-0 items-center gap-2 px-[var(--space-6)] pt-[var(--space-6)] pb-2">
          <h2 id={titleId} className="t-title flex-1 truncate-1 text-[var(--fg)]">
            {title}
          </h2>
          {onClose && <CloseButton onClose={onClose} />}
        </header>
        <div className={bodyClassName ?? 'tl-scroll min-h-0 flex-1 overflow-y-auto px-[var(--space-6)] pb-2'}>
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-[var(--space-6)] py-[var(--space-4)]">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function CloseButton({ onClose }: { onClose(): void }) {
  return (
    <button
      type="button"
      aria-label="关闭"
      onClick={onClose}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--fg)]"
    >
      <X size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}
