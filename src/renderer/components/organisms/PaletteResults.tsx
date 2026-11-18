/**
 * PaletteResults —— 快捷窗口与主窗口搜索共用的结果区（2026-10-27，1.4.0）。
 *
 * 渲染规则与快捷窗口完全一致：
 *   剪贴板置顶行 → 收藏行（图标格）→ 最近打开行（图标格）→ 入口结果 → 本机程序。
 * 主窗口只是把它放进内容区，并关掉右键收藏与 Alt 序号（C4 不做）。
 */
import { AppWindow, LayoutGrid, Plus, RotateCcwClock, Search, Star, X, Zap } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Glyph, IconFrame, Monogram } from '../atoms/Icon.tsx';
import { Switch } from '../atoms/Switch.tsx';
import { SourceTag } from '../atoms/Tag.tsx';
import { EmptyBlock } from '../molecules/EmptyBlock.tsx';
import { ContextMenu } from '../molecules/ContextMenu.tsx';
import { ResultRow } from '../molecules/ResultRow.tsx';
import { firstLetterOf, TYPE_META } from '../../lib/entry.ts';
import { identityTone } from '../../../shared/identity.ts';
import { isClipboardHit, type PaletteHit } from '../../lib/palette-source.ts';

export interface PaletteResultsProps {
  hits: PaletteHit[];
  query: string;
  selectedIndex: number;
  onSelectIndex(i: number): void;
  iconFor(entryId: string): string | null;
  onOpen(hit: PaletteHit): void;
  /** 剪贴板新内容 / 本机程序行的「加为入口」。 */
  onAddToPersonal(hit: PaletteHit): void;
  /** 收藏 / 取消收藏；主窗口不传（C4 不做右键，但快捷窗口图标格右上角有叉）。 */
  onToggleFavorite?(entryId: string): void;
  /** 该入口当前是否已收藏：右键菜单要据此显示「收藏」还是「取消收藏」。 */
  isFavorite?(entryId: string): boolean;
  /** 最近打开记录总数（含被开关隐藏的直接项）：>0 时标题行常驻，避免关闭后开关消失。 */
  recentCount?: number;
  /** 最近打开是否包含未加入入口的程序/文件夹/网页/连锁（与设置同一份）。 */
  recentIncludeUnlisted?: boolean;
  onToggleRecentIncludeUnlisted?(next: boolean): void;
  /** 右键收藏/取消收藏：主窗口 C4 不做，传 false。 */
  enableFavoriteMenu?: boolean;
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
  /** 图标格列数与高度：面板 7 列 × 104px，主窗口方格 86px（tileSquare）自适应列。 */
  tileColumns?: 6 | 7;
  tileHeight?: number;
  /** 方格模式（1.9.0 主窗口搜索）：每格宽=高（86px），列数按容器宽度自适应——
      同样一行能放更多内容；快捷窗口面板保持固定列数不变。 */
  tileSquare?: boolean;
  /** 图标格间距与图标尺寸：面板 8px / 36px，主窗口 6px / 32px。 */
  tileGap?: number;
  tileIconSize?: number;
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
  onToggleFavorite,
  isFavorite,
  recentCount = 0,
  recentIncludeUnlisted = true,
  onToggleRecentIncludeUnlisted,
  enableFavoriteMenu = false,
  showAltHints = false,
  scope = 'entries',
  programScanning = false,
  programError = null,
  teamUnavailable = false,
  onClear,
  rowGlyphSize = 16,
  rowIconSize = 24,
  tileColumns = 6,
  tileHeight = 86,
  tileSquare = false,
  tileGap = 6,
  tileIconSize = 32,
  phaseFor,
  className = '',
}: PaletteResultsProps) {
  /** 右键菜单：位置 + 命中的那条结果。菜单开着时 Esc 只收菜单，不收起面板。 */
  const [menu, setMenu] = useState<{ x: number; y: number; hit: PaletteHit } | null>(null);
  /**
   * 悬停只做视觉反馈（2026-11-07 用户反馈）：此前图标格的 onMouseEnter 直接写
   * selectedIndex，鼠标扫过角落的格子就会把键盘选中项抢走——剪贴板有内容时按空格
   * 本想打开剪贴板，却打开了鼠标停住的那一项。现在悬停与选中是两个独立状态：
   * 空格 / 回车只认 selectedIndex（方向键、Tab 改它），鼠标只改 hoverIndex。
   */
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  /* 结果列表变了，旧悬停下标可能指向另一项：清掉，避免高亮错位。 */
  useEffect(() => {
    setHoverIndex(null);
  }, [hits]);

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

  const clipHits = hits.filter(isClipboardHit);
  /* 连锁 hit（1.9.0）归入收藏行展示；搜索结果里也走入口结果的行/格——
     kind='chain' 若不显式进桶，会从所有渲染分支漏掉（复测实测：磁盘收藏正确、界面不显示）。 */
  const favoriteHits = hits.filter((h) => h.kind === 'favorite' || h.kind === 'chain');
  const recentHits = hits.filter((h) => h.kind === 'recent');
  const systemHits = hits.filter((h) => h.kind === 'system');
  const emptyQuery = query.length === 0;
  /* 空查询时 kind='chain' 只属于收藏行；不能再进 resultHits，否则收藏的连锁会在
     「收藏」和下面的回退网格里各画一次。搜索查询时 chain 仍走结果行/格。 */
  const resultHits = hits.filter(
    (h) => !isClipboardHit(h) && (h.kind === undefined || h.kind === 'result' || (h.kind === 'chain' && !emptyQuery)),
  );
  const hitIndex = (hit: PaletteHit): number => hits.indexOf(hit);
  const programScope = scope === 'programs';

  /** 右键菜单：收藏 / 取消收藏。剪贴板新内容与本机程序没有真实入口 id，不提供收藏。 */
  const openMenu = (e: MouseEvent, hit: PaletteHit): void => {
    if (!enableFavoriteMenu || !onToggleFavorite) return;
    if (hit.kind === 'clip-new' || hit.kind === 'system') return;
    e.preventDefault();
    onSelectIndex(hitIndex(hit));
    setMenu({ x: e.clientX, y: e.clientY, hit });
  };

  const sectionLabel = (label: string, Icon: typeof Star) => (
    <div className="flex items-center gap-1.5 px-3 py-1 t-2xs text-[var(--muted)]">
      <Icon size={16} strokeWidth={2} aria-hidden />
      {label}
    </div>
  );

  /** 连锁命中：收藏行的 kind='chain'，最近打开里的连锁是 kind='recent' + chainSteps。 */
  const isChainHit = (hit: PaletteHit): boolean => hit.kind === 'chain' || hit.chainSteps !== undefined;

  const renderTile = (hit: PaletteHit, favorited: boolean) => {
    const i = hitIndex(hit);
    const selected = i === selectedIndex;
    const hovered = i === hoverIndex;
    const iconUrl = iconFor(hit.entry.id);
    const meta = TYPE_META[hit.entry.type];
    const emoji = hit.entry.icon.kind === 'emoji' ? hit.entry.icon.char : null;
    const autoFallback = !iconUrl && !emoji;
    const tone = identityTone(hit.entry.id);
    return (
      <div
        key={hit.entry.id}
        id={`tl-palette-tile-${i}`}
        data-tl-tile={i}
        role="button"
        tabIndex={-1}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${hit.entry.name}（${isChainHit(hit) ? `连锁 · ${hit.chainSteps} 步` : hit.source}）`}
        title={`${hit.entry.name}\n${hit.subtitle}${enableFavoriteMenu && !isChainHit(hit) ? `\n右键：${favorited ? '取消收藏' : '收藏'}` : ''}`}
        onClick={() => onOpen(hit)}
        onMouseEnter={() => setHoverIndex(i)}
        onMouseLeave={() => setHoverIndex((current) => (current === i ? null : current))}
        onContextMenu={(e) => openMenu(e, hit)}
        className="group relative flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-md)] border px-1 pt-2 transition-colors duration-[var(--motion-fast)]"
        style={{
          height: tileHeight,
          /* 方格模式（1.9.0）：宽=高，固定 86px 不拉伸；列数由 tileGrid 的 auto-fill 决定。 */
          width: tileSquare ? tileHeight : undefined,
          gap: tileGap,
          borderColor: selected
            ? 'var(--accent)'
            : hovered
              ? 'var(--border-strong)'
              : 'var(--border-subtle)',
          background: selected
            ? 'var(--accent-tint)'
            : hovered
              ? 'var(--card-bg-hover)'
              : 'var(--card-bg)',
        }}
      >
        <span className="relative shrink-0">
          <IconFrame
            size={tileIconSize}
            shape={meta.shape}
            tint={autoFallback ? `var(--identity-${tone}-bg)` : meta.tint}
            fg={autoFallback ? `var(--identity-${tone}-fg)` : undefined}
          >
            {iconUrl ? (
              <img
                src={iconUrl}
                alt=""
                aria-hidden
                className="object-contain"
                style={{ width: tileIconSize, height: tileIconSize }}
              />
            ) : emoji ? (
              <span aria-hidden style={{ fontSize: tileIconSize >= 36 ? 22 : 19, lineHeight: 1 }}>
                {emoji}
              </span>
            ) : (
              <Monogram letter={firstLetterOf(hit.entry.name)} size={tileIconSize >= 36 ? 15 : 13} />
            )}
          </IconFrame>
          <span
            aria-hidden
            className="absolute -bottom-1 -right-1 grid place-items-center rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            style={{ width: 12, height: 12 }}
          >
            {/* 连锁格子用 [连锁] 徽标代替类型徽标（1.9.0；最近打开里的连锁同款）。 */}
            <Glyph icon={isChainHit(hit) ? Zap : meta.icon} size={12} micro />
          </span>
        </span>
        {/* 两行名（超出裁掉）：中文名 6~8 字一行，两行够放绝大多数入口名。 */}
        <span className="t-2xs line-clamp-2 w-full text-center leading-tight text-[var(--fg-2)]">
          {hit.entry.name}
        </span>
        {/* 收藏项右上角的「取消收藏」按钮：常驻可见，不必再右键一次才知道怎么取消。 */}
        {favorited && onToggleFavorite && (
          <button
            type="button"
            aria-label={`取消收藏 ${hit.entry.name}`}
            title="取消收藏"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(hit.entry.id);
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

  const tileGrid = (list: PaletteHit[], favorited: boolean) => (
    <div
      className={['grid gap-1.5 px-2 pb-1.5 pt-1', tileColumns === 7 ? 'grid-cols-7' : 'grid-cols-6'].join(' ')}
      style={{
        gap: tileGap,
        /* 方格模式（1.9.0 主窗口）：固定 86px 一格、列数按容器宽度自适应（内联覆盖 grid-cols 类）。 */
        gridTemplateColumns: tileSquare ? `repeat(auto-fill, ${tileHeight}px)` : undefined,
      }}
    >
      {list.map((hit) => renderTile(hit, favorited))}
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
        glyphIcon={isChainHit(hit) ? Zap : undefined}
        selected={i === selectedIndex}
        phase={phaseFor?.(hit.entry.id) ?? 'idle'}
        onOpen={() => onOpen(hit)}
        onContextMenu={(e) => openMenu(e, hit)}
        trailing={
          <span className="flex shrink-0 items-center gap-2">
            {/* 连锁行的来源标签是「连锁」而不是「本机」（1.9.0）：来源必须如实。 */}
            <SourceTag source={isChainHit(hit) ? '连锁' : hit.source} />
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
        {/* 最近记录被开关全部隐藏时 hits 会是 0，但标题行与开关必须保留——
            否则用户关掉后就地再也找不到开关。此时走下面的正常分支渲染提示。 */}
        {hits.length === 0 && !(emptyQuery && !programScope && recentCount > 0) ? (
          programScope ? (
            <EmptyBlock
              compact
              icon={Search}
              title={query.length === 0 ? '输入程序名搜索本机程序' : `没有找到「${query}」相关的程序`}
              detail={
                programError ??
                (programScanning
                  ? '正在索引开始菜单里的程序…'
                  : '只索引开始菜单里的快捷方式；没有快捷方式的软件不会出现在这里，也可以到「个人入口」里手动添加。')
              }
            />
          ) : query.length === 0 ? (
            /* 清单完全为空（团队 + 个人入口都没有内容）：这不是"没搜到"，
               而是"还没有东西可开"，所以如实说清楚去哪里加。 */
            <EmptyBlock
              compact
              icon={LayoutGrid}
              title="还没有可打开的入口"
              detail="在「个人入口」里添加软件、文件夹或网页；复制的网址或路径在这里也能直接打开。"
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

            {emptyQuery && favoriteHits.length > 0 && (
              <>
                {sectionLabel('收藏', Star)}
                {tileGrid(favoriteHits, true)}
              </>
            )}

            {emptyQuery && (recentHits.length > 0 || recentCount > 0) && (
              <>
                <div className="flex items-center justify-between gap-2 px-3 py-1">
                  <div className="flex items-center gap-1.5 t-2xs text-[var(--muted)]">
                    <RotateCcwClock size={16} strokeWidth={2} aria-hidden />
                    最近打开
                  </div>
                  {onToggleRecentIncludeUnlisted && (
                    <div className="flex items-center gap-1.5">
                      <span className="t-2xs text-[var(--meta)]">含未加入入口</span>
                      <Switch
                        checked={recentIncludeUnlisted}
                        onChange={onToggleRecentIncludeUnlisted}
                        ariaLabel="最近打开包含未加入入口的项目"
                      />
                    </div>
                  )}
                </div>
                {recentHits.length > 0
                  ? tileGrid(recentHits, false)
                  : (
                    <div className="mx-3 mb-1 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] px-3 py-2 t-2xs leading-relaxed text-[var(--meta)]">
                      {recentIncludeUnlisted
                        ? '最近记录里的入口已不在当前清单中'
                        : '已隐藏未加入入口的最近记录（程序 / 文件夹 / 网页 / 连锁）；重新开启后恢复显示'}
                    </div>
                  )}
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
            团队入口还没有同步，当前只显示个人入口
          </p>
        )}
      </div>

      {menu !== null && onToggleFavorite && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            (isFavorite?.(menu.hit.entry.id) ?? menu.hit.kind === 'favorite')
              ? [{ id: 'unfavorite', label: '取消收藏', onSelect: () => onToggleFavorite(menu.hit.entry.id) }]
              : [{ id: 'favorite', label: '收藏', onSelect: () => onToggleFavorite(menu.hit.entry.id) }]
          }
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
