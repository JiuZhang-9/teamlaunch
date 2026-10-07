/**
 * src/repositories/asset.repository.ts —— 内容寻址的不可变资源
 *
 * 寻址即内容哈希：`assets/<前2位>/<hash>.<ext>`。
 * 内容寻址带来一个关键性质——**并发写同一资源是天然幂等的**，
 * 因此"检查是否存在再写入"在这里不存在覆盖风险（字节相同，哈希才相同）。
 *
 * 读取时**重新校验 sha256**：磁盘上的文件可能被外部改动或被截断，
 * 哈希不符即视为不存在，绝不下发一个哈希与其内容不符的响应。
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound, writeFileAtomic } from './atomic-json.ts';
import type { StoragePaths } from './paths.ts';

export interface StoredAsset {
  hash: string;
  bytes: Buffer;
  contentType: string;
}

function detectContentType(bytes: Buffer): { ext: string; contentType: string } {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return { ext: 'ico', contentType: 'image/x-icon' };
  }
  return { ext: 'bin', contentType: 'application/octet-stream' };
}

export class AssetRepository {
  constructor(private readonly paths: StoragePaths) {}

  private shardDir(hash: string): string {
    return join(this.paths.assetsDir, hash.slice(0, 2));
  }

  /** 写入并返回哈希。已存在则直接返回（内容寻址，无需再判重）。 */
  async put(bytes: Buffer): Promise<string> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const dir = this.shardDir(hash);
    await mkdir(dir, { recursive: true });
    const { ext } = detectContentType(bytes);
    await writeFileAtomic(join(dir, `${hash}.${ext}`), bytes);
    return hash;
  }

  /** 读取并校验。哈希不符或文件缺失都返回 null——宁可下发 404，不可下发错内容。 */
  async get(hash: string): Promise<StoredAsset | null> {
    const dir = this.shardDir(hash);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    const match = entries.find((name) => name.startsWith(`${hash}.`));
    if (match === undefined) return null;
    const bytes = await readFile(join(dir, match));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== hash) return null;
    return { hash, bytes, contentType: detectContentType(bytes).contentType };
  }
}
