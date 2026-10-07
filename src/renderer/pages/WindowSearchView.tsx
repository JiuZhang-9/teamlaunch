/**
 * V-04 窗口内搜索结果。
 *
 * 三条纪律：
 *  - 搜索**只作用于当前 Tab**（跨 Tab 混合会让用户搞不清搜到的东西属于谁）；
 *  - 防抖 120ms 内保留上一次结果，不闪空；
 *  - Enter 打开后**不关闭搜索态**（用户经常要连开好几个入口）。
 * 行分隔线左缩进 60px 对齐文字起点——贴边的分隔线会让列表看起来像廉价表格。
 */
import { Search } from 'lucide-react';
import { Button } from '../components/atoms/Button.tsx';
import { EmptyBlock } from '../components/molecules/EmptyBlock.tsx';
import { ResultRow } from '../components/molecules/ResultRow.tsx';
import { TypeTag } from '../components/atoms/Tag.tsx';
import { TYPE_META } from '../lib/entry.ts';
import type { EntryRuntime } from '../store/workbenchStore.tsx';
import type { Entry } from '../../shared/schema/entry.ts';

export interface SearchHit {
  entry: Entry;
  groupName: string;
}

export interface WindowSearchViewProps {
  query: string;
  hits: SearchHit[];
  /** 防抖未完成：计数行显示「搜索中…」，但旧结果保留 */
  debouncing: boolean;
  tabLabel: string;
  icons: Record<string, string | null>;
  runtime: Record<string, EntryRuntime>;
  selectedIndex: number;
  onSelectIndex(i: number): void;
  onOpen(hit: SearchHit): void;
  onClear(): void;
}

export function WindowSearchView({
  query, hits, debouncing, tabLabel, icons, runtime, selectedIndex, onSelectIndex, onOpen, onClear,
}: WindowSearchViewProps) {
  if (hits.length === 0 && !debouncing) {
    return (
      <div className="flex h-full items-center">
        <EmptyBlock
          icon={Search}
          title={`没有找到「${query}」相关的入口`}
          detail="换个词试试，也可以在我的入口里添加"
          actions={
            <Button tone="ghost" onClick={onClear}>
              清空搜索
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <p className="t-2xs mb-2 shrink-0 text-[var(--muted)]" aria-live="polite">
        {debouncing ? '搜索中…' : `找到 ${hits.length} 个入口 · ${tabLabel}`}
      </p>
      <div
        role="listbox"
        aria-label="搜索结果"
        className="tl-scroll min-h-0 flex-1 overflow-y-auto"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selectedIndex < hits.length - 1) onSelectIndex(selectedIndex + 1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selectedIndex > 0) onSelectIndex(selectedIndex - 1);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = hits[selectedIndex];
            if (hit) onOpen(hit);
          } else if (e.altKey && /^[1-9]$/.test(e.key)) {
            e.preventDefault();
            const hit = hits[Number(e.key) - 1];
            if (hit) onOpen(hit);
          }
        }}
      >
        {hits.map((hit, i) => {
          const rt = runtime[hit.entry.id];
          return (
            <div key={hit.entry.id}>
              {/* 行分隔线左缩进 60px：对齐文字起点而不是贴边 */}
              {i > 0 && <div aria-hidden className="ml-[60px] h-px bg-[var(--border-subtle)]" />}
              <ResultRow
                entry={hit.entry}
                subtitle={`${TYPE_META[hit.entry.type].label} · ${hit.groupName}`}
                iconUrl={icons[hit.entry.id] ?? null}
                glyphSize={24}
                iconSize={24}
                selected={i === selectedIndex}
                phase={rt?.phase === 'opening' ? 'opening' : rt?.phase === 'failed' ? 'failed' : 'idle'}
                onOpen={() => onOpen(hit)}
                trailing={<TypeTag label={TYPE_META[hit.entry.type].label} />}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
