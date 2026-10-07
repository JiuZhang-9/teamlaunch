/**
 * BrandMark —— 产品 Logo：字母 T 的框线版（定稿 A）。
 * 圆角方框描边 + 一笔 T，与 Lucide 图标同一套 stroke 语言；
 * currentColor 上色，随主题色走。solid 变体（accent 实底 + 反白 T）预留给托盘/任务栏图标场景。
 */
import type { CSSProperties } from 'react';

export type BrandMarkVariant = 'frame' | 'solid';

const base: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 'var(--radius-md, 8px)',
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
};

export function BrandMark({ variant = 'frame', size = 15 }: { variant?: BrandMarkVariant; size?: number }) {
  const stroke = variant === 'solid' ? 2.4 : 2;
  return (
    <span
      aria-hidden
      style={{
        ...base,
        background: variant === 'solid' ? 'var(--accent)' : 'transparent',
        color: variant === 'solid' ? 'var(--accent-on, #fff)' : 'var(--accent-text)',
        transition: 'background-color 200ms var(--ease-standard), color 200ms var(--ease-standard)',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {variant === 'frame' && <rect x="3" y="3" width="18" height="18" rx="5" />}
        <path d="M8 8h8M12 8v8.5" />
      </svg>
    </span>
  );
}
