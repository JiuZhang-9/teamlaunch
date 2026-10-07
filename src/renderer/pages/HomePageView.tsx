/**
 * HomePageView —— 主页（2026-10-05）：公告轮播 + 收藏表。
 *
 * 公告：管理员在编辑态发布（随团队配置同步），本视图只读展示；
 * 收藏：本机各存各的（favoriteStore），按收藏时间倒序展示，点击行即打开入口。
 * 轮播：手动左右箭头 + 圆点指示（用户定稿：不自动轮播）。
 */
import { ArrowLeft, ArrowRight, Megaphone, Star, StarOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/atoms/Button.tsx';
import { EmptyBlock } from '../components/molecules/EmptyBlock.tsx';
import { TypeTag } from '../components/atoms/Tag.tsx';
import { renderMarkdown } from '../lib/markdown.ts';
import { TYPE_META } from '../lib/entry.ts';
import { useEdit } from '../store/editStore.tsx';
import { useFavorites } from '../store/favoriteStore.tsx';
import { usePersonal } from '../store/personalStore.tsx';
import { useSettings } from '../store/settingsStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import type { Entry } from '../../shared/schema/entry.ts';

export function HomePageView() {
  const { snapshot } = useSync();
  const { config: personal } = usePersonal();
  const { settings } = useSettings();
  const edit = useEdit();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const { runtime, openEntry, openDialog } = useWorkbench();

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
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)]">
            <div
              className="flex h-9 items-center gap-3 border-b border-[var(--border-subtle)] px-3 t-2xs text-[var(--meta)]"
              aria-hidden
            >
              <span className="w-[42px]">类型</span>
              <span className="min-w-0 flex-1">名称</span>
              <span className="w-[72px]">来源</span>
              <span className="w-[96px] text-right">操作</span>
            </div>
            {favRows.map(({ entry, source }) => {
              const rt = runtime[entry.id];
              return (
                <div
                  key={entry.id}
                  className="flex h-11 items-center gap-3 border-b border-[var(--border-subtle)] px-3 last:border-b-0"
                >
                  <span className="w-[42px] shrink-0">
                    <TypeTag label={TYPE_META[entry.type].label} />
                  </span>
                  <button
                    type="button"
                    onClick={() => openFav(entry)}
                    className="t-sm min-w-0 flex-1 truncate-1 text-left text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--accent-text)]"
                    title={runtime[entry.id]?.phase === 'failed' ? failureText(rt?.failure) : '打开「' + entry.name + '」'}
                  >
                    {entry.name}
                  </button>
                  <span className="w-[72px] shrink-0 text-[13px] text-[var(--muted)]">
                    {source === 'team' ? '团队' : '本机'}
                  </span>
                  <span className="flex w-[96px] shrink-0 items-center justify-end gap-1">
                    <Button tone="secondary" size="sm" onClick={() => openFav(entry)}>
                      打开
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      aria-label={'取消收藏 ' + entry.name}
                      icon={isFavorite(entry.id) ? StarOff : Star}
                      onClick={() => void toggleFavorite(entry.id)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function failureText(failure?: import('../bridge/types.ts').OpenFailure): string {
  return failure ?? '打开失败';
}
