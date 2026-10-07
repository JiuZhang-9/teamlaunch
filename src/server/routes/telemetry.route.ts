/**
 * src/server/routes/telemetry.route.ts —— POST /telemetry（端点 12）
 *
 * 配额 1 批/设备/分钟：遥测的价值在于趋势，密集上报没有意义，
 * 而且配额收紧能让"客户端失控循环上报"在服务端就停下。
 *
 * 请求来源 IP 一律不记录，访问日志也不记（见 hooks/logging.ts）。
 */

import type { FastifyInstance } from 'fastify';
import { createTelemetryController } from '../controllers/telemetry.controller.ts';
import { QUOTA, createRateLimitGuard } from '../hooks/rate-limit.ts';
import { sendOk } from '../support/envelope.ts';
import { deviceIdOf } from '../support/params.ts';
import type { RouteDeps } from './deps.ts';

export function registerTelemetryRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createTelemetryController(deps.ctx);
  const limit = createRateLimitGuard(deps.ctx.limiter, QUOTA.telemetry);

  app.post('/telemetry', { preHandler: [limit.preHandler] }, async (req, reply) => {
    sendOk(reply, controller.accept(req.body, deviceIdOf(req.headers)));
  });
}
