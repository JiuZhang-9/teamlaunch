/**
 * src/server/routes/diagnostics.route.ts —— GET /diagnostics（端点 13）
 *
 * 管理员一屏定位用。只验令牌不验签名（幂等读取），
 * 但同样限流：它会 spawn PowerShell 查防火墙与网络配置文件，
 * 不限流的话一次刷页面就可能把管理员机拖慢。
 */

import type { FastifyInstance } from 'fastify';
import { createDiagnosticsController } from '../controllers/diagnostics.controller.ts';
import { QUOTA, createRateLimitGuard } from '../hooks/rate-limit.ts';
import { sendOk } from '../support/envelope.ts';
import type { RouteDeps } from './deps.ts';

export function registerDiagnosticsRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createDiagnosticsController(deps.ctx);
  const limit = createRateLimitGuard(deps.ctx.limiter, QUOTA.read);

  app.get('/diagnostics', { preHandler: [limit.preHandler, deps.requireToken] }, async (_req, reply) => {
    sendOk(reply, await controller.inspect());
  });
}
