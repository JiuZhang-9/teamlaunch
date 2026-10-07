/**
 * src/server/routes/changes.route.ts —— GET /changes（端点 3）
 *
 * 员工侧的增量。`since` 缺省 0 即全量；limit 上限 20 与 openapi 一致。
 * 非法参数一律 400：静默取默认值会让客户端"看起来正常"但拿到错误切片。
 */

import type { FastifyInstance } from 'fastify';
import { createChangesController } from '../controllers/changes.controller.ts';
import { QUOTA, createRateLimitGuard } from '../hooks/rate-limit.ts';
import { sendOk } from '../support/envelope.ts';
import { readIntParam, readSinceParam } from '../support/params.ts';
import type { RouteDeps } from './deps.ts';

/** openapi Limit 参数的 maximum。写死在这里，改契约时改这一处。 */
export const MAX_PAGE_LIMIT = 20;

export function registerChangesRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createChangesController(deps.ctx);
  const readLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.read);

  app.get('/changes', { preHandler: [readLimit.preHandler] }, async (req, reply) => {
    const since = readSinceParam(req.query, 'since', 0);
    const limit = readIntParam(req.query, 'limit', MAX_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
    sendOk(reply, await controller.list(since, limit));
  });
}
