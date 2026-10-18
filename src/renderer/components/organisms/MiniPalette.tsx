/**
 * MiniPalette —— 迷你唤起面板（V-03）。
 *
 * 三条硬约束：
 *  1. **预热隐藏窗口**（K-D 同类）：本面板在预览里常驻挂载但 `hidden`，
 *     唤起只做显示 + 聚焦，不重新挂载组件树（冷启动必超 80ms 预算）。
 *  2. **焦点不离开输入框**：面板内只有一个输入焦点，一旦丢出去面板就失焦隐藏，
 *     所以 Tab / Shift+Tab 一律 preventDefault，改当作"下一条 / 上一条"（见 onKeyDown）。
 *  3. **本视图 100% 本地**，不得出现任何网络请求相关字样。
 */
import { ChevronDown, ChevronUp, LayoutGrid, Plus, RotateCcwClock, Search } from 'lucide-react';
import { Fragment, useEffect, useRef, type KeyboardEvent } from 'react';
import { SearchInput } from '../atoms/SearchInput.tsx';
import { Button } from '../atoms/Button.tsx';
import { EmptyBlock } from '../molecules/EmptyBlock.tsx';
import { ResultRow } from '../molecules/ResultRow.tsx';
import { SourceTag } from '../atoms/Tag.tsx';
import { firstLetterOf } from '../../lib/entry.ts';
import type { Entry } from '../../../shared/schema/entry.ts';

/**
 * 行的种类（默认 result）：
 *  - `clip-new`      剪贴板里的内容**还不在清单里**：回车=直接打开，Ctrl+回车/行尾按钮=加为入口；
 *  - `clip-existing` 剪贴板里的内容**已经是清单里的某一条**：置顶显示，回车=直接打开（快捷进入）；
 * 两者都算"置顶行"，空查询的「最近打开」标签要排在它们后面。
 */
export type PaletteHitKind = 'result' | 'clip-new' | 'clip-existing';

/** 图标格最多几条（560px 宽一行放得下 8 个 56px 的格子）。 */
const STRIP_MAX = 8;

export interface PaletteHit {
  entry: Entry;
  subtitle: string;
  source: '团队' | '本机';
  kind?: PaletteHitKind;
}

/** 置顶行 = 剪贴板候选行（两类都算）。 */
export function isPinnedHit(hit: PaletteHit | undefined): boolean {
  return hit?.kind === 'clip-new' || hit?.kind === 'clip-existing';
}

export interface MiniPaletteProps {
  open: boolean;
  query: string;
  onQueryChange(v: string): void;
  hits: PaletteHit[];
  selectedIndex: number;
  onSelectIndex(i: number): void;
  iconFor(entryId: string): string | null;
  onOpen(hit: PaletteHit): void;
  /** 剪贴板候选行的「加为入口」：走主窗口那套预填编辑器（Ctrl+回车 / 行尾按钮）。 */
  onAddToPersonal(hit: PaletteHit): void;
  /** Ctrl+回车（非剪贴板行）＝进入主窗口；面板窗口由调用方收起。 */
  onEnterMain(): void;
  onClose(): void;
  /** 团队数据为空（从未成功同步）时追加一行说明 */
  teamUnavailable: boolean;
  /**
   * 空查询时结果段前的分组标签（例如「最近打开」）。
   * 没有最近打开、正在回退显示清单前几条时传 null——标签必须如实描述这批结果是什么。
   */
  emptyQueryLabel?: string | null;
  /**
   * docked = 渲染在独立面板窗口里：面板铺满窗口，不再做居中浮层
   * （overlay 形态供主窗口内唤起用；两种形态共用同一套键盘与结果逻辑）。
   */
  docked?: boolean;
}

