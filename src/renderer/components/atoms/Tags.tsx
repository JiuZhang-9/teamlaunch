/**
 * 三个标签类原子：Badge（计数）/ TypeTag（类型文字）/ SourceTag（来源：团队 / 本机）。
 *
 * AC-03 要求关闭颜色后仍可区分类型 —— TypeTag 的类型**文字**是第二通道，
 * 卡片上另有 12px 类型角标图标作为第一通道，tint 只是第三通道。
 */
import type { ReactNode } from 'react';
import { TYPE_META, targetSummary } from '../../lib/entry.ts';
import type { Entry } from '../../../shared/schema/entry.ts';

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'accent' }) {
  return (
    <span
      className={[
        'inline-flex h-5 items-center rounded-sm px-1.5 t-2xs w-emph',
        tone === 'accent'
          ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]'
          : 'bg-[var(--tag-bg)] text-[var(--tag-fg)]',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

/** 类型文字：桌面应用 / 文件夹 / 网页。文字永远显示，不依赖图标与颜色。 */
export function TypeTag({ entry }: { entry: Entry }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-[var(--tag-bg)] px-1.5 t-xs text-[var(--tag-fg)]">
      {TYPE_META[entry.type].label}
    </span>
  );
}

/** 来源标签：团队 / 本机。搜索结果与迷你面板必须显示，否则用户分不清搜到的是谁的。 */
export function SourceTag({ source }: { source: 'team' | 'personal' }) {
  return (
    <span
      className={[
        'inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 t-xs',
        source === 'team'
          ? 'bg-[var(--accent-tint)] text-[var(--accent-text)]'
          : 'bg-[var(--tag-bg)] text-[var(--tag-fg)]',
      ].join(' ')}
    >
      {source === 'team' ? '团队' : '本机'}
    </span>
  );
}

/** 副标签行（搜索态用）：类型文字 + 内容 + 分组名，与卡片副标签同源。 */
export function SubtitleLine({ entry, group }: { entry: Entry; group?: string }) {
  const head = TYPE_META[entry.type].label;
  return (
    <span className="t-xs text-[var(--muted)] truncate-1">
      {head} · {targetSummary(entry)}
      {group ? ` · ${group}` : ''}
    </span>
  );
}
