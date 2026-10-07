/**
 * src/server/routes/health.route.ts —— GET /health（端点 1）
 *
 * 不需鉴权：服务发现之后要先确认"这个端口上确实是 TeamLaunch"，
 * 还没拿到令牌的时候也必须能问。
 */

import type { FastifyInstance } from 'fastify';
import { createHealthController } from '../controllers/health.controller.ts';
import { sendOk } from '../support/envelope.ts';
import type { RouteDeps } from './deps.ts';

export function registerHealthRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createHealthController(deps.ctx);

  app.get('/health', async (_req, reply) => {
    sendOk(reply, controller.get());
  });
}
