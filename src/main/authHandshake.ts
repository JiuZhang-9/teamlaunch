/**
 * src/main/authHandshake.ts —— 跨机鉴权：挑战应答 + 写请求签名（ADR-006）
 *
 * 与管理员本机的 `credentials.verifyPassword()` 直调是两条不同的路：
 * 那条是同进程、无网络暴露面的捷径，只在起服务的那一侧成立；
 * 只要口令要过网（哪怕只是局域网），就必须走这里。
 *
 * 握手：服务端发 challenge + salt + kdf 参数 → 客户端本地派生 verifier 算 proof
 *      → 服务端比对 → 发令牌。口令本身永不上网。
 * 写：Bearer 令牌之上还要 HMAC 签名，密钥就是 verifier。
 *     只嗅探到令牌而没有口令的人，构造不出任何一次合法写请求。
 *
 * proof 与签名的算法都复用服务端那份实现，不另写一份——两端各写一份迟早漂移，
 * 而漂移的表现是"偶尔 401"，现场会被误判成网络问题。
 */

import { randomBytes } from 'node:crypto';
import { API_PREFIX, SIGNATURE_HEADERS, STRICT_JSON_CONTENT_TYPE } from '../shared/constants.ts';
import { sign } from '../server/hooks/auth.ts';
import {
  DEFAULT_TIMEOUT_MS,
  headersWithDevice,
  postJsonEnvelope,
} from './syncTransport.ts';
import type { ChallengeReply, ClientSession, PostReply } from './syncTransport.ts';

export type { ClientSession, ChallengeReply };

/* ------------------------------------------------------------------ *
 * 挑战应答：口令永不上网
 * ------------------------------------------------------------------ */

/**
 * 注意：challenge 是**单次有效**（服务端取出即删除，失败也算用掉）。
 * 这里因此只能发一次请求——先 POST 再看响应码、第二次重发会拿到另一个挑战，
 * 白白消耗一个，还会让"失败重试"变成"换个挑战再试"。
 */
export async function postChallenge(args: {
  baseUrl: string;
  deviceId: string;
  timeoutMs?: number;
}): Promise<ChallengeReply | null> {
  const envelope = await postJsonEnvelope<ChallengeReply>({
    baseUrl: args.baseUrl,
    deviceId: args.deviceId,
    path: `${API_PREFIX}/auth/challenge`,
    body: { deviceId: args.deviceId },
    timeoutMs: args.timeoutMs,
  });
  return envelope;
}

/**
 * POST /api/v1/auth/verify：回 proof 换令牌。
 *
 * proof 的算法同样复用服务端那份（ChallengeService.proofOf），不另写一份。
 * KDF 参数先与本地常量比对再派生，不一致直接拒绝——由调用方在派生前调用
 * `assertTrustedKdf`（shared/kdf.ts），本层不做任何"试试看"的回退。
 */
export async function postVerify(args: {
  baseUrl: string;
  deviceId: string;
  challengeId: string;
  challenge: string;
  proof: string;
  timeoutMs?: number;
}): Promise<{ token: string; expiresAt: string } | null> {
  return postJsonEnvelope<{ token: string; expiresAt: string }>({
    baseUrl: args.baseUrl,
    deviceId: args.deviceId,
    path: `${API_PREFIX}/auth/verify`,
    body: {
      challengeId: args.challengeId,
      deviceId: args.deviceId,
      proof: args.proof,
    },
    timeoutMs: args.timeoutMs,
  });
}

/* ------------------------------------------------------------------ *
 * 写请求签名（管理员把客户端指向独立服务器时才会用到）
 * ------------------------------------------------------------------ */

/**
 * 签名写请求。body 的字节先定死，再同时喂给 fetch 与 HMAC ——
 * 顺序反了就会签一个和发出去不一样的串，表现为随机 401。
 */
export async function signedWrite(args: {
  baseUrl: string;
  session: ClientSession;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  deviceId: string;
  timeoutMs?: number;
}): Promise<PostReply> {
  const raw = Buffer.from(JSON.stringify(args.body), 'utf8');
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString('base64url');
  const signature = sign(args.session, {
    method: args.method,
    path: args.path,
    timestamp,
    nonce,
    body: raw,
  });
  try {
    const response = await fetch(`${args.baseUrl}${args.path}`, {
      method: args.method,
      headers: headersWithDevice(args.deviceId, {
        'content-type': STRICT_JSON_CONTENT_TYPE,
        authorization: `Bearer ${args.session.token}`,
        [SIGNATURE_HEADERS.timestamp]: timestamp,
        [SIGNATURE_HEADERS.nonce]: nonce,
        [SIGNATURE_HEADERS.signature]: signature,
      }),
      body: raw,
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
