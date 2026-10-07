/**
 * src/services/token.service.ts —— 短时会话令牌（ADR-006 §2）
 *
 * 8 小时有效、**仅内存不落盘**（服务重启即全部失效）。
 * 令牌本身不赋予写权限：写请求还必须有 HMAC 签名，签名密钥是 verifier。
 * 因此只嗅探到令牌而没有口令的人，构造不出任何一次合法发布。
 */

import { randomBytes } from 'node:crypto';
import { AUTH } from '../shared/constants.ts';

export interface TokenSession {
  token: string;
  deviceId: string;
  /** 验签密钥（= verifier）。仅内存。 */
  key: Buffer;
  expiresAt: number;
}

export interface IssuedToken {
  token: string;
  expiresAt: string;
}

export class TokenService {
  private readonly sessions = new Map<string, TokenSession>();

  issue(deviceId: string, key: Buffer): IssuedToken {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + AUTH.tokenTtlMs;
    this.sessions.set(token, { token, deviceId, key, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** 过期令牌即视为不存在，并顺手清掉。 */
  resolve(token: string): TokenSession | null {
    const session = this.sessions.get(token);
    if (session === undefined) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }

  sweep(now: number = Date.now()): void {
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) this.sessions.delete(token);
    }
  }

  get activeCount(): number {
    return this.sessions.size;
  }
}
