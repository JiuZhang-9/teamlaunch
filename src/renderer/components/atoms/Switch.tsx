/**
 * Switch —— role="switch" + aria-checked，轨道 36×20，滑块 16，圆角 pill。
 * 8 态：Default / Hover / Focus / Active / Disabled / Loading（无）/ Error（无）/ Selected（= checked）
 */
export interface SwitchProps {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  ariaLabel: string;
  id?: string;
}

export function Switch({ checked, onChange, disabled = false, ariaLabel, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-[var(--radius-pill)]',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        'aria-disabled:bg-[var(--bg-surface-2)]',
      ].join(' ')}
      style={{
        background: disabled
          ? 'var(--bg-surface-2)'
          : checked
            ? 'var(--accent)'
            : 'var(--border-strong)',
      }}
    >
      <span
        aria-hidden
        className="block rounded-[var(--radius-pill)] transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]"
        style={{
          width: 16,
          height: 16,
          marginLeft: 2,
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          background: disabled ? 'var(--disabled-fg)' : 'var(--accent-on)',
        }}
      />
    </button>
  );
}
