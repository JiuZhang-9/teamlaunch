/**
 * src/server/hooks/auth.ts —— Bearer 令牌 + 写请求 HMAC 签名（ADR-006 §3）
 *
 * 这是**唯一的安全边界**。员工端 UI 隐藏编辑入口不是安全边界——
 * 局域网里任何人都能直接 curl。因此本文件必须无条件装在每一个写端点上。
 *
 * 校验顺序（任一失败即 401）：
 *   1. Authorization: Bearer <token> 存在且令牌有效（8 小时，仅内存）
 *   2. X-TL-Timestamp 是整数且与服务端时间偏差 ≤ 120 s
 *   3. X-TL-Nonce 存在且 5 分钟内未出现过
 *   4. 签名一致：base64(HMAC-SHA256(key=verifier,
 *        msg = token \n method \n path \n timestamp \n nonce \n sha256(rawBody)))
 *
 * 收益：即使令牌被嗅探，没有 verifier（即没有口令）也构造不出任何一次合法发布；
 * 同时天然防重放（nonce）与防正文篡改（sha256(rawBody) 进签名）。
 *
 * 关于 path：签名覆盖的是**完整请求路径且含 /api/v1 前缀、不含查询串**，
 * 例如 `/api/v1/config`。客户端必须按同一口径构造，见 docs/api/write-request-signing.md。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AUTH,
  SIGNATURE_FIELD_SEPARATOR,
  SIGNATURE_HEADERS,
} from '../../shared/constants.ts';
import { AppError } from '../../shared/errors.ts';
import { sha256Hex } from '../../shared/canonical-hash.ts';
import type { TokenService, TokenSession } from '../../services/token.service.ts';
import { rawBodyOf, signaturePathOf } from './raw-body.ts';

export interface SignedRequest extends FastifyRequest {
  tlSession?: TokenSession;
}

/** nonce 去重表：只记成功的，失败不记（否则攻击者可消耗合法 nonce 做拒绝服务）。 */
class NonceStore {
  private readonly seen = new Map<string, number>();

  has(key: string, now: number): boolean {
    const expiresAt = this.seen.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }

  add(key: string, now: number): void {
    this.seen.set(key, now + AUTH.nonceTtlMs);
    if (this.seen.size > 5000) this.sweep(now);
  }

  sweep(now: number = Date.now()): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}

export function createSignatureVerifier(tokens: TokenService): {
  preHandler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  sweep: () => void;
} {
  const nonces = new NonceStore();

  const preHandler = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const now = Date.now();
    const session = resolveBearer(req, tokens);
    (req as SignedRequest).tlSession = session;

    const timestamp = readHeader(req, SIGNATURE_HEADERS.timestamp);
    const nonce = readHeader(req, SIGNATURE_HEADERS.nonce);
    const signature = readHeader(req, SIGNATURE_HEADERS.signature);

    const ts = Number.parseInt(timestamp ?? '', 10);
    if (timestamp === null || !Number.isSafeInteger(ts) || Math.abs(now - ts) > AUTH.timestampSkewMs) {
      throw new AppError('ERR_SIGNATURE_INVALID', '请求签名校验未通过');
    }
    if (nonce === null || nonce.length === 0 || nonce.length > AUTH.nonceMaxLength) {
      throw new AppError('ERR_SIGNATURE_INVALID', '请求签名校验未通过');
    }
    if (signature === null || signature.length === 0) {
      throw new AppError('ERR_SIGNATURE_INVALID', '请求签名校验未通过');
    }
    if (nonces.has(`${session.token}:${nonce}`, now)) {
      throw new AppError('ERR_SIGNATURE_INVALID', '请求签名校验未通过');
    }

    const expected = sign(session, {
      method: req.method,
      path: signaturePathOf(req),
      timestamp,
      nonce,
      body: rawBodyOf(req),
    });
    if (!timingSafeEqualUtf8(expected, signature)) {
      throw new AppError('ERR_SIGNATURE_INVALID', '请求签名校验未通过');
    }

    nonces.add(`${session.token}:${nonce}`, now);
  };

  return { preHandler, sweep: () => nonces.sweep() };
}

/**
 * 只读端点的守卫：只验 Bearer 令牌，**不验签名**（constants.SIGNED_METHODS 的约定）。
 *
 * GET 是幂等读取，签名要解决的"正文篡改/重放"对它没有意义；
 * 而 openapi 契约对 `/revisions`、`/feedback/summary`、`/diagnostics`
 * 就是这样规定的。令牌泄露的爆炸半径由 8 小时有效期与"仅内存"来兜。
 */
export function createTokenGuard(tokens: TokenService): {
  preHandler: (req: FastifyRequest) => Promise<void>;
} {
  return {
    preHandler: async (req: FastifyRequest): Promise<void> => {
      (req as SignedRequest).tlSession = resolveBearer(req, tokens);
    },
  };
}

function resolveBearer(req: FastifyRequest, tokens: TokenService): TokenSession {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.toLowerCase().startsWith('bearer ')) {
    throw new AppError('ERR_AUTH_REQUIRED', '需要管理员凭据');
  }
  const token = header.slice(7).trim();
  if (token.length === 0) throw new AppError('ERR_AUTH_REQUIRED', '需要管理员凭据');
  const session = tokens.resolve(token);
  if (session === null) throw new AppError('ERR_TOKEN_INVALID', '登录状态已失效，请重新解锁');
  return session;
}

function readHeader(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/** 供客户端与测试复用同一套签名构造，避免两端各写一份。 */
export function sign(
  session: { token: string; key: Buffer },
  args: { method: string; path: string; timestamp: string; nonce: string; body: Buffer },
): string {
  const message = [
    session.token,
    args.method,
    args.path,
    args.timestamp,
    args.nonce,
    sha256Hex(args.body),
  ].join(SIGNATURE_FIELD_SEPARATOR);
  return createHmac('sha256', session.key).update(message).digest('base64');
}

/** 长度不等时 timingSafeEqual 会抛异常，必须先比长度。 */
export function timingSafeEqualUtf8(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
