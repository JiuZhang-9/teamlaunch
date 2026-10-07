/**
 * src/repositories/credential.repository.ts —— 管理员口令凭据（ADR-006 §1）
 *
 * 落盘内容：`{kdf:'scrypt', N, r, p, salt(base64), verifier(base64), createdAt}`。
 * 明文口令从不落盘；`verifier = scrypt(password, salt, 32)`，它等价于口令，
 * 因此写完立刻用 icacls 收敛 ACL 到当前用户（平台层，异步、带超时）。
 */

import { readJsonFile, writeJsonAtomic } from './atomic-json.ts';
import { restrictToCurrentUser } from '../platform/acl.ts';
import type { StoragePaths } from './paths.ts';

export interface CredentialRecord {
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  /** base64 */
  salt: string;
  /** base64，32 字节 */
  verifier: string;
  keylen: number;
  createdAt: string;
}

function isCredentialRecord(value: unknown): value is CredentialRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    r.kdf === 'scrypt' &&
    typeof r.N === 'number' &&
    typeof r.r === 'number' &&
    typeof r.p === 'number' &&
    typeof r.salt === 'string' &&
    typeof r.verifier === 'string'
  );
}

export class CredentialRepository {
  constructor(private readonly paths: StoragePaths) {}

  async load(): Promise<CredentialRecord | null> {
    const raw = await readJsonFile<unknown>(this.paths.credential);
    return isCredentialRecord(raw) ? raw : null;
  }

  async save(record: CredentialRecord): Promise<void> {
    await writeJsonAtomic(this.paths.credential, record);
    // ACL 收敛失败不阻塞启动：口令文件仍在本机用户目录下，只是少一层加固。
    await restrictToCurrentUser(this.paths.credential);
  }
}
