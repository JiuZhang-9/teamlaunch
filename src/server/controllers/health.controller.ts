/**
 * src/server/controllers/health.controller.ts —— GET /health
 *
 * 服务发现拿到候选端点后用它做最终确认，因此它必须回答两件事：
 * 我是不是你要找的团队数据源（instanceId），以及我实际监听在哪个端口（httpPort）。
 * 端口必须报真实值：写了首选端口而实际漂移的话，发现成功但连不上，
 * 现场表现为"时好时坏"，极难归因。
 */

import type { ServiceContext } from '../container.ts';

export interface HealthInfo {
  status: 'ok';
  role: 'admin' | 'member';
  serviceId: string;
  instanceId: string;
  revision: number;
  httpPort: number;
  serverTime: string;
}

export function createHealthController(ctx: ServiceContext) {
  return {
    get(): HealthInfo {
      return {
        status: 'ok',
        role: ctx.role,
        serviceId: ctx.serviceId,
        instanceId: ctx.instanceId,
        revision: ctx.teamConfig.revision,
        httpPort: ctx.listen.port,
        serverTime: new Date().toISOString(),
      };
    },
  };
}
