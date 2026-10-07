/**
 * Icon 原子：统一 stroke 2 / round cap / currentColor，尺寸只走 12·16·20·24 阶梯。
 * IconFrame 是 40×40 的图标容器槽（卡片用）， tint 按入口类型取，软件刻意保持中性。
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type IconSize = 12 | 16 | 20 | 24;

export function Glyph({
  icon: Icon,
  size = 16,
  micro = false,
  className = '',
}: {
  icon: LucideIcon;
  size?: IconSize;
  /** 12px 角标用 1.75 描边，避免小尺寸糊成一团。 */
  micro?: boolean;
  className?: string;
}) {
  return (
    <Icon
      size={size}
      strokeWidth={micro ? 1.75 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    />
  );
}

/**
 * 回退体图：图标缺失时显示首字单体图（40×40 圆角 8）。
 * 这是回退链的一环，不是 emoji 头像 —— 绝不用 emoji 顶替图标。
 */
export function Monogram({ letter, size = 17 }: { letter: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid place-items-center w-[var(--icon-box)] h-[var(--icon-box)] rounded-[var(--radius-md)] bg-surface-2 text-fg-2"
      style={{ fontSize: `${size}px`, fontWeight: 'var(--weight-announce)', lineHeight: 1 }}
    >
      {letter}
    </span>
  );
}

export function IconFrame({
  tint,
  children,
  size = 40,
}: {
  tint: string;
  children: ReactNode;
  size?: number;
}) {
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-md"
      style={{ width: size, height: size, background: tint }}
    >
      {children}
    </span>
  );
}
