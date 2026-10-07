/**
 * src/server/routes/deps.ts —— 路由层的公共依赖
 *
 * 守卫（签名 / 令牌）在入口装配一次后下发到各路由，而不是每条路由自己 new。
 * 否则 nonce 表会变成多份，"同一 nonce 用过一次"的去重就失效了——
 * 那是重放防护的核心，失效方式是静默的。
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServiceContext } from '../container.ts';

export type PreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface RouteDeps {
  ctx: ServiceContext;
  /** 写端点：Bearer + HMAC 签名。 */
  requireSignature: PreHandler;
  /** 管理员只读端点：只验 Bearer。 */
  requireToken: PreHandler;
}
