/**
 * src/server/app.ts —— Fastify 装配入口（只装配，不含业务逻辑）
 *
 * 本文件可被 `node --experimental-transform-types src/server/app.ts` 直接拉起，
 * 这是"将来迁到独立机器"的技术保证，因此本目录**不得引入任何 Electron 依赖**
 * （守卫由 scripts/guard-server.mjs 与架构 §3.2 的 grep 命令共同保证）。
 * 注释里刻意不写出那个模块名的引号形式，避免被守卫命令的正则误判为真实依赖。
 *
 * 装配顺序即请求生命周期顺序，不要调换：
 *   raw-body（拿原始字节）→ strict-content-type（钉死一种编码）
 *   → access-log → error-handler → routes
 * 把 raw-body 放在最前，是因为后面所有签名校验都依赖 req.rawBody。
 */

import Fastify from 'fastify';
import { LISTEN_ADDRESS, MAX_BODY_BYTES, PREFERRED_TCP_PORT } from '../shared/constants.ts';
import type { StoragePaths } from '../repositories/paths.ts';
import { createContext, sweepContext, type ListenInfo, type ServiceContext } from './container.ts';
import { registerErrorHandler, type ErrorLogger } from './hooks/error.ts';
import { registerAccessLog, type AccessLogger } from './hooks/logging.ts';
import { registerRawBodyCapture } from './hooks/raw-body.ts';
import { registerStrictContentType } from './hooks/strict-content-type.ts';
import { listenWithDrift } from './listen.ts';
import { registerRoutes } from './routes/index.ts';

export interface ServerOptions {
  paths: StoragePaths;
  address?: string;
  /** 漂移起点（不是"必须用这个端口"）：从它开始向上找可用端口，默认 17890。 */
  port?: number;
  accessLog?: AccessLogger;
  errorLog?: ErrorLogger;
  /** 自动更新静态目录（管理员机）；缺省不提供更新源。 */
  updatesDir?: string;
}

export interface SyncServer {
  app: ReturnType<typeof Fastify>;
  ctx: ServiceContext;
  listen: ListenInfo;
  start(): Promise<void>;
  stop(): Promise<void>;
  sweep(): void;
}

export async function createServer(options: ServerOptions): Promise<SyncServer> {
  const listen: ListenInfo = {
    address: options.address ?? LISTEN_ADDRESS,
    port: options.port ?? PREFERRED_TCP_PORT,
  };

  const ctx = await createContext(options.paths, listen);
  // logger: false 已经关掉了全部日志（含请求日志）；
  // 再传 disableRequestLogging 会触发 Fastify 5 的 FSTDEP023 弃用告警。
  const app = Fastify({
    bodyLimit: MAX_BODY_BYTES,
    logger: false,
  });

  registerRawBodyCapture(app);
  registerStrictContentType(app);
  registerAccessLog(app, options.accessLog);
  registerErrorHandler(app, options.errorLog);
  const routes = registerRoutes(app, ctx, { updatesDir: options.updatesDir });

  return {
    app,
    ctx,
    listen,
    start: () => listenWithDrift(app, listen, ctx.instanceId),
    stop: () => app.close(),
    sweep: () => {
      sweepContext(ctx);
      routes.sweep();
    },
  };
}
