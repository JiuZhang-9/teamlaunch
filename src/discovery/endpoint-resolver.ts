/**
 * src/discovery/endpoint-resolver.ts —— 发现阶梯 L0→L3 的编排
 *
 *   L0 手动覆盖 serviceUrl          1500 ms   → 迁到独立服务器的开关
 *   L1 上次成功端点（≤3 个）          1500 ms/个 → 常规快速路径
 *   L2 UDP 广播 + 单播应答            2500 ms   → 主发现手段
 *   L3 网段 TCP 扫描                  4000 ms   → 末位兜底，5 分钟限频
 *   全部失败 → 离线模式（用本地缓存渲染）
 *
 * 每一层的**结果都必须经 /health 确认**才可用：广播能被伪造，扫描的端口
 * 可能被别的软件占着，只有 /health 回答的 instanceId 才是"你连对了数据源"。
 *
 * 已否决 mDNS（ADR-002）：它要求每台员工机开 UDP 5353 入站，摧毁零配置前提。
 * 这里因此不引入任何组播，也不要"顺手加个 mDNS 兜底"。
 */

import { API_PREFIX, DISCOVERY_TIMEOUTS, LAN_SCAN } from '../shared/constants.ts';
import type { KnownEndpointsRepository } from '../repositories/known-endpoints.repository.ts';
import { probeBeacon } from './beacon-probe.ts';
import { scanLan } from './lan-scan.ts';
import type { DiscoveredEndpoint } from './protocol.ts';

export type DiscoveryLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface DiscoveryRequest {
  deviceId: string;
  /** 设置里的手动覆盖（L0）。给了就只认它，不再广播。 */
  serviceUrl?: string | null;
  /** 期望连到的团队数据源。不符即视为连错实例，继续下一层。 */
  expectedInstanceId?: string | null;
  /** 是否允许 L3 网段扫描。企业环境可由设置关闭。 */
  allowLanScan?: boolean;
}

export interface DiscoveryOutcome {
  endpoint: DiscoveredEndpoint | null;
  level: DiscoveryLevel | null;
  offline: boolean;
  /** 逐层尝试的痕迹，供诊断页与自检脚本解释"为什么没找到"。 */
  attempts: string[];
}

export class EndpointResolver {
  constructor(private readonly store: KnownEndpointsRepository) {}

  async resolve(request: DiscoveryRequest): Promise<DiscoveryOutcome> {
    const attempts: string[] = [];

    const manual = normalizeUrl(request.serviceUrl);
    if (manual !== null) {
      attempts.push('L0 manual');
      const hit = await this.confirm(manual, request.expectedInstanceId, DISCOVERY_TIMEOUTS.l0ManualOverrideMs);
      if (hit !== null) return await this.settled(hit, 'L0', attempts);
      attempts.push('L0 manual 未通过健康检查');
    }

    const cache = await this.store.load();
    for (const known of cache.endpoints.slice(0, LAN_SCAN.maxKnownEndpoints)) {
      attempts.push(`L1 ${known.baseUrl}`);
      const hit = await this.confirm(known.baseUrl, request.expectedInstanceId, DISCOVERY_TIMEOUTS.l1KnownEndpointMs);
      if (hit !== null) return await this.settled(hit, 'L1', attempts);
    }

    attempts.push('L2 beacon');
    const offers = await probeBeacon({ deviceId: request.deviceId });
    for (const offer of offers) {
      const hit = await this.confirm(offer.baseUrl, request.expectedInstanceId, DISCOVERY_TIMEOUTS.healthCheckMs);
      if (hit !== null) return await this.settled(hit, 'L2', attempts);
    }

    if (request.allowLanScan !== false) {
      const now = Date.now();
      const lastScan = cache.lastLanScanAt;
      if (lastScan === null || now - lastScan >= LAN_SCAN.minIntervalMs) {
        attempts.push('L3 lan-scan');
        await this.store.markLanScan(now);
        const candidates = await scanLan({
          deviceId: request.deviceId,
          deadlineMs: DISCOVERY_TIMEOUTS.l3LanScanMs,
        });
        for (const baseUrl of candidates) {
          const hit = await this.confirm(baseUrl, request.expectedInstanceId, DISCOVERY_TIMEOUTS.healthCheckMs);
          if (hit !== null) return await this.settled(hit, 'L3', attempts);
        }
      } else {
        attempts.push(`L3 lan-scan 冷却中（${Math.ceil((LAN_SCAN.minIntervalMs - (now - lastScan)) / 1000)}s）`);
      }
    } else {
      attempts.push('L3 lan-scan 已关闭');
    }

    return { endpoint: null, level: null, offline: true, attempts };
  }

  /** 成功即回写 L1 缓存，下次启动直接走快速路径。 */
  private async settled(
    endpoint: DiscoveredEndpoint,
    level: DiscoveryLevel,
    attempts: string[],
  ): Promise<DiscoveryOutcome> {
    await this.store.remember({
      baseUrl: endpoint.baseUrl,
      serviceId: endpoint.serviceId,
      instanceId: endpoint.instanceId,
      confirmedAt: new Date().toISOString(),
    });
    return { endpoint, level, offline: false, attempts };
  }

  private async confirm(
    baseUrl: string,
    expectedInstanceId: string | null | undefined,
    timeoutMs: number,
  ): Promise<DiscoveredEndpoint | null> {
    const health = await fetchHealth(baseUrl, timeoutMs);
    if (health === null) return null;
    if (expectedInstanceId !== null && expectedInstanceId !== undefined
      && health.instanceId !== expectedInstanceId) {
      return null;
    }
    return {
      baseUrl,
      host: health.host,
      port: health.httpPort,
      serviceId: health.serviceId,
      instanceId: health.instanceId,
      revision: health.revision,
      name: '',
    };
  }
}

interface HealthReply {
  host: string;
  httpPort: number;
  serviceId: string;
  instanceId: string;
  revision: number;
}

export async function fetchHealth(baseUrl: string, timeoutMs: number): Promise<HealthReply | null> {
  let host: string;
  let port: number;
  try {
    const url = new URL(baseUrl);
    host = url.hostname;
    port = url.port === '' ? 80 : Number.parseInt(url.port, 10);
  } catch {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}${API_PREFIX}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { code?: number; data?: Record<string, unknown> };
    if (body.code !== 0 || body.data === undefined) return null;
    const data = body.data;
    if (typeof data.serviceId !== 'string' || typeof data.instanceId !== 'string') return null;
    return {
      host,
      httpPort: typeof data.httpPort === 'number' ? data.httpPort : port,
      serviceId: data.serviceId,
      instanceId: data.instanceId,
      revision: typeof data.revision === 'number' ? data.revision : 0,
    };
  } catch {
    // 超时 / 拒绝 / 非 JSON：都是"这一层没找到"，不该冒泡成异常。
    return null;
  }
}

/** URL 归一化：去末尾斜杠、补 http 前缀。非法输入返回 null（视为没配置）。 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
