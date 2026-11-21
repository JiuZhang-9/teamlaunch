/**
 * 收藏（2026-10-30，1.7.0）：主页「收藏」与快捷窗口「固定」统一后的唯一 store。
 *
 * 本机各存各的（config/favorites.json），不随团队同步；只存入口 id + 收藏时间，
 * 条目内容以当前团队快照 / 本机配置为准。主进程负责串行写入并向所有窗口广播完整列表，
 * 所以主页收藏后快捷窗口顶部立刻出现，反过来也一样。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../bridge/index.ts';
import type { FavoriteItem } from '../bridge/types.ts';
import {
  favoriteIdsForDisplay,
  mergeLegacyPinned,
  normalizeFavorites,
  reorderFavorites,
} from '../../shared/favorites.ts';
import { clearLegacyPinnedEntries, legacyPinnedEntryIds } from '../lib/legacyPinnedEntries.ts';
import { useToasts } from './toastStore.tsx';

interface FavoriteCtx {
  favorites: FavoriteItem[];
  /** 显示顺序（唯一口径，1.10.0）：主页、快捷窗口 / 主窗口搜索的收藏行直接用它。 */
  favoriteIds: string[];
  isFavorite(entryId: string): boolean;
  toggleFavorite(entryId: string): Promise<void>;
  /**
   * 批量设为收藏 / 取消收藏（多选菜单）。
   * 语义是"一次设定成同一个状态"，不是逐项 toggle——逐项 toggle 会让整批的结果不可预期。
   */
  setFavoriteMany(entryIds: string[], on: boolean): Promise<void>;
  /** 手动排序（1.10.0）：传拖动后的 id 顺序；本地先乐观重排，主进程落盘后校准。 */
  reorder(orderedIds: string[]): Promise<void>;
}

const Ctx = createContext<FavoriteCtx | null>(null);

export function FavoriteProvider({
  children,
  migrateLegacyPinned = false,
}: {
  children: ReactNode;
  /** 只在主窗口为 true：把旧「固定」localStorage 一次性并入收藏。 */
  migrateLegacyPinned?: boolean;
}) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const { push } = useToasts();

  useEffect(() => {
    let cancelled = false;
    const off = api.events.onFavoritesChanged((list) => {
      if (!cancelled) setFavorites(normalizeFavorites(list));
    });

    const load = async () => {
      let current: FavoriteItem[];
      try {
        current = normalizeFavorites(await api.favorites.get());
      } catch {
        if (!cancelled) push({ title: '没能读取收藏，重启后再试', tone: 'warn' });
        return;
      }
      if (cancelled) return;
      if (!migrateLegacyPinned) {
        setFavorites(current);
        return;
      }

      const legacy = legacyPinnedEntryIds();
      if (legacy.length === 0) {
        setFavorites(current);
        return;
      }
      try {
        const merged = mergeLegacyPinned(current, legacy, new Date().toISOString());
        const saved = normalizeFavorites(await api.favorites.save(merged));
        if (cancelled) return;
        setFavorites(saved);
        clearLegacyPinnedEntries();
      } catch {
        if (!cancelled) {
          setFavorites(current);
          push({ title: '旧固定项没能并入收藏，下次启动会再试', tone: 'warn' });
        }
      }
    };
    void load();

    return () => {
      cancelled = true;
      off();
    };
  }, [migrateLegacyPinned, push]);

  const toggleFavorite = useCallback(
    async (entryId: string) => {
      try {
        setFavorites(normalizeFavorites(await api.favorites.toggle(entryId)));
      } catch {
        push({ title: '没能更新收藏，请稍后再试', tone: 'danger' });
      }
    },
    [push],
  );

  const isFavorite = useCallback(
    (entryId: string) => favorites.some((f) => f.entryId === entryId),
    [favorites],
  );

  const setFavoriteMany = useCallback(
    async (entryIds: string[], on: boolean) => {
      try {
        setFavorites(normalizeFavorites(await api.favorites.setMany(entryIds, on)));
      } catch {
        push({ title: '没能更新收藏，请稍后再试', tone: 'danger' });
      }
    },
    [push],
  );

  const reorder = useCallback(
    async (orderedIds: string[]) => {
      /* 乐观更新：拖动松手立刻看到新顺序，不等 IPC 往返。
         主进程返回的是唯一口径的结果（未出现的项按原显示顺序跟随），回来后再校准一次。 */
      setFavorites((current) => reorderFavorites(current, orderedIds));
      try {
        setFavorites(normalizeFavorites(await api.favorites.reorder(orderedIds)));
      } catch {
        push({ title: '没能保存收藏顺序，请稍后再试', tone: 'danger' });
        try {
          setFavorites(normalizeFavorites(await api.favorites.get()));
        } catch {
          /* 读回也失败：保留乐观顺序，下次启动以磁盘为准 */
        }
      }
    },
    [push],
  );

  const favoriteIds = useMemo(() => favoriteIdsForDisplay(favorites), [favorites]);

  const value = useMemo(
    () => ({ favorites, favoriteIds, isFavorite, toggleFavorite, setFavoriteMany, reorder }),
    [favorites, favoriteIds, isFavorite, toggleFavorite, setFavoriteMany, reorder],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFavorites(): FavoriteCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFavorites 必须在 FavoriteProvider 内使用');
  return v;
}
