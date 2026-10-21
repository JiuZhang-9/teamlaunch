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
import { ChevronDown, ChevronUp, LayoutGrid, Pin, Plus, RotateCcwClock, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { SearchInput } from '../atoms/SearchInput.tsx';
import { Button } from '../atoms/Button.tsx';
import { EmptyBlock } from '../molecules/EmptyBlock.tsx';
import { ResultRow } from '../molecules/ResultRow.tsx';
import { ContextMenu } from '../molecules/ContextMenu.tsx';
import { SourceTag } from '../atoms/Tag.tsx';
import { firstLetterOf } from '../../lib/entry.ts';
import type { Entry } from '../../../shared/schema/entry.ts';

/**
 * 行的种类（默认 result）：
 *  - `clip-new`      剪贴板里的内容**还不在清单里**：回车=直接打开，Ctrl+回车/行尾按钮=加为入口；
 *  - `clip-existing` 剪贴板里的内容**已经是清单里的某一条**：置顶显示，回车=直接打开（快捷进入）；
 *  - `pinned`        用户手动固定的入口（空查询的「固定」行）；
 *  - `recent`        最近打开（空查询的「最近打开」行）。
 * 前两者算"剪贴板置顶行"，排在最上面。
 */
export type PaletteHitKind = 'result' | 'clip-new' | 'clip-existing' | 'pinned' | 'recent';

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
  /** 固定 / 取消固定（右键菜单与固定格右上角的叉）。 */
  onTogglePin(entryId: string): void;
  /** 团队数据为空（从未成功同步）时追加一行说明 */
  teamUnavailable: boolean;
  /**
   * docked = 渲染在独立面板窗口里：面板铺满窗口，不再做居中浮层
   * （overlay 形态供主窗口内唤起用；两种形态共用同一套键盘与结果逻辑）。
   */
  docked?: boolean;
}

