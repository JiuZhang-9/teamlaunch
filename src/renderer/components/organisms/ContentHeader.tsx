/**
 * ContentHeader —— 内容区顶部 48px 一行：搜索 · 类型筛选 · 刷新。
 *
 * 侧栏化定稿（2026-10-02）：同步状态移入左下角工作区弹层（SyncIndicator 不再在这里，
 * 且个人页本就禁止同步字样）；这一行只留"作用于当前页内容"的东西，
 * 搜索框因此能从原来被挤压的 120–280px 放宽到最多 420px。
 * Ctrl+F 由外壳派发 `tl:focus-search`，这里负责聚焦并全选。
 */
import { ListChecks, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../atoms/Button.tsx';
import { SearchInput } from '../atoms/SearchInput.tsx';
import { TypeFilterButton } from './TypeFilterButton.tsx';
import { syncPresentation } from '../../services/syncCopy.ts';
import type { SyncSnapshot } from '../../bridge/types.ts';
import type { EntryType } from '../../../shared/schema/entry.ts';
import type { TabKey } from '../../store/workbenchStore.tsx';

export interface ContentHeaderProps {
  tab: TabKey;
  /** editing 时隐藏类型筛选（编辑态拖拽排序期间改可见性会让落点错位）。 */
  mode: 'team' | 'editing' | 'personal';
  query: string;
  onQueryChange(v: string): void;
  snapshot: SyncSnapshot | null;
  onRefresh(): void;
  typeFilter: EntryType[];
  onToggleTypeFilter(t: EntryType): void;
  onClearTypeFilter(): void;
  /** 多选连锁启动（2026-10-05）：仅团队只读/个人页提供；编辑态有自己的操作体系。 */
  selecting?: boolean;
  onToggleSelecting?(): void;
}

export function ContentHeader(props: ContentHeaderProps) {
  const { tab, mode, query, onQueryChange, snapshot, onRefresh, typeFilter, onToggleTypeFilter, onClearTypeFilter, selecting, onToggleSelecting } =
    props;
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onFocusSearch = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('tl:focus-search', onFocusSearch);
    return () => window.removeEventListener('tl:focus-search', onFocusSearch);
  }, []);

  const canRefresh = snapshot ? syncPresentation(snapshot).refreshEnabled : true;

  return (
    <div
      className="flex h-[var(--content-header-h)] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-[var(--space-6)]"
      style={{ background: 'var(--bg-surface)' }}
    >
      <SearchInput
        ref={searchRef}
        variant="toolbar"
        /* 上限 420（原工具栏只有 280）：侧栏化后横向空间由内容区独占，搜索是最大的受益者。 */
        className="min-w-[160px] max-w-[420px] flex-1"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        aria-label="搜索入口"
        placeholder={tab === 'team' ? '搜索团队入口' : '搜索我的入口'}
      />

      <div className="flex-1" />

      {mode !== 'editing' && (
        <>
          <TypeFilterButton value={typeFilter} onToggle={onToggleTypeFilter} onClear={onClearTypeFilter} />
          <Button
            tone="ghost"
            icon={ListChecks}
            selected={selecting}
            aria-label="多选连锁启动"
            onClick={onToggleSelecting}
          >
            多选
          </Button>
        </>
      )}

      {mode !== 'personal' && (
        <Button
          tone="ghost"
          icon={RefreshCw}
          iconSize={20}
          aria-label="刷新团队入口"
          softDisabled={!canRefresh}
          onClick={onRefresh}
        />
      )}
    </div>
  );
}
