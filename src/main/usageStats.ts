/**
 * 本机用量统计（2026-10-17，用户拍板"仅本机记录"）。
 *
 * 记什么：每个入口的点击成功 / 失败次数，以及功能使用次数（连锁启动 / 多选 / 批量添加 /
 * 扫描添加 / 新建分组 / 新建入口），供后续迭代参考。
 *
 * 三条边界（必须一直成立）：
 *  - **不上报**：只写 `userData/config/usage-stats.json`，不经过任何 HTTP 通道；
 *  - **不进 UI**：界面上只展示"卡片数量"（那是从配置数出来的），点击次数只在文件里，
 *    用户自己打开文件可看、删掉即归零（docs/DELIVERY.md §7 已登记这份文件）；
 *  - **不影响功能**：任何读写失败都静默吞掉——统计挂了不能连累打开入口。
 *
 * 串行化：渲染层有两个窗口（主窗口 + 快捷面板）都可能上报，读-改-写必须排队，
 * 否则"后写覆盖先写"会静默丢计数（K-05：全程异步，禁用 *Sync IO）。
 */
import { localStore } from './localStore.ts';

export interface UsageStats {
  version: 1;
  /** 入口 id → 点击次数。 */
  entries: Record<string, { ok: number; fail: number }>;
  /** 功能使用次数：键见 UsageFeature。 */
  features: Record<string, number>;
}

export type UsageFeature =
  | 'chainLaunch'
  | 'multiSelect'
  | 'batchAdd'
  | 'scanAdd'
  | 'newGroup'
  | 'newEntry';

const EMPTY: UsageStats = { version: 1, entries: {}, features: {} };

/** 排队写：前一次读完+写完才轮到下一次（避免并发丢计数）。 */
let queue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task);
  return queue;
}

async function read(): Promise<UsageStats> {
  const raw = await localStore.usageStats<unknown>(EMPTY);
  if (raw === null || typeof raw !== 'object') return { ...EMPTY };
  const parsed = raw as Partial<UsageStats>;
  return {
    version: 1,
    entries: parsed.entries !== null && typeof parsed.entries === 'object' ? (parsed.entries as UsageStats['entries']) : {},
    features: parsed.features !== null && typeof parsed.features === 'object' ? (parsed.features as Record<string, number>) : {},
  };
}

/** 记一次入口点击结果（ok=false 计失败次数）。失败静默——统计不该影响任何功能。 */
export function recordEntryOpen(entryId: string, ok: boolean): Promise<void> {
  const id = String(entryId ?? '').slice(0, 64);
  if (id.length === 0) return Promise.resolve();
  return enqueue(async () => {
    try {
      const stats = await read();
      const cur = stats.entries[id] ?? { ok: 0, fail: 0 };
      stats.entries[id] = ok ? { ...cur, ok: cur.ok + 1 } : { ...cur, fail: cur.fail + 1 };
      await localStore.saveUsageStats(stats);
    } catch {
      /* 统计写不进去不是故障 */
    }
  });
}

/** 记一次功能使用。失败静默。 */
export function recordFeature(feature: UsageFeature): Promise<void> {
  return enqueue(async () => {
    try {
      const stats = await read();
      stats.features[feature] = (stats.features[feature] ?? 0) + 1;
      await localStore.saveUsageStats(stats);
    } catch {
      /* 同上 */
    }
  });
}

/** 读一份快照（自检/测试用；界面不读它——点击次数不展示是用户拍板的）。 */
export async function readUsageStats(): Promise<UsageStats> {
  return read();
}
