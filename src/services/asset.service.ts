/**
 * src/services/asset.service.ts —— 资源寻址（Spec 端点 4）
 *
 * 资源不可变：哈希即地址，因此可以 `max-age=31536000, immutable` 永久缓存。
 * 读取时仓库层会重新校验 sha256，哈希与内容不符即视为不存在。
 */

import type { AssetRepository, StoredAsset } from '../repositories/asset.repository.ts';
import { Sha256HexSchema } from '../shared/schema/common.ts';

export class AssetService {
  constructor(private readonly repository: AssetRepository) {}

  async get(hash: string): Promise<StoredAsset | null> {
    if (!Sha256HexSchema.safeParse(hash).success) return null;
    return this.repository.get(hash);
  }

  async put(bytes: Buffer): Promise<string> {
    return this.repository.put(bytes);
  }
}
