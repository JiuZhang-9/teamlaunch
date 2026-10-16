/**
 * 两个通用小对话框：确认（删除 / 放弃改动）与单行输入（重命名）。
 *
 * 删除确认的**默认焦点必须在「取消」而不是「删除」**（V-02 §5），
 * 且关闭按钮与 Esc 都等价于取消。
 */
import { useRef, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { Dialog } from './Dialog.tsx';

export interface ConfirmDialogProps {
  title: string;
  detail: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  title, detail, confirmLabel, cancelLabel = '取消', destructive = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog
      title={title}
      width="normal"
      onClose={onCancel}
      initialFocus={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} tone="ghost" size="lg" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button tone={destructive ? 'danger' : 'primary'} size="lg" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="t-sm text-[var(--fg-2)]">{detail}</p>
    </Dialog>
  );
}

export interface RenameDialogProps {
  title: string;
  initial: string;
  confirmLabel?: string;
  /** 输入框的读屏名与占位文案（默认面向"入口"；新建分组会换成分组用语）。 */
  fieldLabel?: string;
  placeholder?: string;
  /** 一行说明（输入框上方）。 */
  detail?: string;
  /** 输入上限（默认不限，由调用方传 CAPACITY 的对应值）。 */
  maxLength?: number;
  /**
   * 就地校验：返回非空字符串即拦下这次提交（**不关窗**，把原因显示在输入框下方）。
   * 新建分组用它拦同名——分组名是侧栏锚点 id 与批量添加落点的键，重名会出歧义。
   */
  validate?(next: string): string | null;
  onConfirm(next: string): void;
  onCancel(): void;
}

export function RenameDialog({
  title, initial, confirmLabel = '保存', fieldLabel = '入口名称',
  placeholder = '给这个入口起个能认出它的名字', detail, maxLength, validate,
  onConfirm, onCancel,
}: RenameDialogProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmed = value.trim();
  const error = trimmed.length === 0 ? '名称不能为空' : (validate?.(trimmed) ?? null);
  return (
    <Dialog
      title={title}
      width="normal"
      onClose={onCancel}
      initialFocus={inputRef}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onCancel}>
            取消
          </Button>
          <Button
            tone="primary"
            size="lg"
            softDisabled={error !== null}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {detail && <p className="mb-2 t-xs text-[var(--muted)]">{detail}</p>}
      <Input
        ref={inputRef}
        value={value}
        invalid={error !== null}
        aria-label={fieldLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && error === null) onConfirm(trimmed);
        }}
      />
      {error !== null && <p className="mt-1 t-xs text-[var(--danger-fg)]">{error}</p>}
    </Dialog>
  );
}
