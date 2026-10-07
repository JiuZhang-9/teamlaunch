/**
 * SearchInput 原子 —— 工具栏搜索框（w 280，图标 16）与迷你面板搜索框（h 40，图标 20）共用。
 * Loading 态（防抖计算中）不显示转圈，只由调用方在结果区表达，避免输入框内闪动。
 */
import { Search, X } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  variant?: 'toolbar' | 'palette';
  onClear?(): void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { variant = 'toolbar', onClear, className = '', value, ...rest },
  ref,
) {
  const palette = variant === 'palette';
  const iconSize = palette ? 20 : 16;
  const hasValue = typeof value === 'string' && value.length > 0;

  return (
    <div
      className={[
        'group relative flex items-center rounded-md border border-[var(--input-border)]',
        'bg-[var(--input-bg)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        'focus-within:border-[var(--input-border-focus)]',
        palette ? 'h-10' : 'h-8',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Search
        size={iconSize}
        strokeWidth={2}
        aria-hidden
        className="ml-2 shrink-0 text-[var(--meta)]"
      />
      <input
        ref={ref}
        value={value}
        className={[
          'min-w-0 flex-1 bg-transparent px-2 outline-none',
          'placeholder:text-[var(--input-placeholder)]',
          palette ? 't-md' : 't-sm',
        ].join(' ')}
        {...rest}
      />
      {hasValue && onClear && (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={onClear}
          className="mr-1 grid h-6 w-6 place-items-center rounded-sm text-[var(--muted)] hover:bg-surface-hover hover:text-fg"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
});
