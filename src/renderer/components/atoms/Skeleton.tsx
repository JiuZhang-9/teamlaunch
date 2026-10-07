/** Skeleton（首屏占位）与 Spinner（加载指示）。两者都必须受 reduced-motion 约束。 */
import { Clock, LoaderCircle } from 'lucide-react';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';

export function Skeleton({
  w = '100%',
  h = 16,
  radius = 'var(--radius-md)',
}: {
  w?: number | string;
  h?: number | string;
  radius?: string;
}) {
  return (
    <span
      aria-hidden
      className="block bg-[var(--skeleton-base)]"
      style={{
        width: typeof w === 'number' ? `${w}px` : w,
        height: typeof h === 'number' ? `${h}px` : h,
        borderRadius: radius,
        backgroundImage:
          'linear-gradient(90deg, var(--skeleton-base) 0%, var(--skeleton-shine) 50%, var(--skeleton-base) 100%)',
        backgroundSize: '200% 100%',
        animation: 'tl-shine var(--motion-loop) var(--ease-linear) infinite',
      }}
    />
  );
}

/** 卡片骨架：与 EntryCard 同尺寸 152×132，圆角 12（首屏 24 张）。 */
export function CardSkeleton() {
  return (
    <span
      aria-hidden
      className="block border border-line rounded-lg p-3"
      style={{ width: 'var(--card-w)', height: 'var(--card-h)', background: 'var(--card-bg)' }}
    >
      <Skeleton w={40} h={40} radius="var(--radius-md)" />
      <span className="mt-1.5 block">
        <Skeleton h={13} />
      </span>
      <span className="mt-1 block">
        <Skeleton w="60%" h={12} />
      </span>
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: 12 | 16 | 20 | 24 }) {
  const reduced = useReducedMotion();
  if (reduced) return <Clock size={size} strokeWidth={2} aria-hidden />;
  return <LoaderCircle size={size} strokeWidth={2} data-motion="loop" aria-hidden />;
}
