/**
 * 表单类原子（Spec §7 未单列但设置/反馈对话框必需）：Switch / Segmented / Textarea。
 * 语义一律用 Radix 的 role 契约，不用原生 checkbox 拼装。
 */
import { RadioGroup, Switch } from 'radix-ui';
import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from 'react';

export function Toggle({
  checked,
  onCheckedChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onCheckedChange(v: boolean): void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Switch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill border',
        'transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)]',
        'focus-visible:shadow-[var(--ring-focus)]',
        checked ? 'bg-accent border-accent' : 'bg-surface-2 border-line-default',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <Switch.Thumb
        className="block h-4 w-4 rounded-pill bg-surface translate-x-0.5 transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] will-change-transform"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(2px)' }}
      />
    </Switch.Root>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      className="inline-flex items-center gap-1"
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className={[
            'inline-flex h-8 items-center gap-1.5 rounded-md px-3 t-sm',
            'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
            'focus-visible:shadow-[var(--ring-focus)]',
            value === o.value
              ? 'bg-[var(--tab-bg-selected)] text-fg w-emph shadow-[var(--elev-1)]'
              : 'bg-transparent text-fg-2 hover:bg-surface-hover',
          ].join(' ')}
        >
          {o.icon}
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid = false, className = '', ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={[
          'w-full resize-none rounded-md border bg-[var(--input-bg)] p-2 t-sm',
          'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
          // 焦点指示只用 accent 边框：文本域再叠 ring 会出第二个错位的框（同 Input 原子）。
          'focus-visible:border-[var(--input-border-focus)]',
          invalid ? 'border-[var(--input-border-error)]' : 'border-[var(--input-border)]',
          className,
        ].join(' ')}
        {...rest}
      />
    );
  },
);
