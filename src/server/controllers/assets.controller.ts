/**
 * src/server/controllers/assets.controller.ts —— GET /assets/{hash}
 *
 * 资源不可变：哈希即地址，因此可以 `max-age=31536000, immutable`。
 * 若哪天需要"同一个地址换内容"，正确做法是换哈希，而不是改缓存头——
 * 否则客户端会拿着旧内容当新的，且极难复现。
 *
 * ETag 用哈希本身（不带引号的强校验器在这里也合法，但统一带引号更省心）。
 */

import { AppError } from '../../shared/errors.ts';
import type { StoredAsset } from '../../repositories/asset.repository.ts';
import type { ServiceContext } from '../container.ts';

/** 一年。不可变内容不设更短，缩短只会让每台客户端反复重取图标。 */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function createAssetsController(ctx: ServiceContext) {
  return {
    async get(hash: string): Promise<StoredAsset> {
      const asset = await ctx.assets.get(hash);
      // 哈希格式不合法与"文件不存在"都回 404：不区分，避免把存储布局泄露出去。
      if (asset === null) {
        throw new AppError('ERR_NOT_FOUND', '未找到请求的资源');
      }
      return asset;
    },
  };
}
