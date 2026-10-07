/**
 * src/server/routes/auth.route.ts —— POST /auth/challenge（端点 5）与 /auth/verify（端点 6）
 *
 * 两个端点都不需要令牌（它们就是用来换令牌的），因此限流是这里唯一的防线：
 *   challenge 30 次/分钟；verify 失败 10 次/5 分钟 → 锁定 15 分钟。
 *
 * challenge 的设备 ID 来自**请求体**（此时还没有令牌，也没约定头部），
 * 限流的键因此要退回请求体取值——否则去掉一个头部就能绕过全部限流。
 */

import type { FastifyInstance } from 'fastify';
import { createAuthController } from '../controllers/auth.controller.ts';
import { QUOTA, createRateLimitGuard, deviceKeyOf } from '../hooks/rate-limit.ts';
import { sendOk } from '../support/envelope.ts';
import { parseOrThrow } from '../support/validate.ts';
import { ChallengeRequestSchema, VerifyRequestSchema } from '../support/requests.ts';
import type { RouteDeps } from './deps.ts';

function bodyDeviceId(req: { body?: unknown }): unknown {
  if (req.body === null || typeof req.body !== 'object') return undefined;
  return (req.body as { deviceId?: unknown }).deviceId;
}

export function registerAuthRoute(app: FastifyInstance, deps: RouteDeps): void {
  const controller = createAuthController(deps.ctx);
  const challengeLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.challenge, (req) =>
    deviceKeyOf(req, bodyDeviceId(req)),
  );
  const verifyLimit = createRateLimitGuard(deps.ctx.limiter, QUOTA.challenge, (req) =>
    deviceKeyOf(req, bodyDeviceId(req)),
  );

  app.post('/auth/challenge', { preHandler: [challengeLimit.preHandler] }, async (req, reply) => {
    const body = parseOrThrow(ChallengeRequestSchema, req.body);
    sendOk(reply, controller.challenge(body));
  });

  app.post('/auth/verify', { preHandler: [verifyLimit.preHandler] }, async (req, reply) => {
    const body = parseOrThrow(VerifyRequestSchema, req.body);
    sendOk(reply, controller.verify(body));
  });
}
