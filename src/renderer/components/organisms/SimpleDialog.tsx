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
  onConfirm(next: string): void;
  onCancel(): void;
}

export function RenameDialog({ title, initial, confirmLabel = '保存', onConfirm, onCancel }: RenameDialogProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const empty = value.trim().length === 0;
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
            softDisabled={empty}
            onClick={() => onConfirm(value.trim())}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Input
        ref={inputRef}
        value={value}
        aria-label="入口名称"
        placeholder="给这个入口起个能认出它的名字"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !empty) onConfirm(value.trim());
        }}
      />
      {empty && <p className="mt-1 t-xs text-[var(--danger-fg)]">名称不能为空</p>}
    </Dialog>
  );
}
