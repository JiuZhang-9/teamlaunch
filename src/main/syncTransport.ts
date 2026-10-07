/**
 * src/main/syncTransport.ts —— 员工端对数据源的 HTTP 传输层
 *
 * 为什么单独一层：同步客户端要能被**纯 Node** 验证（本机起服务 + 客户端连 127.0.0.1），
 * 把 fetch 与状态机混在一起就只能靠 Electron 真机点。这里只做"发请求、收字节"，
 * 不做任何状态判断——状态是 syncClient 的事（K-B）。
 *
 * 三条容易做错的地方，都在本文件里定了死规矩：
 *   1. 签名覆盖的 path 是**含 /api/v1 前缀、不含查询串**的完整路径（`/api/v1/config`）。
 *   2. 签名算的是**原始字节**：body 先序列化成 Buffer，同一份 Buffer 既进 fetch 也进 HMAC。
 *      拿解析后的对象再 JSON.stringify 一次，键序/空格/Unicode 归一化任一不同就 401，
 *      且表现为随机失败（最易错点 1）。
 *   3. Content-Type 只能是裸 `application/json`，带 charset 会被服务端拒（400）。
 *
 * 签名算法不在这里另写一份：直接复用 `src/server/hooks/auth.ts` 的 `sign`。
 * 两端各写一份迟早漂移，而漂移的表现是"偶尔 401"。
 */

import { API_PREFIX, DEVICE_ID_HEADER, STRICT_JSON_CONTENT_TYPE } from '../shared/constants.ts';
import type { OfflineReason } from '../renderer/bridge/types.ts';
import type { FeedbackBatch } from '../shared/schema/feedback.ts';
import type { TelemetryBatch } from '../shared/schema/telemetry.ts';

/** 握手产物：令牌 + 验签密钥（= verifier）。仅内存，不落盘。 */
export interface ClientSession {
  token: string;
  key: Buffer;
  expiresAt: number;
}

export interface ConfigReply {
  /** ok = 拿到正文；notModified = 304；notPublished = 404（服务端还没发布过）；error = 其余。 */
  kind: 'ok' | 'notModified' | 'notPublished' | 'error';
  status: number;
  /** 原始正文（未解析）。三重闸门的重算与落盘都以它为唯一来源。 */
  body: string | null;
  /** 服务端签发的 ETag，原样存回，绝不本地拼。 */
  etag: string | null;
  publishedAt: string | null;
  reason: OfflineReason;
}

export interface PostReply {
  ok: boolean;
  status: number;
}

export interface ChallengeReply {
  challengeId: string;
  challenge: string;
  salt: string;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; keylen: number };
  expiresAt: string;
  serverId: string;
}

export const DEFAULT_TIMEOUT_MS = 3000;

/**
 * 网络异常 → offlineReason 的映射。
 *
 * 四个值的视觉权重必须完全相同（设计师红线），这里的划分只影响第二行文案，
 * 不影响配色/图标。判定不到具体原因的一律 UNKNOWN —— 宁可模糊，不可编造。
 */
export function reasonOfError(err: unknown): OfflineReason {
  const code = (err as { code?: string } | null)?.code ?? '';
  const name = (err as { name?: string } | null)?.name ?? '';
  // 超时在真实网络里几乎总是"包被丢"：防火墙DROP、安全软件拦截，不是"没开机"。
  if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT') {
    return 'CONNECTION_BLOCKED';
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE' || code === 'EHOSTUNREACH') {
    return 'CONNECTION_BLOCKED';
  }
  if (code === 'ENETUNREACH' || code === 'ENETDOWN' || code === 'EADDRNOTAVAIL') {
    return 'NETWORK_UNREACHABLE';
  }
  // fetch 的 DNS/连接失败统一是 TypeError: fetch failed，只能判到"这台连不出去"。
  return 'NETWORK_UNREACHABLE';
}

export function headersWithDevice(deviceId: string, extra?: Record<string, string>): Record<string, string> {
  return { [DEVICE_ID_HEADER]: deviceId, ...extra };
}

