/**
 * src/server/routes/index.ts —— 13 个端点的集中注册（薄）
 *
 * 这里只做两件事：把守卫装配好、把路由挂上。任何业务逻辑出现在这里即违规。
 * 守卫（签名 / 令牌）在入口装配一次后下发，nonce 去重表因此只有一份。
 */

import type { FastifyInstance } from 'fastify';
import { API_PREFIX } from '../../shared/constants.ts';
import { createSignatureVerifier, createTokenGuard } from '../hooks/auth.ts';
import type { ServiceContext } from '../container.ts';
import { registerAssetsRoute } from './assets.route.ts';
import { registerAuthRoute } from './auth.route.ts';
import { registerChangesRoute } from './changes.route.ts';
import { registerConfigRoute } from './config.route.ts';
import { registerDiagnosticsRoute } from './diagnostics.route.ts';
import { registerFeedbackRoute } from './feedback.route.ts';
import { registerHealthRoute } from './health.route.ts';
import { registerRevisionsRoute } from './revisions.route.ts';
import { registerTelemetryRoute } from './telemetry.route.ts';
import { registerUpdatesRoute } from './updates.route.ts';
import type { RouteDeps } from './deps.ts';

export interface RouteRegistration {
  /** nonce 去重表与限流窗口的清扫。由入口定时驱动，服务内不起定时器。 */
  sweep: () => void;
}

export interface RoutesOptions {
  /** 自动更新静态目录（管理员机 userData/updates）；缺省不注册该路由。 */
  updatesDir?: string;
}

export function registerRoutes(app: FastifyInstance, ctx: ServiceContext, options: RoutesOptions = {}): RouteRegistration {
  const signature = createSignatureVerifier(ctx.tokens);
  const token = createTokenGuard(ctx.tokens);
  const deps: RouteDeps = {
    ctx,
    requireSignature: signature.preHandler,
    requireToken: token.preHandler,
  };

  app.register(async (v1: FastifyInstance) => {
    registerHealthRoute(v1, deps);
    registerConfigRoute(v1, deps);
    registerChangesRoute(v1, deps);
    registerAssetsRoute(v1, deps);
    registerAuthRoute(v1, deps);
    registerRevisionsRoute(v1, deps);
    registerFeedbackRoute(v1, deps);
    registerTelemetryRoute(v1, deps);
    registerDiagnosticsRoute(v1, deps);
  }, { prefix: API_PREFIX });

  // 更新源在 API 前缀之外：公开静态文件，客户端拿到令牌前也要能检查更新。
  registerUpdatesRoute(app, options.updatesDir);

  return {
    sweep: () => {
      signature.sweep();
    },
  };
}
