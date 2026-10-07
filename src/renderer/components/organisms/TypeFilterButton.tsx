/**
 * TypeFilterButton —— 顶栏类型筛选（软件 / 文件夹 / 网页）。
 *
 * 多选语义：勾选的类型可见，未勾选的隐藏；一个都不勾 = 全部显示。
 * 只影响可见性，不改组结构（组永远保留）。筛选生效期间拖拽由调用方禁用。
 */
import { Check, Filter } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { MenuItem } from '../molecules/MenuItem.tsx';
import type { EntryType } from '../../../shared/schema/entry.ts';

const TYPES: Array<{ value: EntryType; label: string }> = [
  { value: 'app', label: '软件' },
  { value: 'folder', label: '文件夹' },
  { value: 'web', label: '网页' },
];

export interface TypeFilterButtonProps {
  value: EntryType[];
  onToggle(t: EntryType): void;
  onClear(): void;
}

export function TypeFilterButton({ value, onToggle, onClear }: TypeFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = value.length > 0 && value.length < TYPES.length;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <Button
        tone="ghost"
        icon={Filter}
        iconSize={20}
        aria-label="按类型筛选"
        aria-expanded={open}
        selected={open || active}
        title={active ? `只显示：${TYPES.filter((t) => value.includes(t.value)).map((t) => t.label).join('、')}` : '按类型筛选'}
        onClick={() => setOpen((v) => !v)}
      >
        筛选
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="按类型筛选"
          /* 与下拉菜单同层：内容区 ScrollArea 是 relative 且在 DOM 树更靠后，必须显式 z 层。 */
          className="absolute right-0 z-[var(--z-dropdown)] mt-1 w-[200px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] py-1"
          style={{ background: 'var(--menu-bg)', boxShadow: 'var(--menu-elev)' }}
        >
          {TYPES.map((t) => {
            const checked = value.includes(t.value);
            return (
              <MenuItem
                key={t.value}
                role="menuitemcheckbox"
                aria-checked={checked}
                selected={checked}
                label={t.label}
                trailing={checked ? <Check size={16} strokeWidth={2} aria-hidden className="text-[var(--accent-text)]" /> : undefined}
                onSelect={() => onToggle(t.value)}
              />
            );
          })}
          <div className="my-1 h-px w-full bg-[var(--border-subtle)]" />
          <MenuItem
            label="显示全部"
            disabled={value.length === 0}
            onSelect={() => {
              onClear();
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
