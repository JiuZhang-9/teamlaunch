/**
 * ChainTile —— 主页「连锁」的图标格（2026-10-19 用户要求："主页的连锁能否也变成像收藏一样的卡片"）。
 *
 * 与收藏格同一视觉语言：图标 40 + 一行名称 + 悬浮操作；差别在**主操作是一键启动**，
 * 悬浮操作是「⋯」（重命名 / 记住窗口布局 / 删除——都放在外面那层菜单里，格子里只留入口）。
 * 键盘可达性沿用 CardGrid 的 roving tabindex（ref/tabIndex/onKeyDown 由父级注入）。
 */
import { forwardRef, type KeyboardEvent, type MouseEvent } from 'react';
import { EllipsisVertical, ListChecks } from 'lucide-react';
import type { SavedChain } from '../../bridge/types.ts';
import type { Entry } from '../../../shared/schema/entry.ts';
import { TYPE_META } from '../../lib/entry.ts';
import { useEntryIcon } from '../../hooks/useEntryIcon.ts';
import { IconFrame, Monogram } from '../atoms/Icon.tsx';

/** 空壳入口（只在"连锁里的入口全失效"时占位；enabled=false 保证不发请求）。 */
const EMPTY_ENTRY = {
  id: '',
  name: '',
  sort: 0,
  type: 'folder',
  target: '',
  icon: { kind: 'fallback' },
  updatedAt: '1970-01-01T00:00:00.000Z',
} as Entry;

export interface ChainTileProps {
  chain: SavedChain;
  /** 首个还在的步骤（用来当图标）；null = 全部失效。 */
  iconEntry: Entry | null;
  /** 解析后仍在的入口数。 */
  entryCount: number;
  missingCount: number;
  /** 记住过几个窗口位置（>0 时格子上标一下）。 */
  layoutCount: number;
  tabIndex: number;
  onLaunch(): void;
  onMenu(e: MouseEvent<HTMLElement>): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
}

export const ChainTile = forwardRef<HTMLButtonElement, ChainTileProps>(function ChainTile(
  { chain, iconEntry, entryCount, missingCount, layoutCount, tabIndex, onLaunch, onMenu, onKeyDown },
  ref,
) {
  const broken = entryCount === 0;
  const meta = iconEntry ? TYPE_META[iconEntry.type] : null;
  /** 没步骤时传一个空壳 + enabled=false：hook 内部不会发任何请求（保持 hook 调用顺序固定）。 */
  const iconUrl = useEntryIcon(iconEntry ?? EMPTY_ENTRY, iconEntry !== null && iconEntry.icon.kind === 'local');
  const steps = `${entryCount} 步 · ${(chain.intervalMs / 1000).toFixed(1)} 秒`;
  const detail = broken
    ? '入口都已不存在'
    : `${steps}${missingCount > 0 ? ` · ${missingCount} 项失效` : ''}${layoutCount > 0 ? ' · 记住位置' : ''}`;
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={tabIndex}
      aria-label={`连锁 ${chain.name}，${detail}`}
      title={broken ? `「${chain.name}」：${detail}` : `一键启动「${chain.name}」（${detail}）`}
      onClick={() => {
        if (!broken) onLaunch();
      }}
      onKeyDown={onKeyDown}
      className={[
        'group relative flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--card-bg)] p-2 text-center transition-colors duration-[var(--motion-fast)]',
        broken ? 'cursor-not-allowed opacity-60' : 'hover:bg-[var(--card-bg-hover)]',
        'focus-visible:shadow-[var(--ring-focus)]',
      ].join(' ')}
    >
      {iconEntry !== null && iconEntry.icon.kind === 'emoji' ? (
        <span aria-hidden className="grid h-10 w-10 place-items-center text-[26px] leading-none">
          {iconEntry.icon.char}
        </span>
      ) : iconUrl !== null ? (
        <img src={iconUrl} alt="" aria-hidden className="h-10 w-10 shrink-0 object-contain" />
      ) : iconEntry !== null && meta !== null ? (
        <IconFrame tint={meta.tint}>
          <Monogram letter={iconEntry.name.slice(0, 1).toUpperCase()} />
        </IconFrame>
      ) : (
        <IconFrame tint="var(--bg-surface-2)">
          <ListChecks size={20} strokeWidth={2} aria-hidden />
        </IconFrame>
      )}
      <span className="t-xs w-full truncate-1 text-[var(--fg)]">{chain.name}</span>
      <span className="t-2xs w-full truncate-1 text-[var(--meta)]">{detail}</span>
      {/* 悬浮才出现的「⋯」：与收藏格的悬浮星同一个位置与尺寸（常驻会让格子变吵）。 */}
      <span
        role="button"
        tabIndex={-1}
        aria-label={`「${chain.name}」操作`}
        title="更多操作"
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e);
        }}
        className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded-full text-[var(--fg-2)] group-hover:grid group-focus-within:grid"
      >
        <EllipsisVertical size={14} strokeWidth={2} aria-hidden />
      </span>
    </button>
  );
});
