/**
 * src/server/routes/assets.route.ts —— GET /assets/{hash}（端点 4）
 *
 * 二进制直出，不走统一信封：信封是给 JSON 用的，给 PNG 套一层
 * `{code,data}` 只会让客户端必须自己解 base64，白耗一倍内存。
 *
 * 缓存头固定 immutable。哈希即内容，地址不变则内容永不变。
 */

import type { FastifyInstance } from 'fastify';
import { ASSET_CACHE_CONTROL, createAssetsController } from '../controllers/assets.controller.ts';
import { QUOTA, createRateLimitGuard } from '../hooks/rate-limit.ts';
import { headerValue } from '../support/params.ts';
import type { RouteDeps } from './deps.ts';

export function registerAssetsRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createAssetsController(deps.ctx);
  const readLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.read);

  app.get('/assets/:hash', { preHandler: [readLimit.preHandler] }, async (req, reply) => {
    const hash = String((req.params as { hash?: unknown }).hash ?? '');
    const asset = await controller.get(hash);

    // 条件请求：客户端带 ETag 命中即 304，图标不会在每次同步时被重取。
    if (headerValue(req.headers, 'if-none-match') === `"${asset.hash}"`) {
      void reply.status(304).send();
      return;
    }

    void reply
      .header('Content-Type', asset.contentType)
      .header('Cache-Control', ASSET_CACHE_CONTROL)
      .header('ETag', `"${asset.hash}"`)
      .send(asset.bytes);
  });
}
