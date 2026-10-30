/**
 * V-04 窗口内搜索结果。
 *
 * 三条纪律：
 *  - 入口搜索**只作用于当前 Tab**（跨 Tab 混合会让用户搞不清搜到的东西属于谁）；
 *  - 防抖 120ms 内保留上一次结果，不闪空；
 *  - Enter 打开后**不关闭搜索态**（用户经常要连开好几个入口）。
 *
 * 1.4.0（2026-10-27）：结果区改用与快捷窗口共用的 `PaletteResults`——
 * 剪贴板候选、收藏、最近打开、本机程序与面板走同一套构造与去重逻辑。
 * 主窗口不做右键收藏与 Alt+序号（用户明确 C4 不做）。
 */
import { PaletteResults } from '../components/organisms/PaletteResults.tsx';
import type { PaletteHit } from '../lib/palette-source.ts';
import type { EntryRuntime } from '../store/workbenchStore.tsx';

export interface WindowSearchViewProps {
  query: string;
  hits: PaletteHit[];
  /** 防抖未完成：计数行显示「搜索中…」，但旧结果保留 */
  debouncing: boolean;
  /** 搜索框聚焦且还没输入：显示收藏 / 最近打开的图标格。 */
  quickAccess: boolean;
  tabLabel: string;
  icons: Record<string, string | null>;
  runtime: Record<string, EntryRuntime>;
  selectedIndex: number;
  onSelectIndex(i: number): void;
  onOpen(hit: PaletteHit): void;
  /** 剪贴板新内容 / 本机程序行的「加为入口」。 */
  onAddToPersonal(hit: PaletteHit): void;
  onClear(): void;
  programScanning: boolean;
  programError: string | null;
  teamUnavailable: boolean;
}

export function WindowSearchView({
  query, hits, debouncing, quickAccess, tabLabel, icons, runtime, selectedIndex, onSelectIndex, onOpen, onAddToPersonal, onClear,
  programScanning, programError, teamUnavailable,
}: WindowSearchViewProps) {
  return (
    <div data-tl-search-surface className="flex h-full flex-col">
      <p className="t-2xs mb-2 shrink-0 text-[var(--muted)]" aria-live="polite">
        {debouncing
          ? '搜索中…'
          : quickAccess
            ? '输入名称搜索入口和本机程序'
            : `找到 ${hits.length} 个结果 · ${tabLabel}`}
      </p>
      <PaletteResults
        hits={hits}
        query={query}
        selectedIndex={selectedIndex}
        onSelectIndex={onSelectIndex}
        iconFor={(id) => icons[id] ?? null}
        onOpen={onOpen}
        onAddToPersonal={onAddToPersonal}
        enableFavoriteMenu={false}
        showAltHints={false}
        scope="entries"
        programScanning={programScanning}
        programError={programError}
        teamUnavailable={teamUnavailable}
        onClear={onClear}
        rowGlyphSize={24}
        rowIconSize={24}
        phaseFor={(id) => {
          const rt = runtime[id];
          return rt?.phase === 'opening' ? 'opening' : rt?.phase === 'failed' ? 'failed' : 'idle';
        }}
      />
    </div>
  );
}
