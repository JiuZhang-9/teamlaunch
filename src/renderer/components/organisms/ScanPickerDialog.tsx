/**
 * 开始菜单扫描结果 —— 勾选要添加的程序，批量加入「我的入口」。
 *
 * 扫描一次可能返回上百条，所以必须能筛选、能一眼看出勾了哪些；
 * 选中态用文字标记而不是颜色（P0：不得只靠颜色区分状态）。
 */
import { useMemo, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { Dialog } from './Dialog.tsx';
import type { ScanCandidate } from '../../bridge/types.ts';

export interface ScanPickerDialogProps {
  items: ScanCandidate[];
  onCancel(): void;
  onConfirm(picked: ScanCandidate[]): void;
}

export function ScanPickerDialog({ items, onCancel, onConfirm }: ScanPickerDialogProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((i) => i.name.toLowerCase().includes(kw));
  }, [items, keyword]);

  const toggle = (target: string): void => {
    setPicked((prev) => (prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target]));
  };

  return (
    <Dialog
      title="选择要添加的程序"
      width="normal"
      onClose={onCancel}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onCancel}>
            取消
          </Button>
          <Button
            tone="primary"
            size="lg"
            softDisabled={picked.length === 0}
            onClick={() => onConfirm(items.filter((i) => picked.includes(i.target)))}
          >
            添加{picked.length > 0 ? `（${picked.length} 个）` : ''}
          </Button>
        </>
      }
    >
      <p className="t-sm mb-2 text-[var(--fg-2)]">
        开始菜单里找到 {items.length} 个程序。勾选要加入「我的入口」的，重复的目标不会重复添加。
      </p>

      <Input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="搜索程序名"
        aria-label="搜索程序名"
        className="mb-2"
      />

      <div className="tl-scroll max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        {list.map((item) => {
          const on = picked.includes(item.target);
          return (
            <button
              key={item.target}
              type="button"
              onClick={() => toggle(item.target)}
              aria-pressed={on}
              className={[
                'flex w-full items-center gap-2 px-3 py-2 text-left t-sm transition-colors duration-[var(--motion-fast)]',
                on ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--fg)] hover:bg-[var(--bg-surface-hover)]',
              ].join(' ')}
            >
              <span aria-hidden className="w-emph shrink-0 font-mono t-xs">
                {on ? '[x]' : '[ ]'}
              </span>
              <span className="truncate">{item.name}</span>
            </button>
          );
        })}
        {list.length === 0 && <p className="px-3 py-4 t-sm text-[var(--meta)]">没有匹配的程序</p>}
      </div>
    </Dialog>
  );
}
