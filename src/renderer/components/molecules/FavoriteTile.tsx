/**
 * FavoriteTile —— 主页收藏的图标格（2026-10-17 批 4：用户要求"由列表改图标形式，省空间、好找"）。
 *
 * 与入口卡片（EntryCard）的分工：卡片要在网格里同时表达名字、类型、目标、失败状态；
 * 收藏格只需要"认得出 + 点得开"——图标 40 + 一行名称，悬浮时给「取消收藏」。
 * 键盘可达性沿用 CardGrid 的 roving tabindex（ref/tabIndex/onKeyDown 由父级注入）。
 */
import { forwardRef, type KeyboardEvent } from 'react';
import { Star } from 'lucide-react';
import type { Entry } from '../../../shared/schema/entry.ts';
import { TYPE_META } from '../../lib/entry.ts';
import { useEntryIcon } from '../../hooks/useEntryIcon.ts';
import { IconFrame, Monogram } from '../atoms/Icon.tsx';

export interface FavoriteTileProps {
  entry: Entry;
  source: 'team' | 'personal';
  favorite: boolean;
  /** 悬浮提示（失败时给原因，与旧列表的行为一致）。 */
  statusText: string;
  tabIndex: number;
  onOpen(): void;
  onToggleFavorite(): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}

export const FavoriteTile = forwardRef<HTMLButtonElement, FavoriteTileProps>(function FavoriteTile(
  { entry, source, statusText, tabIndex, onOpen, onToggleFavorite, onKeyDown },
  ref,
) {
  const meta = TYPE_META[entry.type];
  const iconUrl = useEntryIcon(entry, entry.icon.kind === 'local');
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      aria-label={`${entry.name}，${meta.label}，${source === 'team' ? '团队收藏' : '本机收藏'}`}
      title={statusText}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className="group relative flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--card-bg)] p-2 text-center transition-colors duration-[var(--motion-fast)] hover:bg-[var(--card-bg-hover)] focus-visible:shadow-[var(--ring-focus)]"
    >
      {entry.icon.kind === 'emoji' ? (
        <span aria-hidden className="grid h-10 w-10 place-items-center text-[26px] leading-none">
          {entry.icon.char}
        </span>
      ) : iconUrl !== null ? (
        <img src={iconUrl} alt="" aria-hidden className="h-10 w-10 shrink-0 object-contain" />
      ) : (
        <IconFrame tint={meta.tint}>
          <Monogram letter={entry.name.slice(0, 1).toUpperCase()} />
        </IconFrame>
      )}
      <span className="t-xs w-full truncate-1 text-[var(--fg)]">{entry.name}</span>
      {/* 悬浮才出现的「取消收藏」：与卡片上的星标同款（常驻会让小格子变吵）。 */}
      <span
        role="button"
        tabIndex={-1}
        aria-label={`取消收藏 ${entry.name}`}
        title="取消收藏"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded-full text-[var(--favorite-star)] group-hover:grid group-focus-within:grid"
      >
        <Star size={14} strokeWidth={2} aria-hidden fill="currentColor" />
      </span>
    </button>
  );
});
