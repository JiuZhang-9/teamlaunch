/**
 * MenuButton —— 三点/更多菜单。原先嵌在 Toolbar 内部，侧栏化后侧栏与内容头都要用，
 * 故抽成独立组件。菜单层必须显式 z-dropdown：内容区 ScrollArea 是 relative 且在 DOM 树更靠后，
 * 不加 z 层时按树序绘制会盖住菜单的第 2 项以后——表现为"只有第一项能点"。
 */
import { EllipsisVertical, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { MenuItem } from '../molecules/MenuItem.tsx';

export interface MenuItemSpec {
  id: string;
  label: string;
  onSelect(): void;
  destructive?: boolean;
}

export interface MenuButtonProps {
  items: MenuItemSpec[];
  ariaLabel: string;
  /** 有文案时渲染成整行的侧栏项；无文案时是纯图标按钮。 */
  label?: string;
  icon?: LucideIcon;
  /** 菜单相对按钮的水平对齐：侧栏里靠左展开，内容头里靠右展开。 */
  align?: 'left' | 'right';
  /** 向上展开：用于侧栏底部区，避免菜单被窗口下沿截断。 */
  placement?: 'top' | 'bottom';
  fullWidth?: boolean;
}

export function MenuButton({
  items,
  ariaLabel,
  label,
  icon = EllipsisVertical,
  align = 'right',
  placement = 'bottom',
  fullWidth = false,
}: MenuButtonProps) {
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
  return (
    <div ref={wrapRef} className="relative shrink-0">
      <Button
        tone="ghost"
        size={label ? 'sm' : 'md'}
        icon={icon}
        iconSize={20}
        aria-label={ariaLabel}
        aria-expanded={open}
        selected={open}
        fullWidth={fullWidth}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open && (
        <div
          role="menu"
          className={[
            'absolute z-[var(--z-dropdown)] w-[212px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] py-1',
            align === 'left' ? 'left-0' : 'right-0',
            placement === 'top' ? 'bottom-full mb-1' : 'mt-1',
          ].join(' ')}
          style={{ background: 'var(--menu-bg)', boxShadow: 'var(--menu-elev)' }}
        >
          {items.map((it) => (
            <MenuItem
              key={it.id}
              role="menuitem"
              label={it.label}
              destructive={it.destructive}
              onSelect={() => {
                it.onSelect();
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
