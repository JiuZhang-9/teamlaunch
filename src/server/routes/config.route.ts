/**
 * src/server/routes/config.route.ts —— GET /config（端点 2）与 PUT /config（端点 7）
 *
 * GET：命中 `If-None-Match` 立即 304 返回，**不进任何后续处理**。
 *      响应头带 ETag / X-TL-Revision / X-TL-Published-At；
 *      "数据时间"必须用 publishedAt，不得用本机时钟推算（PRD §13）。
 *
 * PUT：签名守卫在前，容量闸与 schema 在后；新版本由服务端推进，
 *      客户端提交的 revision 一律忽略。
 */

import type { FastifyInstance } from 'fastify';
import { createConfigController } from '../controllers/config.controller.ts';
import { QUOTA, createRateLimitGuard } from '../hooks/rate-limit.ts';
import { rawBodyOf } from '../hooks/raw-body.ts';
import { sendOk, sendNotModified } from '../support/envelope.ts';
import { deviceIdOf, headerValue } from '../support/params.ts';
import type { RouteDeps } from './deps.ts';

export function registerConfigRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createConfigController(deps.ctx);
  const readLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.read);
  const writeLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.write);

  app.get('/config', { preHandler: [readLimit.preHandler] }, async (req, reply) => {
    const result = controller.get(headerValue(req.headers, 'if-none-match'), deviceIdOf(req.headers));
    if (result.kind === 'notModified') {
      sendNotModified(reply, result.etag);
      return;
    }
    sendOk(reply, result.config, {
      ETag: result.etag,
      'X-TL-Revision': result.revision,
      'X-TL-Published-At': result.publishedAt,
    });
  });

  app.put(
    '/config',
    { preHandler: [writeLimit.preHandler, deps.requireSignature] },
    async (req, reply) => {
      const published = await controller.publish({
        body: req.body,
        // 容量按**原始字节**判定：解析后的对象再序列化会漏算转义与空白。
        bodyBytes: rawBodyOf(req).length,
        deviceId: deviceIdOf(req.headers),
      });
      sendOk(reply, published, { 'X-TL-Revision': published.revision });
    },
  );
}