/**
 * GET /api/v1/config。
 *
 * 304 必须原样带回：调用方拿到 notModified 就立即 return，不读盘、不重算、不重绘（AC-09）。
 * 404 不是错误——服务端明确回答"还没发布过"，调用方按 T3.6.2 走正常空状态。
 */
export async function fetchConfig(args: {
  baseUrl: string;
  deviceId: string;
  ifNoneMatch: string | null;
  timeoutMs?: number;
}): Promise<ConfigReply> {
  const headers = headersWithDevice(args.deviceId);
  if (args.ifNoneMatch !== null && args.ifNoneMatch.length > 0) {
    headers['If-None-Match'] = args.ifNoneMatch;
  }
  try {
    const response = await fetch(`${args.baseUrl}${API_PREFIX}/config`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (response.status === 304) {
      return { kind: 'notModified', status: 304, body: null, etag: response.headers.get('etag'), publishedAt: null, reason: 'UNKNOWN' };
    }
    if (response.status === 404) {
      return { kind: 'notPublished', status: 404, body: null, etag: null, publishedAt: null, reason: 'UNKNOWN' };
    }
    if (!response.ok) {
      return { kind: 'error', status: response.status, body: null, etag: null, publishedAt: null, reason: 'UNKNOWN' };
    }
    return {
      kind: 'ok',
      status: 200,
      body: await response.text(),
      etag: response.headers.get('etag'),
      // 数据时间只认响应头，绝不拿本机时钟推算（PRD §13）。
      publishedAt: response.headers.get('x-tl-published-at'),
      reason: 'UNKNOWN',
    };
  } catch (err) {
    return { kind: 'error', status: 0, body: null, etag: null, publishedAt: null, reason: reasonOfError(err) };
  }
}

/** POST /api/v1/feedback。上报侧不需鉴权（离线排队后补发是常态），但必须带设备标识。 */
export async function postFeedback(args: {
  baseUrl: string;
  deviceId: string;
  batch: FeedbackBatch;
  timeoutMs?: number;
}): Promise<PostReply> {
  return postJson({
    baseUrl: args.baseUrl,
    deviceId: args.deviceId,
    path: `${API_PREFIX}/feedback`,
    body: args.batch,
    timeoutMs: args.timeoutMs,
  });
}

/** POST /api/v1/telemetry。调用前必须已过隐私门，见 syncClient 的 canReportTelemetry。 */
export async function postTelemetry(args: {
  baseUrl: string;
  deviceId: string;
  batch: TelemetryBatch;
  timeoutMs?: number;
}): Promise<PostReply> {
  return postJson({
    baseUrl: args.baseUrl,
    deviceId: args.deviceId,
    path: `${API_PREFIX}/telemetry`,
    body: args.batch,
    timeoutMs: args.timeoutMs,
  });
}

async function postJson(args: {
  baseUrl: string;
  deviceId: string;
  path: string;
  body: unknown;
  timeoutMs?: number;
}): Promise<PostReply> {
  const reply = await postJsonEnvelope<unknown>(args);
  return { ok: reply !== null, status: reply === null ? 0 : 200 };
}

/** 需要读响应体时使用（challenge / verify）。解析不出信封一律返回 null。 */
export async function postJsonEnvelope<T>(args: {
  baseUrl: string;
  deviceId: string;
  path: string;
  body: unknown;
  timeoutMs?: number;
}): Promise<T | null> {
  const raw = Buffer.from(JSON.stringify(args.body), 'utf8');
  try {
    const response = await fetch(`${args.baseUrl}${args.path}`, {
      method: 'POST',
      headers: headersWithDevice(args.deviceId, { 'content-type': STRICT_JSON_CONTENT_TYPE }),
      body: raw,
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const envelope = (await response.json()) as { code?: number; data?: T };
    if (envelope.code !== 0 || envelope.data === undefined) return null;
    return envelope.data;
  } catch {
    return null;
  }
}
