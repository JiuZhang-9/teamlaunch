/**
 * 导入结果对话框（V-02 S6/S7）。
 *
 * 两条硬要求：
 *  - 导入失败**不得改动现有数据**（AC-14），错误说明可复制；
 *  - 冲突必须让用户**逐项选择**跳过 / 覆盖 / 另存副本，默认「另存副本」，禁止静默覆盖（AC-15）。
 *    批量按钮写清楚是"全部另存副本"还是"全部跳过"，不能只写"确定"。
 */
import { Copy, FileUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Dialog } from './Dialog.tsx';

export type ConflictChoice = 'copy' | 'overwrite' | 'skip';

const CHOICE_LABEL: Record<ConflictChoice, string> = {
  copy: '另存副本',
  overwrite: '覆盖现有',
  skip: '跳过',
};
const ORDER: ConflictChoice[] = ['copy', 'overwrite', 'skip'];

export interface ImportConflict {
  id: string;
  name: string;
  /** 现有那条的名字 —— 只写"重复"用户不知道和谁重复。 */
  existingName: string;
}

interface ImportErrorProps {
  mode: 'error';
  error: { message: string; line: number | null };
  onClose(): void;
  onCopyError(): void;
  onRetryFile(): void;
}

interface ImportConflictProps {
  mode: 'conflict';
  conflicts: ImportConflict[];
  onClose(): void;
  onContinue(choices: Record<string, ConflictChoice>): void;
}

export type ImportDialogProps = ImportErrorProps | ImportConflictProps;

export function ImportDialog(props: ImportDialogProps) {
  const initialConflicts = props.mode === 'conflict' ? props.conflicts : [];
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() =>
    Object.fromEntries(initialConflicts.map((c) => [c.id, 'copy' as ConflictChoice])),
  );

  if (props.mode === 'error') {
    const { error, onClose, onCopyError, onRetryFile } = props;
    return (
      <Dialog
        title="这个文件无法导入"
        width="normal"
        onClose={onClose}
        footer={
          <>
            <Button tone="secondary" icon={Copy} onClick={onCopyError}>
              复制错误信息
            </Button>
            <Button tone="ghost" size="lg" onClick={onRetryFile}>
              重新选择文件
            </Button>
          </>
        }
      >
        <p className="t-sm text-[var(--fg-2)]">
          {error?.message ?? '不是有效的入口文件，现有内容没有改动。'}
          {error?.line != null && `（第 ${error.line} 行）`}
        </p>
        <p className="mt-2 t-xs text-[var(--muted)]">现有内容没有改动。</p>
      </Dialog>
    );
  }

  const { conflicts, onClose, onContinue } = props;

  return (
    <Dialog
      title={`导入时遇到 ${conflicts.length} 个重复入口`}
      width="normal"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" size="sm" onClick={() => setChoices(Object.fromEntries(conflicts.map((c) => [c.id, 'copy' as ConflictChoice])))}>
            全部另存副本
          </Button>
          <Button tone="ghost" size="sm" onClick={() => setChoices(Object.fromEntries(conflicts.map((c) => [c.id, 'skip' as ConflictChoice])))}>
            全部跳过
          </Button>
          <Button tone="primary" size="lg" icon={FileUp} onClick={() => onContinue(choices)}>
            继续导入
          </Button>
        </>
      }
    >
      <p className="t-sm mb-2 text-[var(--fg-2)]">
        这些入口在本机已存在。选择处理方式后继续，不会覆盖你现有的内容。
      </p>
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        {conflicts.map((c) => (
          <div
            key={c.id}
            className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
            role="radiogroup"
            aria-label={`${c.name} 的处理方式`}
          >
            <p className="t-sm truncate-1 text-[var(--fg)]">{c.name}</p>
            <p className="mt-0.5 t-2xs truncate-1 text-[var(--muted)]">与现有「{c.existingName}」重复</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {ORDER.map((k) => {
                const selected = choices[c.id] === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setChoices((prev) => ({ ...prev, [c.id]: k }))}
                    className={[
                      'h-7 rounded-[var(--radius-sm)] px-2 t-xs',
                      'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
                    ].join(' ')}
                    style={{
                      background: selected ? 'var(--accent-tint)' : 'transparent',
                      color: selected ? 'var(--accent-text)' : 'var(--fg-2)',
                      boxShadow: selected ? 'inset 0 0 0 1px var(--accent-border)' : 'none',
                    }}
                  >
                    {CHOICE_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
