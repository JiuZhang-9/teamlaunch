/**
 * 卡片右键菜单。团队只读态 4 项 / 我的入口 6 项 / 编辑态 7 项，由调用方注入 items。
 * 菜单本身只负责定位、分层与关闭时机（outside click / Esc / 选中后）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MenuItem } from './MenuItem.tsx';

export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect(): void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose(): void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 贴边时向内翻转，避免菜单被窗口裁掉
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 8);
    const top = Math.min(y, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="入口操作"
      className="fixed z-[var(--z-dropdown)] min-w-[196px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] py-1"
      style={{ left: pos.left, top: pos.top, background: 'var(--menu-bg)', boxShadow: 'var(--menu-elev)' }}
    >
      {items.map((it) => (
        <MenuItem
          key={it.id}
          role="menuitem"
          label={it.label}
          disabled={it.disabled}
          destructive={it.destructive}
          onSelect={() => {
            it.onSelect();
            onClose();
          }}
        />
      ))}
    </div>
  );
}