export function MiniPalette(props: MiniPaletteProps) {
  const {
    open, query, onQueryChange, hits, selectedIndex, onSelectIndex, iconFor, onOpen, onAddToPersonal, onEnterMain, onClose, teamUnavailable,
    emptyQueryLabel = null, docked = false,
  } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex - 1 + hits.length) % hits.length);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'm' || e.key === 'M')) {
      /* Ctrl+M（2026-10-18 用户要求"调出面板后能一键进入主窗口"）：
         不依赖选中项、不改动任何数据，只是收起面板并把主窗口拿到前台。
         键位与底部提示一致——提示写什么就必须是什么（这个项目栽过"写死键位"的跟头）。 */
      e.preventDefault();
      onEnterMain();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) {
        // 剪贴板候选行：回车就是"直接打开"，**绝不弹任何窗口**；
        // 加为入口是第二个动作（Ctrl+回车），与回车分开，避免误触编辑器。
        if (hit.kind === 'clip-new' && (e.ctrlKey || e.metaKey)) onAddToPersonal(hit);
        else onOpen(hit);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // 焦点不能离开输入框（丢出去面板就失焦隐藏），所以仍然吃掉默认行为；
      // 但 Shift+Tab 反向也一样——左手留在输入区就能上下选择（同 ↑↓ 的循环游标）。
      e.preventDefault();
      if (hits.length) {
        const dir = e.shiftKey ? -1 : 1;
        onSelectIndex((selectedIndex + dir + hits.length) % hits.length);
      }
    } else if (e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const hit = hits[Number(e.key) - 1];
      if (hit) onOpen(hit);
    }
  };

  /* 第一行按图标显示（2026-10-18 用户要求："目前是列表形式，显示内容较少，希望第一行能按图标显示"）：
     非剪贴板候选的前 8 条做成一行图标格（图标 + 单行名），剩下的继续走列表。
     剪贴板置顶行**不放进格子**——那两行带「加为入口」按钮，是操作行不是浏览行。
     键盘游标仍走完整的 hits 顺序（上行 = 置顶行，图标格，列表），与视觉从上到下一致。 */
  const pinnedHits = hits.filter(isPinnedHit);
  const restHits = hits.filter((h) => !isPinnedHit(h));
  const stripHits = restHits.slice(0, STRIP_MAX);
  const listHits = [...pinnedHits, ...restHits.slice(STRIP_MAX)];
  const hitIndex = (hit: PaletteHit): number => hits.indexOf(hit);

  /** 「最近打开」标签：图标格存在时标在格子上面，否则沿用列表里的插位。 */
  const labelAboveStrip = query.length === 0 && emptyQueryLabel !== null && stripHits.length > 0;
  const labelAt = pinnedHits.length;

  return (
    <div
      className="absolute inset-0 z-[var(--z-drag)]"
      onKeyDown={onKeyDown}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="迷你唤起面板"
        className={[
          'absolute flex flex-col overflow-hidden p-[var(--space-2)]',
          docked ? 'inset-0' : 'left-1/2 rounded-[var(--radius-xl)] border border-[var(--border-subtle)]',
        ].join(' ')}
        style={
          docked
            ? { background: 'var(--bg-overlay)' }
            : {
                width: 'var(--palette-w)',
                maxHeight: 'var(--palette-h)',
                transform: 'translateX(-50%)',
                top: '18vh',
                background: 'var(--bg-overlay)',
                boxShadow: 'var(--elev-3)',
              }
        }
      >
        <SearchInput
          ref={inputRef}
          variant="palette"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="搜索入口、分组或路径"
          placeholder="搜索入口、分组或路径"
        />
        <div className="mt-2 h-px w-full bg-[var(--border-subtle)]" />

        <div className="tl-scroll min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="搜索结果">
          {hits.length === 0 ? (
            query.length === 0 ? (
              /* 清单完全为空（团队 + 我的入口都没有内容）：这不是"没搜到"，
                 而是"还没有东西可开"，所以如实说清楚去哪里加。 */
              <EmptyBlock
                compact
                icon={LayoutGrid}
                title="还没有可打开的入口"
                detail="在「我的入口」里添加软件、文件夹或网页；复制的网址或路径在这里也能直接打开。"
              />
            ) : (
              <EmptyBlock
                compact
                icon={Search}
                title={`没有找到「${query}」相关的入口`}
                detail="换个词试试，或到我的入口里添加"
              />
            )
          ) : (
            <>
              {stripHits.length > 0 && (
                <>
                  {labelAboveStrip && (
                    <div className="flex items-center gap-1.5 px-3 py-1 t-2xs text-[var(--muted)]">
                      <RotateCcwClock size={16} strokeWidth={2} aria-hidden />
                      {emptyQueryLabel}
                    </div>
                  )}
                  {/* 第一行图标格：图标 + 单行名（hover/选中态与卡片页一致：tint 底 + accent 边）。 */}
                  <div className="flex flex-wrap gap-1 px-2 pb-1 pt-0.5">
                    {stripHits.map((hit) => {
                      const i = hitIndex(hit);
                      const selected = i === selectedIndex;
                      const iconUrl = iconFor(hit.entry.id);
                      return (
                        <button
                          key={hit.entry.id}
                          id={`tl-palette-tile-${i}`}
                          type="button"
                          aria-label={`${hit.entry.name}（${hit.source}）`}
                          title={`${hit.entry.name}\n${hit.subtitle}`}
                          onClick={() => onOpen(hit)}
                          onMouseEnter={() => onSelectIndex(i)}
                          className="flex h-[62px] w-[62px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[var(--radius-md)] border px-1 transition-colors duration-[var(--motion-fast)]"
                          style={{
                            borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
                            background: selected ? 'var(--accent-tint)' : 'var(--card-bg)',
                          }}
                        >
                          {iconUrl !== null ? (
                            <img src={iconUrl} alt="" aria-hidden className="h-6 w-6 shrink-0 object-contain" />
                          ) : (
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] t-2xs" style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }} aria-hidden>
                              {firstLetterOf(hit.entry.name)}
                            </span>
                          )}
                          <span className="t-2xs w-full truncate-1 text-center text-[var(--fg-2)]">{hit.entry.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {listHits.map((hit) => {
                const i = hitIndex(hit);
                return (
                <Fragment key={hit.entry.id}>
                  {!labelAboveStrip && query.length === 0 && emptyQueryLabel !== null && i === labelAt && (
                    <div className="flex items-center gap-1.5 px-3 py-1 t-2xs text-[var(--muted)]">
                      <RotateCcwClock size={16} strokeWidth={2} aria-hidden />
                      {emptyQueryLabel}
                    </div>
                  )}
                  <ResultRow
                    id={`tl-palette-hit-${i}`}
                    entry={hit.entry}
                    subtitle={hit.subtitle}
                    iconUrl={iconFor(hit.entry.id)}
                    glyphSize={16}
                    iconSize={24}
                    selected={i === selectedIndex}
                    onOpen={() => onOpen(hit)}
                    trailing={
                      hit.kind === 'clip-new' ? (
                        <span className="flex shrink-0 items-center gap-2">
                          <SourceTag source="剪贴板" />
                          {/* 加为入口是**第二个动作**：回车永远是"直接打开"，不占回车键。 */}
                          <Button
                            tone="ghost"
                            size="sm"
                            icon={Plus}
                            aria-label="加为入口"
                            title="加为入口（Ctrl+回车）"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddToPersonal(hit);
                            }}
                          />
                        </span>
                      ) : hit.kind === 'clip-existing' ? (
                        <span className="flex shrink-0 items-center gap-2">
                          <SourceTag source="剪贴板" />
                        </span>
                      ) : (
                        <span className="flex shrink-0 items-center gap-2">
                          <SourceTag source={hit.source} />
                          <span className="t-2xs t-mono text-[var(--meta)]">Alt+{i + 1}</span>
                        </span>
                      )
                    }
                  />
                </Fragment>
                );
              })}
            </>
          )}
          {teamUnavailable && (
            <p className="px-3 py-1 t-2xs text-[var(--meta)]">
              团队入口还没有同步，当前只显示我的入口
            </p>
          )}
        </div>

        <div className="mt-1 h-px w-full bg-[var(--border-subtle)]" />
        {/* 560px 的面板放不下更多字了：文案按实测收短（"直接打开"→"直开"），
            并整体 nowrap——宁可裁掉尾巴，也不能折成两行糊成一团（实测过一版就这样）。
            2026-10-18 加「Ctrl+M 主窗口」：把"进入主窗口"做成看得见的键位（用户要求的快捷方法）。 */}
        <div className="flex h-9 items-center gap-1.5 overflow-hidden whitespace-nowrap px-3 t-2xs text-[var(--meta)]">
          <ChevronUp size={16} strokeWidth={2} aria-hidden />
          <ChevronDown size={16} strokeWidth={2} aria-hidden />
          <span>选择</span>
          <span className="mx-1">·</span>
          <span>Tab 切换</span>
          <span className="mx-1">·</span>
          <span>⏎ 打开</span>
          <span className="mx-1">·</span>
          <span>Ctrl+⏎ 加入口</span>
          <span>·</span>
          <span>Alt+1…7 直开</span>
          <span>·</span>
          <span className="w-emph">Ctrl+M 主窗口</span>
          <span>·</span>
          <span>Esc 收起</span>
        </div>
      </div>
    </div>
  );
}
