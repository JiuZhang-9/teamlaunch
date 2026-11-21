/**
 * FavoriteTile —— 主页收藏的图标格（2026-10-17 批 4：用户要求"由列表改图标形式，省空间、好找"）。
 *
 * 与入口卡片（EntryCard）的分工：卡片要在网格里同时表达名字、类型、目标、失败状态；
 * 收藏格只需要"认得出 + 点得开"——图标 40 + 一行名称，悬浮时给「取消收藏」。
 * 键盘可达性沿用 CardGrid 的 roving tabindex（ref/tabIndex/onKeyDown 由父级注入）。
 *
 * 1.10.0：支持拖拽排序（CardGrid 提供 HTML5 拖拽束）+ 方案 C 点击反馈
 * （按下卡片 0.97 / 图标下压 0.9，打开成功图标 1→1.12→1 弹一下）。
 */
import { forwardRef, useRef, type KeyboardEvent } from 'react';
import { Star } from 'lucide-react';
import type { Entry } from '../../../shared/schema/entry.ts';
import { TYPE_META } from '../../lib/entry.ts';
import { useEntryIcon, wantsEntryIcon } from '../../hooks/useEntryIcon.ts';
import { IconFrame, Monogram } from '../atoms/Icon.tsx';
import { identityTone } from '../../../shared/identity.ts';
import type { CardDragProps } from './CardGrid.tsx';

export interface FavoriteTileProps {
  entry: Entry;
  source: 'team' | 'personal';
  favorite: boolean;
  /** 悬浮提示（失败时给原因，与旧列表的行为一致）。 */
  statusText: string;
  tabIndex: number;
  /** HTML5 拖拽束（1.10.0 收藏拖拽排序）：由 CardGrid 提供处理器与落点指示。 */
  drag?: CardDragProps;
  onOpen(): void;
  onToggleFavorite(): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}

export const FavoriteTile = forwardRef<HTMLButtonElement, FavoriteTileProps>(function FavoriteTile(
  { entry, source, statusText, tabIndex, drag, onOpen, onToggleFavorite, onKeyDown },
  ref,
) {
  const meta = TYPE_META[entry.type];
  const iconUrl = useEntryIcon(entry, wantsEntryIcon(entry));
  const emoji = entry.icon.kind === 'emoji' ? entry.icon.char : null;
  const autoFallback = !emoji && !iconUrl;
  const tone = identityTone(entry.id);
  const iconRef = useRef<HTMLSpanElement | null>(null);

  /** 方案 C：打开成功时图标弹一下（与 EntryCard / PaletteResults 同一套 keyframes）。 */
  const playPop = () => {
    const el = iconRef.current;
    if (el === null) return;
    el.classList.remove('tl-press-pop');
    void el.offsetWidth;
    el.classList.add('tl-press-pop');
  };

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      aria-label={`${entry.name}，${meta.label}，${source === 'team' ? '团队收藏' : '本机收藏'}`}
      title={statusText}
      draggable={drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      onClick={() => {
        playPop();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') playPop();
        onKeyDown(e);
      }}
      className={[
        'group tl-pressable relative flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--card-bg)] p-2 text-center',
        'transition-[background-color,scale] duration-[var(--motion-fast)] hover:bg-[var(--card-bg-hover)] focus-visible:shadow-[var(--ring-focus)]',
        'active:scale-[0.97]',
        drag?.dragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <span ref={iconRef} className="tl-press-icon relative inline-flex">
        <IconFrame
          tint={autoFallback ? `var(--identity-${tone}-bg)` : meta.tint}
          fg={autoFallback ? `var(--identity-${tone}-fg)` : undefined}
          shape={meta.shape}
        >
          {emoji ? (
            <span aria-hidden className="grid place-items-center text-[26px] leading-none">{emoji}</span>
          ) : iconUrl !== null ? (
            <img src={iconUrl} alt="" aria-hidden className="h-10 w-10 shrink-0 object-contain" />
          ) : (
            <Monogram letter={entry.name.slice(0, 1).toUpperCase()} />
          )}
        </IconFrame>
      </span>
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
      {/* 拖拽落点指示：悬停侧缘 2px 强调色竖线（与 EntryCard 同款）。 */}
      {drag?.dropSide && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 z-10 rounded-full"
          style={{
            width: 2,
            background: 'var(--accent)',
            [drag.dropSide === 'before' ? 'left' : 'right']: -4,
          }}
        />
      )}
    </button>
  );
});
