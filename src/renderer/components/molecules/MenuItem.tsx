/**
 * MenuItem —— 菜单行 / 可折叠行 / 问题项行通用骨架。
 *
 * 8 态：Default / Hover / Focus / Active / Disabled / Loading（由 trailing 承载）/
 *       Error（destructive）/ Selected（radio 选中或列表选中）
 */
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface MenuItemProps {
  icon?: LucideIcon;
  iconSize?: 12 | 16 | 20;
  label: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  onSelect?(): void;
  disabled?: boolean;
  selected?: boolean;
  destructive?: boolean;
  expanded?: boolean;
  showChevron?: boolean;
  role?: 'menuitem' | 'radio' | 'button' | 'menuitemcheckbox';
  id?: string;
  ariaLabel?: string;
  className?: string;
}

export function MenuItem({
  icon: Leading,
  iconSize = 16,
  label,
  detail,
  trailing,
  onSelect,
  disabled = false,
  selected = false,
  destructive = false,
  expanded,
  showChevron = false,
  role = 'menuitem',
  id,
  ariaLabel,
  className = '',
}: MenuItemProps) {
  return (
    <button
      id={id}
      type="button"
      role={role}
      aria-checked={role === 'radio' || role === 'menuitemcheckbox' ? selected : undefined}
      aria-disabled={disabled || undefined}
      aria-expanded={showChevron ? Boolean(expanded) : undefined}
      aria-label={ariaLabel}
      data-selected={selected || undefined}
      disabled={disabled}
      onClick={onSelect}
      className={[
        'flex w-full items-center gap-2 px-3 text-left',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        'hover:bg-[var(--menu-item-hover)]',
        'data-[selected=true]:bg-[var(--row-bg-selected)]',
        disabled ? 'cursor-not-allowed text-[var(--disabled-fg)]' : 'cursor-pointer',
        destructive && !disabled ? 'text-[var(--danger-fg)]' : 'text-[var(--fg)]',
        detail ? 'min-h-[var(--row-h)] py-2' : 'min-h-8 py-1.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {Leading && (
        <Leading
          size={iconSize}
          strokeWidth={iconSize === 12 ? 1.75 : 2}
          aria-hidden
          className="shrink-0"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="t-sm block truncate-1">{label}</span>
        {detail && <span className="t-2xs block truncate-1 text-[var(--muted)]">{detail}</span>}
      </span>
      {trailing}
      {showChevron && (
        <ChevronRight
          size={16}
          strokeWidth={2}
          aria-hidden
          className="shrink-0 text-[var(--meta)] transition-transform duration-[var(--motion-fast)]"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
        />
      )}
    </button>
  );
}