export function MiniPalette(props: MiniPaletteProps) {
  const {
    open, query, onQueryChange, hits, selectedIndex, onSelectIndex, iconFor, onOpen, onAddToPersonal, onEnterMain, onClose, onTogglePin,
    teamUnavailable, docked = false,
  } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** 右键菜单：位置 + 命中的那条结果。菜单开着时 Esc 只收菜单，不收起面板。 */
  const [menu, setMenu] = useState<{ x: number; y: number; hit: PaletteHit } | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      setMenu(null);
    }
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && menu !== null) {
      // 先收菜单：用户按 Esc 想关的是眼前这个菜单，不是整个面板。
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      /* ←/→ 与 ↑/↓ 都能移动选中项（2026-10-19 用户要求："变成按钮后，上下左右方向键是否也可以调整选中项"）：
         图标格是一行，左右是它的自然轴；上下继续沿用原来的线性游标（进入下方列表）。 */
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex + 1) % hits.length);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex - 1 + hits.length) % hits.length);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      /* Ctrl+Tab（2026-10-19 用户改键，原 Ctrl+M）：收起面板并把主窗口拿到前台，
         不依赖选中项、不改动任何数据。必须排在下面 Tab 分支之前判定。 */
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

  /* 视觉分段（2026-10-21 用户要求：空查询分「固定」与「最近打开」两行）：
     剪贴板置顶行 → 固定行 → 最近打开行 → 其余结果。
     键盘游标仍走完整的 hits 顺序，与视觉从上到下一致。 */
  const clipHits = hits.filter(isPinnedHit);
  const fixedHits = hits.filter((h) => h.kind === 'pinned');
  const recentHits = hits.filter((h) => h.kind === 'recent');
  const resultHits = hits.filter((h) => !isPinnedHit(h) && (h.kind === undefined || h.kind === 'result'));
  const hitIndex = (hit: PaletteHit): number => hits.indexOf(hit);
  const emptyQuery = query.length === 0;

  /** 右键菜单：固定 / 取消固定。剪贴板新内容没有真实入口 id，不提供固定。 */
  const openMenu = (e: MouseEvent, hit: PaletteHit): void => {
    if (hit.kind === 'clip-new') return;
    e.preventDefault();
    onSelectIndex(hitIndex(hit));
    setMenu({ x: e.clientX, y: e.clientY, hit });
  };

  const sectionLabel = (label: string, Icon: typeof Pin) => (
    <div className="flex items-center gap-1.5 px-3 py-1 t-2xs text-[var(--muted)]">
      <Icon size={16} strokeWidth={2} aria-hidden />
      {label}
    </div>
  );

  const renderTile = (hit: PaletteHit, pinned: boolean) => {
    const i = hitIndex(hit);
    const selected = i === selectedIndex;
    const iconUrl = iconFor(hit.entry.id);
    return (
      <div
        key={hit.entry.id}
        id={`tl-palette-tile-${i}`}
        role="button"
        tabIndex={-1}
        aria-label={`${hit.entry.name}（${hit.source}）`}
        title={`${hit.entry.name}\n${hit.subtitle}\n右键：${pinned ? '取消固定' : '固定到快捷栏'}`}
        onClick={() => onOpen(hit)}
        onMouseEnter={() => onSelectIndex(i)}
        onContextMenu={(e) => openMenu(e, hit)}
        className="group relative flex h-[86px] w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-md)] border px-1 pt-2 transition-colors duration-[var(--motion-fast)]"
        style={{
          borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
          background: selected ? 'var(--accent-tint)' : 'var(--card-bg)',
        }}
      >
        {iconUrl !== null ? (
          <img src={iconUrl} alt="" aria-hidden className="h-8 w-8 shrink-0 object-contain" />
        ) : (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] t-sm"
            style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}
            aria-hidden
          >
            {firstLetterOf(hit.entry.name)}
          </span>
        )}
        {/* 两行名（超出裁掉）：中文名 6~8 字一行，两行够放绝大多数入口名。 */}
        <span className="t-2xs line-clamp-2 w-full text-center leading-tight text-[var(--fg-2)]">
          {hit.entry.name}
        </span>
        {/* 固定项右上角的「取消固定」按钮（2026-10-21 用户要求）：常驻可见，
            不必再右键一次才知道怎么取消。 */}
        {pinned && (
          <button
            type="button"
            aria-label={`取消固定 ${hit.entry.name}`}
            title="取消固定"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(hit.entry.id);
            }}
            onContextMenu={(e) => e.stopPropagation()}
            className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--fg)]"
          >
            <X size={12} strokeWidth={2.5} aria-hidden />
          </button>
        )}
      </div>
    );
  };

  const tileGrid = (list: PaletteHit[], pinned: boolean) => (
    <div className="grid grid-cols-6 gap-1.5 px-2 pb-1.5 pt-1">
      {list.map((hit) => renderTile(hit, pinned))}
    </div>
  );

  /** 搜索结果行（图标格之后的剩余项）：带来源标签与 Alt 序号。 */
  const renderResultRow = (hit: PaletteHit) => {
    const i = hitIndex(hit);
    return (
      <ResultRow
        key={hit.entry.id}
        id={`tl-palette-hit-${i}`}
        entry={hit.entry}
        subtitle={hit.subtitle}
        iconUrl={iconFor(hit.entry.id)}
        glyphSize={16}
        iconSize={24}
        selected={i === selectedIndex}
        onOpen={() => onOpen(hit)}
        onContextMenu={(e) => openMenu(e, hit)}
        trailing={
          <span className="flex shrink-0 items-center gap-2">
            <SourceTag source={hit.source} />
            <span className="t-2xs t-mono text-[var(--meta)]">Alt+{i + 1}</span>
          </span>
        }
      />
    );
  };

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
              {/* 剪贴板置顶行（列表形态：带「加为入口」按钮，是操作行不是浏览行）。 */}
              {clipHits.map((hit) => {
                const i = hitIndex(hit);
                return (
                  <ResultRow
                    key={hit.entry.id}
                    id={`tl-palette-hit-${i}`}
                    entry={hit.entry}
                    subtitle={hit.subtitle}
                    iconUrl={iconFor(hit.entry.id)}
                    glyphSize={16}
                    iconSize={24}
                    selected={i === selectedIndex}
                    onOpen={() => onOpen(hit)}
                    onContextMenu={(e) => openMenu(e, hit)}
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
                      ) : (
                        <span className="flex shrink-0 items-center gap-2">
                          <SourceTag source="剪贴板" />
                        </span>
                      )
                    }
                  />
                );
              })}

              {emptyQuery && fixedHits.length > 0 && (
                <>
                  {sectionLabel('固定', Pin)}
                  {tileGrid(fixedHits, true)}
                </>
              )}

              {emptyQuery && recentHits.length > 0 && (
                <>
                  {sectionLabel('最近打开', RotateCcwClock)}
                  {tileGrid(recentHits, false)}
                </>
              )}

              {emptyQuery
                ? resultHits.length > 0
                  ? /* 空查询的回退结果（没有最近记录时）：仍是图标格，不贴标签——
                       标签不能说谎，它们只是清单前几条。 */
                    tileGrid(resultHits, false)
                  : null
                : /* 搜索结果：沿用"前 6 条图标格 + 其余列表"（2026-10-18 用户要求的第一行图标格）。 */
                  resultHits.length > 0 && (
                    <>
                      {tileGrid(resultHits.slice(0, 6), false)}
                      {resultHits.slice(6).map(renderResultRow)}
                    </>
                  )}
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
            并整体 nowrap——宁可裁掉尾巴，也不能折成两行糊成一团（实测过一版就这样）。 */}
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
          <span>右键固定</span>
          <span>·</span>
          <span className="w-emph">Ctrl+Tab 主窗口</span>
          <span>·</span>
          <span>Esc 收起</span>
        </div>
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.hit.kind === 'pinned'
              ? [{ id: 'unpin', label: '取消固定', onSelect: () => onTogglePin(menu.hit.entry.id) }]
              : [{ id: 'pin', label: '固定到快捷栏', onSelect: () => onTogglePin(menu.hit.entry.id) }]
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
