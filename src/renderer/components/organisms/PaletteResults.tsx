/**
 * PaletteResults —— 快捷窗口与主窗口搜索共用的结果区（2026-10-27，1.4.0）。
 *
 * 渲染规则与快捷窗口完全一致：
 *   剪贴板置顶行 → 固定行（图标格）→ 最近打开行（图标格）→ 入口结果 → 本机程序。
 * 主窗口只是把它放进内容区，并关掉右键固定与 Alt 序号（C4 不做）。
 */
import { AppWindow, LayoutGrid, Pin, Plus, RotateCcwClock, Search, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { Button } from '../atoms/Button.tsx';
import { SourceTag } from '../atoms/Tag.tsx';
import { EmptyBlock } from '../molecules/EmptyBlock.tsx';
import { ContextMenu } from '../molecules/ContextMenu.tsx';
import { ResultRow } from '../molecules/ResultRow.tsx';
import { firstLetterOf } from '../../lib/entry.ts';
import { isPinnedHit, type PaletteHit } from '../../lib/palette-source.ts';

export interface PaletteResultsProps {
  hits: PaletteHit[];
  query: string;
  selectedIndex: number;
  onSelectIndex(i: number): void;
  iconFor(entryId: string): string | null;
  onOpen(hit: PaletteHit): void;
  /** 剪贴板新内容 / 本机程序行的「加为入口」。 */
  onAddToPersonal(hit: PaletteHit): void;
  /** 固定 / 取消固定；主窗口也传（图标格右上角的叉）。 */
  onTogglePin?(entryId: string): void;
  /** 右键固定/取消固定：主窗口 C4 不做，传 false。 */
  enablePinMenu?: boolean;
  /** 行尾 Alt+序号：只有快捷窗口支持 Alt+1..9，主窗口不显示。 */
  showAltHints?: boolean;
  /** entries=入口搜索（默认）；programs=Ctrl+Alt+F 的程序专用范围。 */
  scope?: 'entries' | 'programs';
  programScanning?: boolean;
  programError?: string | null;
  /** 团队数据为空（从未成功同步）时追加一行说明。 */
  teamUnavailable?: boolean;
  /** 空结果时的「清空搜索」（主窗口用；面板不需要）。 */
  onClear?(): void;
  /** 结果行图标尺寸：面板 16/24，主窗口 24/24。 */
  rowGlyphSize?: 16 | 24;
  rowIconSize?: 16 | 24;
  /** 主窗口用：从 runtime 取 opening/failed 态。 */
  phaseFor?(entryId: string): 'idle' | 'opening' | 'failed';
  className?: string;
}

export function PaletteResults({
  hits,
  query,
  selectedIndex,
  onSelectIndex,
  iconFor,
  onOpen,
  onAddToPersonal,
  onTogglePin,
  enablePinMenu = false,
  showAltHints = false,
  scope = 'entries',
  programScanning = false,
  programError = null,
  teamUnavailable = false,
  onClear,
  rowGlyphSize = 16,
  rowIconSize = 24,
  phaseFor,
  className = '',
}: PaletteResultsProps) {
  /** 右键菜单：位置 + 命中的那条结果。菜单开着时 Esc 只收菜单，不收起面板。 */
  const [menu, setMenu] = useState<{ x: number; y: number; hit: PaletteHit } | null>(null);

  /* Esc 先收菜单、再收面板：用捕获阶段截住，面板的 onKeyDown 就不会跟着把整面关掉。
     （ContextMenu 自己也在 window 上监听 Esc；这里主动 setMenu(null) 后它会随卸载一起清理。） */
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu]);

  const clipHits = hits.filter(isPinnedHit);
  const fixedHits = hits.filter((h) => h.kind === 'pinned');
  const recentHits = hits.filter((h) => h.kind === 'recent');
  const systemHits = hits.filter((h) => h.kind === 'system');
  const resultHits = hits.filter((h) => !isPinnedHit(h) && (h.kind === undefined || h.kind === 'result'));
  const hitIndex = (hit: PaletteHit): number => hits.indexOf(hit);
  const emptyQuery = query.length === 0;
  const programScope = scope === 'programs';

  /** 右键菜单：固定 / 取消固定。剪贴板新内容与本机程序没有真实入口 id，不提供固定。 */
  const openMenu = (e: MouseEvent, hit: PaletteHit): void => {
    if (!enablePinMenu || !onTogglePin) return;
    if (hit.kind === 'clip-new' || hit.kind === 'system') return;
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
        title={`${hit.entry.name}\n${hit.subtitle}${enablePinMenu ? `\n右键：${pinned ? '取消固定' : '固定到快捷栏'}` : ''}`}
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
        {/* 固定项右上角的「取消固定」按钮：常驻可见，不必再右键一次才知道怎么取消。 */}
        {pinned && onTogglePin && (
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
        glyphSize={rowGlyphSize}
        iconSize={rowIconSize}
        selected={i === selectedIndex}
        phase={phaseFor?.(hit.entry.id) ?? 'idle'}
        onOpen={() => onOpen(hit)}
        onContextMenu={(e) => openMenu(e, hit)}
        trailing={
          <span className="flex shrink-0 items-center gap-2">
            <SourceTag source={hit.source} />
            {hit.kind === 'system' && (
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
            )}
            {showAltHints && (
              <span className="t-2xs t-mono text-[var(--meta)]">{i < 9 ? `Alt+${i + 1}` : ''}</span>
            )}
          </span>
        }
      />
    );
  };

  return (
    <>
      {/* 点结果时不要抢走搜索框焦点：主窗口的"快速打开"依赖聚焦态；
          不阻止 mousedown 的话，输入框先失焦 → 面板在 click 之前就被卸载，点了个空。 */}
      <div
        className={['tl-scroll min-h-0 flex-1 overflow-y-auto', className].filter(Boolean).join(' ')}
        role="listbox"
        aria-label="搜索结果"
        onMouseDown={(e) => e.preventDefault()}
      >
        {hits.length === 0 ? (
          programScope ? (
            <EmptyBlock
              compact
              icon={Search}
              title={query.length === 0 ? '输入程序名搜索本机程序' : `没有找到「${query}」相关的程序`}
              detail={
                programError ??
                (programScanning
                  ? '正在索引开始菜单里的程序…'
                  : '只索引开始菜单里的快捷方式；没有快捷方式的软件不会出现在这里，也可以到「我的入口」里手动添加。')
              }
            />
          ) : query.length === 0 ? (
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
              detail="换个词试试；本机程序只索引开始菜单里的快捷方式"
              actions={
                onClear ? (
                  <Button tone="ghost" onClick={onClear}>
                    清空搜索
                  </Button>
                ) : undefined
              }
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
                  glyphSize={rowGlyphSize}
                  iconSize={rowIconSize}
                  selected={i === selectedIndex}
                  phase={phaseFor?.(hit.entry.id) ?? 'idle'}
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
              : /* 搜索结果：入口沿用"前 6 条图标格 + 其余列表"，本机程序单独一段列表。 */
                (resultHits.length > 0 || systemHits.length > 0) && (
                  <>
                    {resultHits.length > 0 && (
                      <>
                        {systemHits.length > 0 && sectionLabel('入口', LayoutGrid)}
                        {tileGrid(resultHits.slice(0, 6), false)}
                        {resultHits.slice(6).map(renderResultRow)}
                      </>
                    )}
                    {systemHits.length > 0 && (
                      <>
                        {sectionLabel('本机程序', AppWindow)}
                        {systemHits.map(renderResultRow)}
                      </>
                    )}
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

      {menu !== null && onTogglePin && (
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
    </>
  );
}
