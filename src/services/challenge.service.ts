/**
 * src/services/challenge.service.ts —— 挑战应答（ADR-006 §2）
 *
 * 口令永不上网：服务端发随机 challenge + salt + kdf 参数，客户端本地派生出
 * verifier 后计算 proof，服务端用自己存的 verifier 重算比对。
 *
 * challenge 单次有效、60 秒过期 —— 同时解决明文传输与重放。
 * "单次有效"的实现是**取出即删除**（delete-on-read），失败也算用掉：
 * 否则攻击者可以在同一个 challenge 上无限次试 proof。
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AUTH } from '../shared/constants.ts';
import { AppError } from '../shared/errors.ts';
import type { CredentialService } from './credential.service.ts';

export interface ChallengeInfo {
  challengeId: string;
  challenge: string;
  salt: string;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; keylen: number };
  expiresAt: string;
  serverId: string;
}

interface PendingChallenge {
  challenge: string;
  deviceId: string;
  expiresAt: number;
}

export class ChallengeService {
  private readonly pending = new Map<string, PendingChallenge>();

  constructor(
    private readonly credentials: CredentialService,
    private readonly serverId: string,
  ) {}

  create(deviceId: string): ChallengeInfo {
    const challengeId = randomUUID();
    const challenge = randomBytes(AUTH.challengeBytes).toString('base64');
    const expiresAt = Date.now() + AUTH.challengeTtlMs;
    this.pending.set(challengeId, { challenge, deviceId, expiresAt });
    const salt = this.credentials.salt;
    return {
      challengeId,
      challenge,
      salt: salt === null ? '' : salt.toString('base64'),
      kdf: this.credentials.kdf,
      expiresAt: new Date(expiresAt).toISOString(),
      serverId: this.serverId,
    };
  }

  /**
   * 校验 proof。取出即删除，且过期与挑战/设备不匹配都走同一条"失败"路径。
   * 注意：这里**不区分**"挑战不存在"与"proof 错误"以外的细节，
   * 错误码刻意收敛为 ERR_CHALLENGE_EXPIRED / ERR_BAD_PROOF 两种。
   */
  verify(challengeId: string, deviceId: string, proof: string): void {
    const pending = this.pending.get(challengeId);
    if (pending === undefined) {
      throw new AppError('ERR_CHALLENGE_EXPIRED', '登录挑战已过期，请重试');
    }
    // 单次有效：不论成败都消耗掉。
    this.pending.delete(challengeId);
    if (Date.now() > pending.expiresAt) {
      throw new AppError('ERR_CHALLENGE_EXPIRED', '登录挑战已过期，请重试');
    }
    if (pending.deviceId !== deviceId) {
      throw new AppError('ERR_BAD_PROOF', '口令校验未通过');
    }

    const key = this.credentials.key;
    if (key === null) {
      throw new AppError('ERR_BAD_PROOF', '口令校验未通过');
    }
    const expected = this.computeProof(key, challengeId, pending.challenge, deviceId);
    if (!constantTimeEquals(expected, proof)) {
      throw new AppError('ERR_BAD_PROOF', '口令校验未通过');
    }
  }

  /** proof = HMAC-SHA256(verifier, challengeId:challenge:deviceId:serverId) */
  private computeProof(key: Buffer, challengeId: string, challenge: string, deviceId: string): string {
    return createHmac('sha256', key)
      .update(`${challengeId}:${challenge}:${deviceId}:${this.serverId}`)
      .digest('base64');
  }

  /** 供客户端侧复用同一套算法，避免两端各写一份而漂移。 */
  static proofOf(key: Buffer, args: {
    challengeId: string;
    challenge: string;
    deviceId: string;
    serverId: string;
  }): string {
    return createHmac('sha256', key)
      .update(`${args.challengeId}:${args.challenge}:${args.deviceId}:${args.serverId}`)
      .digest('base64');
  }

  /** 清理过期挑战。由调用方定时触发，不做后台定时器（服务启停由主进程掌控）。 */
  sweep(now: number = Date.now()): void {
    for (const [id, pending] of this.pending) {
      if (now > pending.expiresAt) this.pending.delete(id);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

/** 长度不等时 timingSafeEqual 会抛异常，必须先比长度。 */
export function constantTimeEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
