/**
 * Icon 原子：统一 stroke 2 / round cap / currentColor，尺寸只走 12·16·20·24 阶梯。
 *
 * 2026-11-08（方案 B）：图标容器加**类型形状**（app 圆角方块 / folder 标签缺口 /
 * web 浏览器顶栏），并把首字方块改成只负责文字——背景色/形状由 IconFrame 统一给，
 * 这样回退图标也能吃稳定的身份色（--identity-N-bg/fg）。
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type IconSize = 12 | 16 | 20 | 24;
export type IconShape = 'app' | 'folder' | 'web';

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

/** 回退体图：只渲染首字，背景与形状由外层 IconFrame 提供（绝不用 emoji 顶替图标）。 */
export function Monogram({ letter, size = 17 }: { letter: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid place-items-center leading-none"
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
  shape = 'app',
  fg,
}: {
  tint: string;
  children: ReactNode;
  size?: number;
  /** 类型形状：folder 左上标签缺口、web 顶部浏览器栏；app 普通圆角方块。 */
  shape?: IconShape;
  /** 前景色：回退首字用身份色；真实图标/表情不需要。 */
  fg?: string;
}) {
  const radius = shape === 'folder' ? '9px 9px 9px 3px' : 'var(--radius-md)';
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        background: tint,
        color: fg ?? 'var(--fg-2)',
        borderRadius: radius,
      }}
    >
      {shape === 'folder' && (
        <span
          aria-hidden
          className="absolute left-0"
          style={{ top: -3, width: 16, height: 5, borderRadius: '3px 3px 0 0', background: 'inherit' }}
        />
      )}
      {shape === 'web' && (
        <span
          aria-hidden
          className="absolute"
          style={{ left: 5, right: 5, top: 4, height: 2, borderRadius: 2, background: 'currentColor', opacity: 0.22 }}
        />
      )}
      {children}
    </span>
  );
}
