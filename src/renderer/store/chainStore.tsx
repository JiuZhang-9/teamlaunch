/**
 * 连锁收藏（2026-10-19 用户要求："希望能支持收藏'连锁'操作，以便记忆，下次只需点一个按钮即可执行"）。
 *
 * 口径与收藏完全一致：**本机各存各的**（config/chains.json），不随团队同步；
 * 只存"名称 + 入口 id 的顺序 + 间隔"，入口内容以当下为准——被删掉的入口在启动时
 * 如实跳过并在结果里说明（不做静默吞掉，也不假装启动成功）。
 *
 * 上限是刻意的：20 条连锁、每条 30 个入口——超出的写入直接拒绝并给原因，
 * 而不是让文件无限长下去（与容量闸同一套"说清楚为什么"的纪律）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { api } from '../bridge/index.ts';
import type { SavedChain } from '../bridge/types.ts';
import type { Entry } from '../../shared/schema/entry.ts';

const ChainSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(40),
  entryIds: z.array(z.string().min(1)).min(1).max(30),
  intervalMs: z.number().int().min(300).max(5000),
  createdAt: z.string().min(1),
});
const ChainsSchema = z.array(ChainSchema).max(20);

export const CHAIN_LIMIT = 20;
export const CHAIN_ENTRY_LIMIT = 30;

export interface ChainResolution {
  entries: Entry[];
  /** 已不存在的入口 id（启动时跳过并如实汇报）。 */
  missing: string[];
}

interface ChainCtx {
  chains: SavedChain[];
  /** 保存一条新连锁（名称由调用方保证非空、不重名）。 */
  save(name: string, entries: Entry[], intervalMs: number): Promise<{ ok: boolean; reason?: string }>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** 把一条连锁的 id 解析成当下存在的入口（团队 + 本机）。 */
  resolve(chain: SavedChain, team: Entry[], personal: Entry[]): ChainResolution;
}

const Ctx = createContext<ChainCtx | null>(null);

const newId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function ChainProvider({ children }: { children: ReactNode }) {
  const [chains, setChains] = useState<SavedChain[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api.chains.get().then((list) => {
      const parsed = ChainsSchema.safeParse(list);
      // 坏文件按空处理（同 favorites 的口径），不把它当成"你本来就没有连锁"来骗人——
      // 这一层没有 UI 提示位，但启动时不报错本身是底线。
      if (!cancelled && parsed.success) setChains(parsed.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback(async (next: SavedChain[]) => {
    setChains(next);
    await api.chains.save(next);
  }, []);

  const save = useCallback(
    async (name: string, entries: Entry[], intervalMs: number): Promise<{ ok: boolean; reason?: string }> => {
      if (chains.length >= CHAIN_LIMIT) {
        return { ok: false, reason: `最多保存 ${CHAIN_LIMIT} 条连锁，请先删掉不用的` };
      }
      if (entries.length === 0) return { ok: false, reason: '清单是空的，先选几个入口' };
      if (entries.length > CHAIN_ENTRY_LIMIT) {
        return { ok: false, reason: `一条连锁最多 ${CHAIN_ENTRY_LIMIT} 个入口（当前 ${entries.length} 个）` };
      }
      const chain: SavedChain = {
        id: newId(),
        name: name.trim(),
        entryIds: entries.map((e) => e.id),
        intervalMs,
        createdAt: new Date().toISOString(),
      };
      await commit([...chains, chain]);
      return { ok: true };
    },
    [chains, commit],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      await commit(chains.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)));
    },
    [chains, commit],
  );

  const remove = useCallback(
    async (id: string) => {
      await commit(chains.filter((c) => c.id !== id));
    },
    [chains, commit],
  );

  const resolve = useCallback((chain: SavedChain, team: Entry[], personal: Entry[]): ChainResolution => {
    const byId = new Map<string, Entry>();
    for (const e of [...team, ...personal]) byId.set(e.id, e);
    const entries: Entry[] = [];
    const missing: string[] = [];
    for (const id of chain.entryIds) {
      const hit = byId.get(id);
      if (hit) entries.push(hit);
      else missing.push(id);
    }
    return { entries, missing };
  }, []);

  const value = useMemo<ChainCtx>(
    () => ({ chains, save, rename, remove, resolve }),
    [chains, save, rename, remove, resolve],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChains(): ChainCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChains 必须在 ChainProvider 内使用');
  return v;
}
