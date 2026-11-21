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
 *
 * 1.8.7（2026-11-15）：从「替换整个内容区」改成「顶部浮层卡」——外壳把本组件装进一张
 * 限高（面板 50%）的圆角卡片，底下当前页透出并被遮罩压暗。因此根节点从 h-full 换成
 * flex-1 min-h-0（高度由卡片约束，超出时 PaletteResults 自己滚动），并自带卡内边距。
 */
import { PaletteResults } from '../components/organisms/PaletteResults.tsx';
import type { PaletteHit } from '../lib/palette-source.ts';
import { useSettings } from '../store/settingsStore.tsx';
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
  /** 最近打开记录总数（含被开关隐藏的直接项）：标题行与「已隐藏」提示用。 */
  recentCount: number;
  onClear(): void;
  programScanning: boolean;
  programError: string | null;
  teamUnavailable: boolean;
  /** 收藏拖拽排序（1.10.0）：传拖动后的可见收藏 id 顺序给主进程。 */
  onReorderFavorites?(orderedIds: string[]): void;
  /** 网页搜索（1.11.0）：查询非空且不像网址/路径时，结果区底部显示一行。 */
  webSearch?: { query: string; engine?: string; onRun(): void };
}

export function WindowSearchView({
  query, hits, debouncing, quickAccess, tabLabel, icons, runtime, selectedIndex, onSelectIndex, onOpen, onAddToPersonal, recentCount, onClear,
  programScanning, programError, teamUnavailable, onReorderFavorites, webSearch,
}: WindowSearchViewProps) {
  const { settings, patch } = useSettings();
  return (
    <div data-tl-search-surface className="flex min-h-0 flex-1 flex-col px-3 pb-1 pt-3">
      <p className="t-2xs mb-2 shrink-0 px-2 text-[var(--muted)]" aria-live="polite">
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
        recentCount={recentCount}
        recentIncludeUnlisted={settings.recentIncludeUnlisted}
        onToggleRecentIncludeUnlisted={(next) => void patch({ recentIncludeUnlisted: next })}
        enableFavoriteMenu={false}
        showAltHints={false}
        scope="entries"
        /* 方格模式（1.9.0）：86×86 正方格自适应列数，一行放更多（用户反馈扁格太宽）。 */
        tileSquare
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
        onReorderFavorites={onReorderFavorites}
        webSearch={webSearch}
      />
    </div>
  );
}
