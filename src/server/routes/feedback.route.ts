/**
 * src/server/routes/feedback.route.ts —— POST /feedback（端点 10）与汇总（端点 11）
 *
 * 上报侧是员工可用、不需鉴权（离线排队后补发是常态）；
 * 汇总侧是管理员视图，必须带令牌。
 *
 * 上报成功只代表"服务端已确认接收"，客户端不得在写入本地队列时就提示成功。
 * 这条写在 openapi 里，也决定了这里的响应只回计数，不回"已处理"。
 */

import type { FastifyInstance } from 'fastify';
import { createFeedbackController } from '../controllers/feedback.controller.ts';
import { QUOTA, createRateLimitGuard } from '../hooks/rate-limit.ts';
import { sendOk } from '../support/envelope.ts';
import { deviceIdOf, readIntParam, readIsoParam } from '../support/params.ts';
import { ANONYMOUS_BUCKET } from '../hooks/rate-limit.ts';
import type { RouteDeps } from './deps.ts';
import { MAX_PAGE_LIMIT } from './changes.route.ts';

export function registerFeedbackRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createFeedbackController(deps.ctx);
  const postLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.feedback);
  const readLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.read);

  app.post('/feedback', { preHandler: [postLimit.preHandler] }, async (req, reply) => {
    // 没有 deviceId 的请求落匿名桶：仍然限流，只是配额共享。
    const deviceId = deviceIdOf(req.headers) ?? ANONYMOUS_BUCKET;
    sendOk(reply, await controller.submit(req.body, deviceId));
  });

  app.get(
    '/feedback/summary',
    { preHandler: [readLimit.preHandler, deps.requireToken] },
    async (req, reply) => {
      const since = readIsoParam(req.query, 'since');
      const limit = readIntParam(req.query, 'limit', MAX_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
      sendOk(reply, await controller.summary(since, limit));
    },
  );
}
