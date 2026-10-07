/**
 * src/server/routes/revisions.route.ts —— GET /revisions（端点 8）与还原（端点 9）
 *
 * 还原是写操作，必须走与发布完全相同的守卫：令牌 + 签名 + 乐观并发。
 * 少任何一样都会变成"能在别人发布之后静默覆盖"，而这正是最难查的那一类事故
 * ——数据没丢，只是悄悄变成了旧内容。
 */

import type { FastifyInstance } from 'fastify';
import { createRevisionsController } from '../controllers/revisions.controller.ts';
import { QUOTA, createRateLimitGuard } from '../hooks/rate-limit.ts';
import { sendOk } from '../support/envelope.ts';
import { deviceIdOf, readIntParam, readRevisionParam } from '../support/params.ts';
import { parseOrThrow } from '../support/validate.ts';
import { RestoreRequestSchema } from '../support/requests.ts';
import { MAX_PAGE_LIMIT } from './changes.route.ts';
import type { RouteDeps } from './deps.ts';

export function registerRevisionsRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createRevisionsController(deps.ctx);
  const readLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.read);
  const writeLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.write);

  app.get(
    '/revisions',
    { preHandler: [readLimit.preHandler, deps.requireToken] },
    async (req, reply) => {
      const limit = readIntParam(req.query, 'limit', MAX_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
      sendOk(reply, await controller.list(limit));
    },
  );

  app.post(
    '/revisions/:revision/restore',
    { preHandler: [writeLimit.preHandler, deps.requireSignature] },
    async (req, reply) => {
      const revision = readRevisionParam((req.params as { revision?: unknown }).revision);
      const body = parseOrThrow(RestoreRequestSchema, req.body);
      const restored = await controller.restore(revision, body, deviceIdOf(req.headers));
      sendOk(reply, restored, { 'X-TL-Revision': restored.revision });
    },
  );
}
