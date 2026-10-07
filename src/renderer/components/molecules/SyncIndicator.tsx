/**
 * SyncIndicator —— 「枚举 → 视觉」的纯映射组件，不含任何判断逻辑。
 *
 * 【红线】K-B 头号红线：UI 不得自行推导状态。本组件只读快照，不读网络、不读时钟、
 *    不沿用上一轮。映射表在 services/syncCopy.ts，与 components/sync-indicator.md §2 逐行对应。
 *
 * 双通道非颜色辨识：16px 图标（6 种）+ 8px 活跃点（空心 / 实心静态 / 实心呼吸 / 旋转）+
 * 各自不同文案。关闭颜色后仍可区分全部 8 态。
 */
import { Clock, LoaderCircle } from 'lucide-react';
import { useSync } from '../../store/syncStore.tsx';
import { syncPresentation, toneVars } from '../../services/syncCopy.ts';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import type { SyncSnapshot } from '../../bridge/types.ts';

function Dot({ kind, color, reduced }: { kind: 'hollow' | 'static' | 'breathe'; color: string; reduced: boolean }) {
  const anim = kind === 'breathe' && !reduced ? 'breathe' : undefined;
  return (
    <span
      aria-hidden
      data-motion={anim}
      className="absolute rounded-pill"
      style={{
        right: -2,
        bottom: -2,
        width: 'var(--sync-dot-size)',
        height: 'var(--sync-dot-size)',
        background: kind === 'hollow' ? 'var(--bg-surface)' : color,
        border: kind === 'hollow' ? '1.5px solid var(--sync-dot-neutral)' : '2px solid var(--bg-surface)',
        boxSizing: 'content-box',
      }}
    />
  );
}

export function SyncIndicator({ snapshot }: { snapshot?: SyncSnapshot }) {
  const ctx = useSync();
  const reduced = useReducedMotion();
  const s = snapshot ?? ctx.snapshot;
  const p = syncPresentation(s);
  const tone = toneVars(p.tone);
  /** reduced-motion 下旋转图标换成静态 Clock（不是"转得慢一点"，是彻底停）。 */
  const isSpinner = p.icon.displayName === 'LoaderCircle' || p.icon === LoaderCircle;
  const Icon = reduced && isSpinner ? Clock : p.icon;
  const iconMotion = !reduced && isSpinner ? 'loop' : undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      data-sync-state={s.state}
      data-offline-reason={s.offlineReason ?? undefined}
      aria-label={[p.line1, p.line2].filter(Boolean).join('。')}
      className="flex min-w-[200px] max-w-[340px] items-start gap-2 px-2"
    >
      <span className="relative mt-0.5 inline-flex shrink-0" style={{ color: tone.fg }}>
        <Icon size={16} strokeWidth={2} data-motion={iconMotion} aria-hidden />
        <Dot kind={p.dot} color={tone.dot} reduced={reduced} />
      </span>
      <span className="min-w-0">
        <span className="t-xs w-read block truncate-1" style={{ color: tone.fg }}>
          {p.line1}
        </span>
        {p.line2 && (
          <span className="t-2xs w-read mt-0.5 block clamp-2 text-[var(--meta)]">{p.line2}</span>
        )}
      </span>
    </div>
  );
}
