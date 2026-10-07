/**
 * ResultRow —— 迷你面板（V-03）与窗口内搜索（V-04）共用的结果行，h44。
 *
 * AC-03：每条结果必须**同时**有类型图标与类型文字。图标在左，
 * 文字通道由调用方通过 trailing（TypeTag / SourceTag）或副标签前缀提供。
 */
import type { MouseEvent } from 'react';
import type { Entry } from '../../../shared/schema/entry.ts';
import { TYPE_META } from '../../lib/entry.ts';
import { Spinner } from '../atoms/Skeleton.tsx';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ResultRowProps {
  entry: Entry;
  subtitle: string;
  iconUrl?: string | null;
  /** 图标槽内的字形尺寸：迷你面板 16，窗口内搜索 24 */
  glyphSize?: 16 | 24;
  iconSize?: 16 | 24;
  selected?: boolean;
  phase?: 'idle' | 'opening' | 'failed';
  trailing?: ReactNode;
  onOpen(): void;
  onContextMenu?(e: MouseEvent<HTMLDivElement>): void;
  id?: string;
}

export function ResultRow({
  entry,
  subtitle,
  iconUrl,
  glyphSize = 16,
  iconSize = 24,
  selected = false,
  phase = 'idle',
  trailing,
  onOpen,
  onContextMenu,
  id,
}: ResultRowProps) {
  const meta = TYPE_META[entry.type];
  const Glyph = meta.icon;
  const failed = phase === 'failed';

  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={[
        'relative flex h-[var(--row-h)] cursor-pointer items-center gap-3 px-3',
        'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        selected ? 'bg-[var(--row-bg-selected)]' : 'hover:bg-[var(--row-bg-hover)]',
      ].join(' ')}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-0.5"
          style={{ background: 'var(--row-indicator)' }}
        />
      )}
      <span
        className="grid shrink-0 place-items-center rounded-[var(--radius-md)]"
        style={{ width: iconSize, height: iconSize, background: meta.tint }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" width={glyphSize} height={glyphSize} />
        ) : (
          <Glyph size={glyphSize} strokeWidth={2} aria-hidden style={{ color: 'var(--fg-2)' }} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-base w-emph block truncate-1 text-[var(--fg)]">{entry.name}</span>
        <span
          className="t-xs block truncate-1"
          style={{ color: failed ? 'var(--danger-fg)' : 'var(--muted)' }}
        >
          {failed ? '没能打开，点击查看原因' : subtitle}
        </span>
      </span>
      {phase === 'opening' && <Spinner size={16} />}
      {failed && <TriangleAlert size={16} strokeWidth={2} className="text-[var(--danger-fg)]" />}
      {trailing}
    </div>
  );
}
