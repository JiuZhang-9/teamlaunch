/**
 * HomePageView —— 主页（2026-10-05）：公告轮播 + 收藏表。
 *
 * 公告：管理员在编辑态发布（随团队配置同步），本视图只读展示；
 * 收藏：本机各存各的（favoriteStore），按收藏时间倒序展示为**图标格**（2026-10-17 起），点击即打开。
 * 轮播：手动左右箭头 + 圆点指示（用户定稿：不自动轮播）。
 */
import { ArrowLeft, ArrowRight, EllipsisVertical, ListChecks, Megaphone, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../components/atoms/Button.tsx';
import { EmptyBlock } from '../components/molecules/EmptyBlock.tsx';
import { CardGrid } from '../components/molecules/CardGrid.tsx';
import { FavoriteTile } from '../components/molecules/FavoriteTile.tsx';
import { ContextMenu } from '../components/molecules/ContextMenu.tsx';
import { RenameDialog } from '../components/organisms/SimpleDialog.tsx';
import { api } from '../bridge/index.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { useChains } from '../store/chainStore.tsx';
import { useEdit } from '../store/editStore.tsx';
import { useFavorites } from '../store/favoriteStore.tsx';
import { usePersonal } from '../store/personalStore.tsx';
import { useSettings } from '../store/settingsStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import type { SavedChain } from '../bridge/types.ts';
import type { Entry } from '../../shared/schema/entry.ts';

export function HomePageView() {
  const { snapshot } = useSync();
  const { config: personal } = usePersonal();
  const { settings } = useSettings();
  const edit = useEdit();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const { runtime, openEntry, openDialog, runSavedChain } = useWorkbench();
  const { push } = useToasts();
  const { chains, resolve: resolveChain, rename: renameChain, remove: removeChain } = useChains();
  const [chainMenu, setChainMenu] = useState<{ x: number; y: number; chain: SavedChain } | null>(null);
  const [renaming, setRenaming] = useState<SavedChain | null>(null);
  /** 连锁的解析基准：团队快照 + 本机入口（与收藏区同一来源）。 */
  const teamEntries = useMemo(
    () => (snapshot.config?.groups ?? []).flatMap((g) => g.entries),
    [snapshot.config],
  );
  const personalEntries = useMemo(() => personal.groups.flatMap((g) => g.entries), [personal]);

  /* 窗口布局的记忆条数（2026-10-19 进阶）：每条连锁一个数，挂载与操作后各读一次。 */
  const [layoutCounts, setLayoutCounts] = useState<Record<string, number>>({});
  const refreshLayoutCounts = useCallback(async () => {
    const pairs = await Promise.all(
      chains.map(async (c) => [c.id, await api.windowLayout.info(c.id)] as const),
    );
    setLayoutCounts(Object.fromEntries(pairs));
  }, [chains]);
  useEffect(() => {
    void refreshLayoutCounts();
  }, [refreshLayoutCounts]);

  /**
   * 「记住窗口布局」：把这条连锁里**已经打开并摆好**的应用/文件夹窗口的位置记下来。
   * 只记 app / folder（网页是共享的浏览器窗口，摆它等于摆浏览器，不碰）。
   * 结果如实汇报：记住了几个、哪几个没找到（通常是窗口没开着）。
   */
  const captureChainLayout = useCallback(
    async (chain: SavedChain) => {
      const res = resolveChain(chain, teamEntries, personalEntries);
      const steps = res.entries
        .filter((e): e is Entry & { type: 'app' | 'folder' } => e.type === 'app' || e.type === 'folder')
        .map((e) => ({ entryId: e.id, kind: e.type, target: e.target }));
      if (steps.length === 0) {
        push({ title: '这条连锁里没有应用或文件夹，没有窗口位置可记', tone: 'warn' });
        return;
      }
      const out = await api.windowLayout.capture(chain.id, steps);
      await refreshLayoutCounts();
      if (out.saved > 0) {
        const tail = out.missing.length > 0 ? `；还有 ${out.missing.length} 个窗口没找到（先打开它们再记一次）` : '';
        push({ title: `已记住 ${out.saved} 个窗口的位置${tail}`, tone: 'success' });
        return;
      }
      push({ title: out.reason ?? '没有找到可记的窗口', tone: 'warn' });
    },
    [personalEntries, push, refreshLayoutCounts, resolveChain, teamEntries],
  );

  const announcements = snapshot.config?.announcements ?? [];
  const [page, setPage] = useState(0);
  const index = Math.min(page, Math.max(0, announcements.length - 1));
  const current = announcements[index];
  const isAdmin = settings.role === 'admin';

  const goAnnouncements = () => {
    if (edit.editing) {
      openDialog('announcements');
      return;
    }
    if (!edit.unlocked) {
      openDialog('adminUnlock');
      return;
    }
    edit.beginEdit();
    openDialog('announcements');
  };

  /** 收藏行：按收藏时间倒序；已在团队快照或本机配置里找到的才显示。 */
  const favRows = useMemo(() => {
    const rows: Array<{ entry: Entry; source: 'team' | 'personal' }> = [];
    for (const f of [...favorites].reverse()) {
      let found: Entry | null = null;
      for (const g of snapshot.config?.groups ?? []) {
        const e = g.entries.find((x) => x.id === f.entryId);
        if (e) {
          found = e;
          break;
        }
      }
      if (!found) {
        for (const g of personal.groups) {
          const e = g.entries.find((x) => x.id === f.entryId);
          if (e) {
            found = e;
            break;
          }
        }
      }
      if (found) rows.push({ entry: found, source: snapshot.config?.groups.some((g) => g.entries.some((x) => x.id === f.entryId)) ? 'team' : 'personal' });
    }
    return rows;
  }, [favorites, snapshot.config, personal.groups]);

  const openFav = (entry: Entry) => {
    void openEntry(entry);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ---- 公告栏 ---- */}
      <section aria-label="公告栏">
        <div className="mb-2 flex items-center gap-2">
          <Megaphone size={16} strokeWidth={2} aria-hidden className="text-[var(--accent-text)]" />
          <h2 className="t-base w-emph text-[var(--fg)]">公告栏</h2>
          {isAdmin && (
            <Button tone="secondary" size="sm" className="ml-auto" icon={Megaphone} onClick={goAnnouncements}>
              公告管理
            </Button>
          )}
        </div>

        {announcements.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-2">
            <EmptyBlock
              icon={Megaphone}
              iconSize={20}
              title="还没有公告"
              detail={isAdmin ? '点「公告管理」写第一条公告，随团队配置发布给所有人。' : '管理员还没有发布公告。'}
            />
          </div>
        ) : (
          <div
            className="relative min-h-[190px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)]"
            style={
              current.backgroundImageUrl
                ? {
                    backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.65)), url("${current.backgroundImageUrl.replace(/"/g, '%22')}")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : undefined
            }
          >
            <div
              className="relative z-10 p-5"
              style={current.backgroundImageUrl ? { color: '#fff' } : undefined}
            >
              <h3 className="t-md w-emph m-0 mb-2 text-[var(--fg)]" style={current.backgroundImageUrl ? { color: '#fff' } : undefined}>
                {current.title}
              </h3>
              <div
                className="md-body t-sm text-[var(--fg-2)]"
                style={current.backgroundImageUrl ? { color: 'rgba(255,255,255,0.92)' } : undefined}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(current.body) }}
              />
            </div>
            {announcements.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="上一条公告"
                  onClick={() => setPage((index - 1 + announcements.length) % announcements.length)}
                  className="absolute left-2 top-1/2 z-20 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-[var(--border-subtle)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
                  style={{ background: 'var(--bg-surface)' }}
                >
                  <ArrowLeft size={16} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="下一条公告"
                  onClick={() => setPage((index + 1) % announcements.length)}
                  className="absolute right-2 top-1/2 z-20 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-[var(--border-subtle)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
                  style={{ background: 'var(--bg-surface)' }}
                >
                  <ArrowRight size={16} strokeWidth={2} aria-hidden />
                </button>
              </>
            )}
            {announcements.length > 1 && (
              <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 gap-1.5" aria-hidden>
                {announcements.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    tabIndex={-1}
                    aria-label={'第 ' + (i + 1) + ' 条'}
                    onClick={() => setPage(i)}
                    className="h-1.5 w-4 rounded-pill transition-colors duration-[var(--motion-fast)]"
                    style={{ background: i === index ? 'var(--accent)' : 'var(--border-strong)' }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---- 收藏区 ---- */}
      <section aria-label="收藏">
        <div className="mb-2 flex items-center gap-2">
          <Star size={16} strokeWidth={2} aria-hidden className="text-[var(--accent-text)]" />
          <h2 className="t-base w-emph text-[var(--fg)]">收藏</h2>
          <span className="t-2xs text-[var(--meta)]">在团队入口 / 我的入口的卡片右键菜单里收藏；收藏只保存在这台电脑上。</span>
        </div>

        {favRows.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-2">
            <EmptyBlock
              icon={Star}
              iconSize={20}
              title="还没有收藏"
              detail="在下方两个页面的卡片右键菜单里选「收藏」，它们会集中显示在这里。"
            />
          </div>
        ) : (
          /* 图标格（2026-10-17 批 4）：列表改成一格一个图标，省空间也好扫；
             键盘导航沿用 CardGrid 的 roving tabindex。 */
          <CardGrid
            items={favRows}
            getKey={(row) => row.entry.id}
            ariaLabel="收藏"
            minColumnPx={120}
            onActivate={(row) => openFav(row.entry)}
            render={(row, focus) => (
              <FavoriteTile
                ref={focus.cardRef}
                entry={row.entry}
                source={row.source}
                favorite={isFavorite(row.entry.id)}
                statusText={
                  runtime[row.entry.id]?.phase === 'failed'
                    ? failureText(runtime[row.entry.id]?.failure)
                    : `打开「${row.entry.name}」`
                }
                tabIndex={focus.tabIndex}
                onKeyDown={focus.onKeyDown}
                onOpen={() => openFav(row.entry)}
                onToggleFavorite={() => void toggleFavorite(row.entry.id)}
              />
            )}
          />
        )}
      </section>

      {/* ---- 连锁区（2026-10-19）----
          用户要求："希望能支持收藏'连锁'操作，以便记忆，下次只需点一个按钮即可执行。"
          本机保存（config/chains.json），入口内容以当下为准；失效的项在启动时如实跳过并计数。 */}
      <section aria-label="连锁" className="mt-6">
        <div className="mb-2 flex items-center gap-2">
          <ListChecks size={16} strokeWidth={2} aria-hidden className="text-[var(--accent-text)]" />
          <h2 className="t-base w-emph text-[var(--fg)]">连锁</h2>
          <span className="t-2xs text-[var(--meta)]">
            多选几张卡 → 浮条上「保存为连锁」，这里就能一键按顺序启动；只保存在这台电脑上。
          </span>
        </div>

        {chains.length === 0 ? (
          <p className="t-xs rounded-[var(--radius-lg)] border border-dashed border-[var(--border-default)] px-3 py-2 text-[var(--meta)]">
            还没有保存的连锁。在「团队入口」或「我的入口」里进入多选、勾好顺序，点「保存为连锁」即可。
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {chains.map((chain) => {
              const res = resolveChain(chain, teamEntries, personalEntries);
              const broken = res.entries.length === 0;
              const layoutCount = layoutCounts[chain.id] ?? 0;
              return (
                <li
                  key={chain.id}
                  className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="t-sm w-emph m-0 truncate-1 text-[var(--fg)]">{chain.name}</p>
                    <p className="t-2xs m-0 text-[var(--meta)]">
                      {res.entries.length} 个入口 · 间隔 {(chain.intervalMs / 1000).toFixed(1)} 秒
                      {res.missing.length > 0 && ` · ${res.missing.length} 项已失效`}
                      {layoutCount > 0 && ` · 已记住 ${layoutCount} 个窗口位置`}
                    </p>
                  </div>
                  <Button
                    tone="primary"
                    size="sm"
                    softDisabled={broken}
                    title={broken ? '这条连锁里的入口都已不存在' : `按顺序启动「${chain.name}」`}
                    onDisabledClick={() => push({ title: '这条连锁里的入口都已不存在，删掉它或重新保存一条', tone: 'warn' })}
                    onClick={() => {
                      /* 启动时对"记过位置"的那几步摆位（2026-10-19 进阶）：
                         回调里是 fire-and-forget——摆位脚本自己等窗口出现，不拖住连锁节奏。 */
                      void runSavedChain(res.entries, chain.intervalMs, chain.name, res.missing.length, (entry) => {
                        if (entry.type === 'web') return;
                        void api.windowLayout.apply(chain.id, entry.id);
                      });
                      void api.usage.bump({ kind: 'feature', key: 'savedChainRun' });
                    }}
                  >
                    一键启动
                  </Button>
                  <Button
                    tone="ghost"
                    size="sm"
                    icon={EllipsisVertical}
                    aria-label={`「${chain.name}」操作`}
                    onClick={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setChainMenu({ x: r.left, y: r.bottom + 4, chain });
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {chainMenu && (
        <ContextMenu
          x={chainMenu.x}
          y={chainMenu.y}
          items={[
            {
              id: 'capture-layout',
              label: '记住窗口布局',
              onSelect: () => {
                const chain = chainMenu.chain;
                setChainMenu(null);
                void captureChainLayout(chain);
              },
            },
            ...((layoutCounts[chainMenu.chain.id] ?? 0) > 0
              ? [{
                  id: 'clear-layout',
                  label: '清除记住的窗口位置',
                  onSelect: () => {
                    const chain = chainMenu.chain;
                    setChainMenu(null);
                    void api.windowLayout.clear(chain.id).then(() => {
                      void refreshLayoutCounts();
                      push({ title: `已清除「${chain.name}」记住的窗口位置`, tone: 'info' });
                    });
                  },
                }]
              : []),
            { id: 'rename', label: '重命名…', onSelect: () => { setRenaming(chainMenu.chain); setChainMenu(null); } },
            {
              id: 'delete',
              label: '删除这条连锁',
              destructive: true,
              onSelect: () => {
                const target = chainMenu.chain;
                setChainMenu(null);
                void removeChain(target.id)
                  .then(() => api.windowLayout.clear(target.id))
                  .then(() => push({ title: `已删除连锁「${target.name}」`, tone: 'info' }));
              },
            },
          ]}
          onClose={() => setChainMenu(null)}
        />
      )}

      {renaming && (
        <RenameDialog
          title="重命名连锁"
          fieldLabel="连锁名称"
          initial={renaming.name}
          confirmLabel="保存"
          maxLength={40}
          validate={(next) => (next.trim().length === 0 ? '名称不能为空' : null)}
          onConfirm={(name) => {
            const target = renaming;
            setRenaming(null);
            void renameChain(target.id, name).then(() => push({ title: '已重命名', tone: 'info' }));
          }}
          onCancel={() => setRenaming(null)}
        />
      )}
    </div>
  );
}

function failureText(failure?: import('../bridge/types.ts').OpenFailure): string {
  return failure ?? '打开失败';
}
