/**
 * Input 原子 —— 8 态中的 Default / Hover / Focus / Disabled / Error / ReadOnly 在此实现，
 * Loading 与 Selected 由具体场景（搜索框、口令框）在外部组合。
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, leading, trailing, mono = false, className = '', ...rest },
  ref,
) {
  return (
    <label
      data-invalid={invalid || undefined}
      className={[
        'inline-flex h-8 w-full items-center gap-2 rounded-[var(--radius-md)] border px-2',
        'bg-[var(--input-bg)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        invalid
          ? 'border-[var(--input-border-error)]'
          : 'border-[var(--input-border)] focus-within:border-[var(--input-border-focus)]',
        'aria-disabled:bg-[var(--input-bg-disabled)]',
        rest.readOnly ? 'bg-surface-2' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {leading}
      <input
        ref={ref}
        className={[
          'min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--input-placeholder)]',
          mono ? 't-mono t-sm' : 't-sm',
        ].join(' ')}
        {...rest}
      />
      {trailing}
    </label>
  );
});
