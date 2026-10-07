/**
 * Button —— 8 态全覆盖：Default / Hover / Focus / Active / Disabled / Loading / Error / Selected。
 *
 * 两条规格约束在这里落地：
 *  - `softDisabled`：保留在 tab 序列里、带 aria-disabled（V-05 发布按钮的硬性要求，
 *    用原生 disabled 会让键盘用户直接跳过，永远不知道为什么按不动）；
 *  - Loading 时**文案保持不变**，只换图标（V-06 S4）。
 */
import type { LucideIcon } from 'lucide-react';
import { Clock, LoaderCircle } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  tone?: ButtonTone;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconSize?: 12 | 16 | 20 | 24;
  trailingIcon?: LucideIcon;
  loading?: boolean;
  selected?: boolean;
  /** 禁用但仍可聚焦（aria-disabled），用在中止不了的终态按钮上。 */
  softDisabled?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const TONE: Record<ButtonTone, string> = {
  primary: [
    'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]',
    'hover:bg-[var(--btn-primary-bg-hover)] active:bg-[var(--btn-primary-bg-active)]',
    'aria-disabled:bg-surface-2 aria-disabled:text-disabled-fg',
  ].join(' '),
  secondary: [
    'bg-[var(--btn-secondary-bg)] text-[var(--btn-secondary-fg)] border border-[var(--btn-secondary-border)]',
    'hover:bg-[var(--btn-secondary-bg-hover)] active:bg-accent-tint',
    'aria-disabled:border-line aria-disabled:text-disabled-fg',
  ].join(' '),
  ghost: [
    'bg-[var(--btn-ghost-bg)] text-[var(--btn-ghost-fg)]',
    'hover:bg-[var(--btn-ghost-bg-hover)] active:bg-surface-active',
    'aria-disabled:text-disabled-fg',
  ].join(' '),
  danger: [
    'bg-[var(--btn-danger-bg)] text-[var(--btn-danger-fg)]',
    'hover:opacity-90 active:opacity-80',
    'aria-disabled:bg-transparent aria-disabled:text-disabled-fg',
  ].join(' '),
};

const SIZE: Record<ButtonSize, { box: string; pad: string; gap: string }> = {
  sm: { box: 'h-7', pad: 'px-2', gap: 'gap-1' },
  md: { box: 'h-8', pad: 'px-3', gap: 'gap-1.5' },
  lg: { box: 'h-10', pad: 'px-4', gap: 'gap-2' },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = 'ghost',
    size = 'md',
    icon: Leading,
    iconSize = size === 'sm' ? 16 : 20,
    trailingIcon: Trailing,
    loading = false,
    selected = false,
    softDisabled = false,
    fullWidth = false,
    disabled,
    className = '',
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const reduced = useReducedMotion();
  const s = SIZE[size];
  /**
   * softDisabled 必须计入 isDisabled，否则按钮只是"点了没反应"却看起来可用——
   * 这是状态伪造：用户会以为程序坏了。计入后 aria-disabled 生效（样式 + 读屏），
   * 但仍不落原生 disabled，键盘才能聚焦到它、读到禁用原因。
   */
  const isDisabled = Boolean(disabled) || loading || softDisabled;
  /** 原生 disabled 会让元素退出 tab 序列并吞掉 hover，softDisabled 时绝不加。 */
  const useNativeDisabled = isDisabled && !softDisabled;

  return (
    <button
      ref={ref}
      type="button"
      disabled={useNativeDisabled || undefined}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      aria-pressed={selected || undefined}
      data-selected={selected || undefined}
      data-tone={tone}
      onClick={(e) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={[
        'inline-flex items-center justify-center rounded-[var(--radius-md)] select-none',
        'transition-[background-color,color,opacity] duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        'focus-visible:shadow-[var(--ring-focus)]',
        s.box,
        s.pad,
        s.gap,
        TONE[tone],
        selected ? 'bg-accent-tint text-accent-text' : '',
        fullWidth ? 'w-full' : '',
        isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        reduced ? (
          <Clock size={iconSize} strokeWidth={2} aria-hidden />
        ) : (
          <LoaderCircle size={iconSize} strokeWidth={2} data-motion="loop" aria-hidden />
        )
      ) : (
        Leading && <Leading size={iconSize} strokeWidth={2} aria-hidden />
      )}
      {children != null && (
        // whitespace-nowrap：按钮文案被挤压时宁可溢出也不断成一字一行（竖排），
        // 竖排是"看起来坏了"，溢出一眼就知道是宽度不够。
        <span className={`whitespace-nowrap ${size === 'sm' ? 't-xs' : 't-base'}`}>{children}</span>
      )}
      {Trailing && !loading && <Trailing size={iconSize} strokeWidth={2} aria-hidden />}
    </button>
  );
});
