/**
 * Textarea —— 反馈补充说明等自由文本输入。
 * 状态：Default / Hover / Focus / Disabled / Error / ReadOnly（V-08 S3 用 Error）。
 */
import { forwardRef, type TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={[
        'block w-full resize-none rounded-[var(--radius-md)] border p-2 t-sm',
        'bg-[var(--input-bg)] text-[var(--fg)] outline-none',
        'placeholder:text-[var(--input-placeholder)]',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        invalid
          ? 'border-[var(--input-border-error)]'
          : 'border-[var(--input-border)] focus:border-[var(--input-border-focus)]',
        'disabled:bg-[var(--input-bg-disabled)] disabled:text-[var(--disabled-fg)]',
        className,
      ].join(' ')}
      {...rest}
    />
  );
});
