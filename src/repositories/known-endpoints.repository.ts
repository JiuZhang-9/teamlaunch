/**
 * src/repositories/known-endpoints.repository.ts —— 发现结果的持久化（L1 的支撑）
 *
 * L1「上次成功端点」是整个阶梯里最省时间的一层，它必须跨重启存活，
 * 否则每次启动都要走一遍广播，冷启动延迟从毫秒级变成秒级。
 *
 * 只存 baseUrl 与两个 UUID，**不存任何设备信息**：这是员工机上的缓存，
 * 存了也会被当成"服务端记了谁连过"的嫌疑。
 *
 * 写入纪律（架构师收口）：**不得每轮轮询都重写**。成功解析一次就写一次的话，
 * 员工端每 30 秒一次 tmp+fsync+rename，长跑是实打实的写放大。
 * 端点三要素没变化且距上次落盘不足 5 分钟 → 不写盘。
 */

import { DISCOVERY_PERSIST_THROTTLE_MS, LAN_SCAN } from '../shared/constants.ts';
import { readJsonFile, writeJsonAtomic } from './atomic-json.ts';
import type { StoragePaths } from './paths.ts';

export interface KnownEndpoint {
  baseUrl: string;
  serviceId: string;
  instanceId: string;
  /** 最后一次成功确认的时间。只用于人工排查，不参与判定。 */
  confirmedAt: string;
}

export interface DiscoveryCache {
  endpoints: KnownEndpoint[];
  /** 上次网段扫描的 Unix 毫秒。用于 L3 的 5 分钟限频。 */
  lastLanScanAt: number | null;
  /** 上次落盘的 Unix 毫秒。用于写入节流。 */
  savedAt: number | null;
}

const EMPTY: DiscoveryCache = { endpoints: [], lastLanScanAt: null, savedAt: null };

export class KnownEndpointsRepository {
  constructor(private readonly paths: StoragePaths) {}

  async load(): Promise<DiscoveryCache> {
    const raw = await readJsonFile<Partial<DiscoveryCache>>(this.paths.discovery);
    if (raw === null) return { ...EMPTY };
    const endpoints = Array.isArray(raw.endpoints)
      ? raw.endpoints.filter(isEndpoint).slice(0, LAN_SCAN.maxKnownEndpoints)
      : [];
    return {
      endpoints,
      lastLanScanAt: typeof raw.lastLanScanAt === 'number' ? raw.lastLanScanAt : null,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : null,
    };
  }

  /**
   * 记住一个成功端点：已存在则提到最前，超出上限淘汰最旧的。
   *
   * 返回是否真的落了盘（自检脚本据此验证节流生效）。
   * 首次记住、端点换了、或三要素有变化 → 一定写；否则按 5 分钟窗口节流。
   */
  async remember(endpoint: KnownEndpoint, now: number = Date.now()): Promise<boolean> {
    const cache = await this.load();
    const existing = cache.endpoints.find((e) => e.baseUrl === endpoint.baseUrl);
    const unchanged =
      existing !== undefined
      && existing.serviceId === endpoint.serviceId
      && existing.instanceId === endpoint.instanceId;

    if (unchanged && cache.savedAt !== null && now - cache.savedAt < DISCOVERY_PERSIST_THROTTLE_MS) {
      return false;
    }

    const rest = cache.endpoints.filter((e) => e.baseUrl !== endpoint.baseUrl);
    const next = [endpoint, ...rest].slice(0, LAN_SCAN.maxKnownEndpoints);
    await writeJsonAtomic(this.paths.discovery, {
      endpoints: next,
      lastLanScanAt: cache.lastLanScanAt,
      savedAt: now,
    } satisfies DiscoveryCache);
    return true;
  }

  async forget(baseUrl: string): Promise<void> {
    const cache = await this.load();
    const next = cache.endpoints.filter((e) => e.baseUrl !== baseUrl);
    if (next.length === cache.endpoints.length) return;
    await writeJsonAtomic(this.paths.discovery, {
      endpoints: next,
      lastLanScanAt: cache.lastLanScanAt,
      savedAt: Date.now(),
    } satisfies DiscoveryCache);
  }

  async markLanScan(now: number = Date.now()): Promise<void> {
    const cache = await this.load();
    await writeJsonAtomic(this.paths.discovery, { ...cache, lastLanScanAt: now } satisfies DiscoveryCache);
  }
}

function isEndpoint(value: unknown): value is KnownEndpoint {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.baseUrl === 'string' && typeof r.serviceId === 'string' && typeof r.instanceId === 'string';
}
