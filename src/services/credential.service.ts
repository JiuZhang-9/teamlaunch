/**
 * src/services/credential.service.ts —— 管理员口令派生与验证（ADR-006 §1）
 *
 * - `verifier = scrypt(password, salt, 32)`，明文口令从不落盘。
 * - scrypt 走**异步** API：N=2^15 的单次派生约 50–100 ms，
 *   同步版会卡住主进程，管理员点"解锁"时整个界面会顿一下。
 * - 口令长度不足时抛的是通用文案，**不泄露口令规则**（PRD §14.1）。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CredentialRepository, CredentialRecord } from '../repositories/credential.repository.ts';
import { AUTH } from '../shared/constants.ts';
import { AppError } from '../shared/errors.ts';
import { deriveVerifier, deriveWithLocalParams, fitsMaxmem } from '../shared/kdf.ts';

export interface KdfParams {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
  keylen: number;
}

export class CredentialService {
  private record: CredentialRecord | null = null;
  private verifier: Buffer | null = null;

  constructor(private readonly repository: CredentialRepository) {}

  /** 启动时调用一次。没有凭据 = 尚未设置口令，属正常首次运行状态。 */
  async load(): Promise<void> {
    this.record = await this.repository.load();
    this.verifier = this.record === null ? null : Buffer.from(this.record.verifier, 'base64');
  }

  hasCredential(): boolean {
    return this.record !== null;
  }

  get kdf(): KdfParams {
    const base = { name: 'scrypt' as const, ...AUTH.scrypt };
    if (this.record === null) return base;
    return { name: 'scrypt', N: this.record.N, r: this.record.r, p: this.record.p, keylen: this.record.keylen };
  }

  get salt(): Buffer | null {
    return this.record === null ? null : Buffer.from(this.record.salt, 'base64');
  }

  /** 验签与校验 proof 都要用。没有口令时返回 null。 */
  get key(): Buffer | null {
    return this.verifier;
  }

  /**
   * 设置（或重设）口令。弱口令只给通用文案，不告诉对方具体差在哪。
   */
  async setPassword(password: string): Promise<void> {
    if (typeof password !== 'string' || password.length < AUTH.minPasswordLength) {
      throw new AppError('ERR_BAD_REQUEST', '口令不符合安全要求');
    }
    const salt = randomBytes(AUTH.saltBytes);
    // 参数取本地常量那一档；maxmem 由 shared/kdf.ts 统一带上（不带会撞 Node 默认上限）。
    const verifier = await deriveWithLocalParams(password, salt);
    const record: CredentialRecord = {
      kdf: 'scrypt',
      N: AUTH.scrypt.N,
      r: AUTH.scrypt.r,
      p: AUTH.scrypt.p,
      salt: salt.toString('base64'),
      verifier: verifier.toString('base64'),
      keylen: AUTH.scrypt.keylen,
      createdAt: new Date().toISOString(),
    };
    await this.repository.save(record);
    this.record = record;
    this.verifier = verifier;
  }

  /**
   * 本机解锁（IPC 路径）用：直接比对派生结果。
   *
   * 参数来自本机 credential.json。它虽然是我们自己写的，但**磁盘上的文件可以被改**，
   * 因此派生前先过内存上限这道网：否则改一下 N 就能让解锁路径分配上 GB 内存。
   * 超限按内部错误处理——本机凭据文件不自洽，本来就不是"口令错"。
   */
  async verifyPassword(password: string): Promise<boolean> {
    const record = this.record;
    if (record === null) return false;
    const params = { N: record.N, r: record.r, p: record.p, keylen: record.keylen };
    if (!fitsMaxmem(params)) {
      throw new AppError('ERR_INTERNAL', '服务内部错误');
    }
    const derived = await deriveVerifier(password, Buffer.from(record.salt, 'base64'), params);
    return timingSafeEqual(derived, Buffer.from(record.verifier, 'base64'));
  }
}
