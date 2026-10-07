/**
 * 收藏（2026-10-05 主页模块）：本机各存各的（config/favorites.json），不随团队同步。
 * 只存入口 id——条目内容以当前团队快照/本机配置为准；被删除的入口在主页列表里自动跳过。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { api } from '../bridge/index.ts';
import type { FavoriteItem } from '../bridge/types.ts';

const FavoritesSchema = z.array(
  z.object({
    entryId: z.string().min(1),
    addedAt: z.string().min(1),
  }),
);

interface FavoriteCtx {
  favorites: FavoriteItem[];
  isFavorite(entryId: string): boolean;
  toggleFavorite(entryId: string): Promise<void>;
}

const Ctx = createContext<FavoriteCtx | null>(null);

export function FavoriteProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    void api.favorites.get().then((list) => {
      const parsed = FavoritesSchema.safeParse(list);
      if (parsed.success) setFavorites(parsed.data);
    });
  }, []);

  const toggleFavorite = useCallback(async (entryId: string) => {
    setFavorites((cur) => {
      const next = cur.some((f) => f.entryId === entryId)
        ? cur.filter((f) => f.entryId !== entryId)
        : [...cur, { entryId, addedAt: new Date().toISOString() }];
      void api.favorites.save(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback((entryId: string) => favorites.some((f) => f.entryId === entryId), [favorites]);

  const value = useMemo(() => ({ favorites, isFavorite, toggleFavorite }), [favorites, isFavorite, toggleFavorite]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFavorites(): FavoriteCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFavorites 必须在 FavoriteProvider 内使用');
  return v;
}
