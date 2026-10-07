/**
 * 同步状态订阅。
 *
 * 【红线】渲染层不允许自行推导任何同步状态 —— 快照一律来自宿主同步服务推送。
 *    这里只做「订阅 + 分发」，不做判断、不做缓存、不沿用上一轮。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../bridge/index.ts';
import type { SyncSnapshot } from '../bridge/types.ts';

interface SyncCtx {
  snapshot: SyncSnapshot;
  refresh(): Promise<void>;
}

const Ctx = createContext<SyncCtx | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(() => api.sync.snapshot());

  useEffect(() => {
    const unsubscribe = api.sync.subscribe(setSnapshot);
    // 订阅回放的是 preload 缓存，而预热与首帧有竞态：主动拉一次兜底，
    // 保证首帧拿到的是装配完成后端口里的真值（管理员模式下尤其关键——
    // 管理员端口只在订阅/发布/刷新时发言，错过就只能靠这一拉）。
    void api.sync.pull().then(setSnapshot).catch(() => undefined);
    return unsubscribe;
  }, []);

  const value = useMemo<SyncCtx>(
    () => ({ snapshot, refresh: () => api.sync.refresh() }),
    [snapshot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSync(): SyncCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync 必须在 SyncProvider 内使用');
  return v;
}
