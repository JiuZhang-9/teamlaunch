/**
 * FeedbackDialog（V-08）—— 五个原因固定顺序、不可增删。
 *
 * 铁律：**排队中的反馈绝不能显示成已发送**（AC-13）。
 * SENT 只能在服务端确认后置位；离线不是失败，进了待发送队列就是 PENDING。
 * 打开时焦点落在第一项原因，不落在提交按钮（避免连按 Enter 提交空表单）。
 */
import { Send, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Textarea } from '../atoms/Textarea.tsx';
import { FeedbackStatus, type FeedbackStatusKind } from '../molecules/FeedbackStatus.tsx';
import { TypeTag } from '../atoms/Tag.tsx';
import { Dialog } from './Dialog.tsx';
import type { Entry } from '../../../shared/schema/entry.ts';
import { TYPE_META, targetFull } from '../../lib/entry.ts';
import type { FeedbackReason } from '../../../shared/schema/feedback.ts';

const REASONS: Array<{ code: FeedbackReason; label: string }> = [
  { code: 'not_installed', label: '打开后没有反应' },
  { code: 'path_missing', label: '提示找不到文件或路径' },
  { code: 'link_unavailable', label: '网页打不开或地址变了' },
  { code: 'permission_denied', label: '我没有这个软件的权限' },
  { code: 'other', label: '其他（请填写说明）' },
];

export interface FeedbackDialogProps {
  entry: Entry | null;
  submitting: boolean;
  status: FeedbackStatusKind | null;
  statusDetail?: string;
  onSubmit(reason: FeedbackReason, note: string): void;
  onClose(): void;
  onRetry(): void;
}

const MAX_NOTE = 200;

export function FeedbackDialog({
  entry, submitting, status, statusDetail, onSubmit, onClose, onRetry,
}: FeedbackDialogProps) {
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [note, setNote] = useState('');
  const [showNoteError, setShowNoteError] = useState(false);
  const firstRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  if (!entry) return null;
  const meta = TYPE_META[entry.type];
  const Glyph = meta.icon as LucideIcon;
  const remaining = MAX_NOTE - note.length;
  const needNote = reason === 'other' && note.trim().length === 0;

  const submit = () => {
    if (!reason) return;
    if (needNote) {
      setShowNoteError(true);
      return;
    }
    onSubmit(reason, note.trim());
  };

  return (
    <Dialog
      title="反馈给管理员"
      width="normal"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onClose}>
            取消
          </Button>
          <Button
            tone="primary"
            size="lg"
            icon={Send}
            iconSize={20}
            loading={submitting}
            softDisabled={!reason}
            onClick={submit}
          >
            提交反馈
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
        <span
          className="grid shrink-0 place-items-center rounded-[var(--radius-md)]"
          style={{ width: 24, height: 24, background: meta.tint }}
        >
          <Glyph size={16} strokeWidth={2} aria-hidden style={{ color: 'var(--fg-2)' }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-base w-emph truncate-1 text-[var(--fg)]">{entry.name}</p>
          <p className="t-xs t-mono truncate-1 text-[var(--muted)]">{targetFull(entry)}</p>
        </div>
        <TypeTag label={meta.label} />
      </div>

      <p className="t-sm w-emph mt-3 text-[var(--fg)]">哪里不对？</p>
      <div
        role="radiogroup"
        aria-label="哪里不对？"
        className="mt-1 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]"
      >
        {REASONS.map((r, i) => {
          const selected = reason === r.code;
          return (
            <button
              key={r.code}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setReason(r.code);
                if (r.code !== 'other') setShowNoteError(false);
              }}
              className={[
                'flex w-full items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-left last:border-b-0',
                'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
                selected ? 'bg-[var(--row-bg-selected)]' : 'hover:bg-[var(--menu-item-hover)]',
              ].join(' ')}
            >
              <span
                aria-hidden
                className="grid h-4 w-4 shrink-0 place-items-center rounded-[var(--radius-pill)] border"
                style={{
                  borderColor: selected ? 'var(--accent)' : 'var(--border-strong)',
                  background: selected ? 'var(--accent)' : 'transparent',
                }}
              >
                {selected && (
                  <span className="block h-1.5 w-1.5 rounded-[var(--radius-pill)]" style={{ background: 'var(--accent-on)' }} />
                )}
              </span>
              <span className="t-sm text-[var(--fg)]">{r.label}</span>
            </button>
          );
        })}
      </div>

      <label className="mt-3 block">
        <span className="t-sm w-emph text-[var(--fg)]">补充说明（可选）</span>
        <Textarea
          className="mt-1 h-16"
          value={note}
          maxLength={MAX_NOTE}
          invalid={showNoteError && needNote}
          placeholder="不要填写密码、个人信息"
          onChange={(e) => {
            setNote(e.target.value);
            if (e.target.value.trim()) setShowNoteError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <p className="mt-1 text-right t-2xs text-[var(--meta)]">
        {showNoteError && needNote ? (
          <span className="text-[var(--danger-fg)]">选了「其他」时请简单写一句说明</span>
        ) : (
          `还可以输入 ${Math.max(0, remaining)} 字`
        )}
      </p>

      {status && (
        <div className="mt-2">
          <FeedbackStatus kind={status} detail={statusDetail} onRetry={onRetry} />
        </div>
      )}
    </Dialog>
  );
}
