/**
 * src/discovery/protocol.ts —— 信标报文的编解码（服务端与客户端共用一份）
 *
 * 两端各写一份编码迟早漂移，而漂移的表现是"某些机器上发现不到"，
 * 排查成本极高。因此服务端 `server/beacon.ts` 与客户端 `discovery/beacon-probe.ts`
 * 都从这里取形状。
 *
 * 报文格式见 ADR-002：
 *   query  {magic, type:'query', nonce, anonDeviceId}
 *   offer  {magic, type:'offer', nonce, serviceId, instanceId, name, httpPort, revision, addrs}
 *
 * `magic` 是协议版本哨兵：将来换协议时靠它平滑过渡，不匹配一律丢弃。
 * `nonce` 回显用于丢弃迟到/重复的应答。
 */

import { randomBytes } from 'node:crypto';
import { BEACON_MAGIC } from '../shared/constants.ts';

export type BeaconType = 'query' | 'offer';

export interface BeaconQuery {
  magic: string;
  type: 'query';
  nonce: string;
  anonDeviceId: string;
}

export interface BeaconOffer {
  magic: string;
  type: 'offer';
  nonce: string;
  serviceId: string;
  instanceId: string;
  name: string;
  httpPort: number;
  revision: number;
  addrs: string[];
}

/** 一次发现的结果。`baseUrl` 不含 /api/v1，便于直接拼任意端点。 */
export interface DiscoveredEndpoint {
  baseUrl: string;
  host: string;
  port: number;
  serviceId: string;
  instanceId: string;
  revision: number;
  name: string;
}

export function newNonce(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

export function encodeBeaconQuery(query: BeaconQuery): Buffer {
  return Buffer.from(JSON.stringify(query), 'utf8');
}

export function encodeBeaconOffer(offer: BeaconOffer): Buffer {
  return Buffer.from(JSON.stringify(offer), 'utf8');
}

/**
 * 解析并校验。任何一处不对都返回 null 而**不抛**：
 * 局域网里任何人都能往 17891 发包，解析异常不该让服务端的 socket 挂掉。
 */
export function parseBeaconMessage(bytes: Buffer): BeaconQuery | BeaconOffer | null {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.magic !== BEACON_MAGIC) return null;
  if (typeof record.nonce !== 'string' || record.nonce.length === 0) return null;

  if (record.type === 'query') {
    if (typeof record.anonDeviceId !== 'string') return null;
    return {
      magic: BEACON_MAGIC,
      type: 'query',
      nonce: record.nonce,
      anonDeviceId: record.anonDeviceId,
    };
  }

  if (record.type === 'offer') {
    if (typeof record.serviceId !== 'string' || typeof record.instanceId !== 'string') return null;
    if (typeof record.httpPort !== 'number' || !Number.isInteger(record.httpPort)) return null;
    return {
      magic: BEACON_MAGIC,
      type: 'offer',
      nonce: record.nonce,
      serviceId: record.serviceId,
      instanceId: record.instanceId,
      name: typeof record.name === 'string' ? record.name : '',
      httpPort: record.httpPort,
      revision: typeof record.revision === 'number' ? record.revision : 0,
      addrs: Array.isArray(record.addrs) ? record.addrs.filter((a): a is string => typeof a === 'string') : [],
    };
  }

  return null;
}
