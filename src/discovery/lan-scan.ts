/**
 * src/discovery/lan-scan.ts —— L3：网段兜底扫描（限频，且必须可被关闭）
 *
 * 254 次 SYN 在严格网络里会触发安全软件/EDR 告警，因此它是末位手段：
 *   - 默认每 5 分钟最多一次（冷却由调用方按持久化的时间戳判定）
 *   - 并发与单主机超时都设上限，绝不放任
 *   - 端口按 17890 → 17899 顺序扫，**扫到结果的那一档就停**
 *
 * 只做 TCP 连通性初筛，端点是否真的是 TeamLaunch 由上层用 /health 确认：
 * 端口开着却不是我们的服务（别的软件占了 17890）必须被确认步骤否掉。
 */

import { connect } from 'node:net';
import { DISCOVERY_TIMEOUTS, LAN_SCAN, TCP_PORT_RANGE } from '../shared/constants.ts';
import { listLanInterfaces } from '../platform/net-profile.ts';
import { parseIpv4 } from '../shared/net.ts';

export interface LanScanOptions {
  deviceId: string;
  ports?: readonly number[];
  perHostTimeoutMs?: number;
  concurrency?: number;
  maxResults?: number;
  /** 整体截止时间。到点即停，返回已找到的部分。 */
  deadlineMs?: number;
}

export const DEFAULT_SCAN_PORTS: readonly number[] = Array.from(
  { length: TCP_PORT_RANGE.end - TCP_PORT_RANGE.start + 1 },
  (_unused, index) => TCP_PORT_RANGE.start + index,
);

/** 每张网卡所在 /24 的全部主机地址（去掉网络号与广播号）。 */
export function candidateHosts(): string[] {
  const out = new Set<string>();
  for (const iface of listLanInterfaces()) {
    const ip = parseIpv4(iface.address);
    const mask = parseIpv4(iface.netmask);
    if (ip === null || mask === null) continue;
    for (let last = 1; last <= 254; last += 1) {
      const host = [ip[0] & mask[0], ip[1] & mask[1], ip[2] & mask[2], last];
      const address = host.join('.');
      if (address === iface.address) continue;
      out.add(address);
    }
  }
  return [...out].sort();
}

export async function scanLan(options: LanScanOptions): Promise<string[]> {
  const ports = options.ports ?? DEFAULT_SCAN_PORTS;
  const perHostTimeoutMs = options.perHostTimeoutMs ?? LAN_SCAN.perHostTimeoutMs;
  const concurrency = options.concurrency ?? LAN_SCAN.concurrency;
  const maxResults = options.maxResults ?? 8;
  const deadline = Date.now() + (options.deadlineMs ?? DISCOVERY_TIMEOUTS.l3LanScanMs);
  const hosts = candidateHosts();
  const found: string[] = [];

  for (const port of ports) {
    if (found.length >= maxResults || Date.now() > deadline) break;
    const open = await scanPort(hosts, port, perHostTimeoutMs, concurrency, deadline, maxResults - found.length);
    for (const host of open) found.push(`http://${host}:${port}`);
    // 首选端口扫到了就停：继续扫是为了容错，不是为了把所有端口都摸一遍。
    if (found.length > 0) break;
  }

  return found.slice(0, maxResults);
}

async function scanPort(
  hosts: string[],
  port: number,
  perHostTimeoutMs: number,
  concurrency: number,
  deadline: number,
  limit: number,
): Promise<string[]> {
  const open: string[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      if (open.length >= limit || Date.now() > deadline) return;
      const index = cursor;
      cursor += 1;
      if (index >= hosts.length) return;
      const host = hosts[index];
      if (host === undefined) return;
      if (await isPortOpen(host, port, perHostTimeoutMs)) open.push(host);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker()));
  return open;
}

/** 单次 TCP 连通性探测。任何错误都算"没开"，包括超时与拒绝。 */
export function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('connect', () => finish(true));
  });
}
