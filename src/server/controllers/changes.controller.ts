/**
 * src/server/controllers/changes.controller.ts —— GET /changes
 *
 * 变更记录增量（员工侧发布历史）。`since` 是**开区间**：只回严格大于它的记录。
 * 开区间而不是闭区间，是因为客户端存的"已看到的最新版本"就是要跳过的那一条；
 * 用闭区间会让最后一条每次都被重放，表现为历史里永远多一条。
 *
 * 排序固定从旧到新：员工关心"之后发生了什么"。
 */

import type { ServiceContext } from '../container.ts';
import type { ChangeList } from '../../services/revision.service.ts';

export function createChangesController(ctx: ServiceContext) {
  return {
    async list(since: number, limit: number): Promise<ChangeList> {
      return ctx.revisions.listChanges(since, limit, ctx.teamConfig.revision);
    },
  };
}
