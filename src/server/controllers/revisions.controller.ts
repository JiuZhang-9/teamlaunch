/**
 * src/server/controllers/revisions.controller.ts —— 发布历史与还原
 *
 * 版本序列只增不减，因此"还原"不是回退：它拿历史快照的内容**生成一个更高的新版本**。
 * 这条不变式让客户端完全不需要"版本变小了怎么办"的分支。
 *
 * 还原走乐观并发的理由与发布相同，但更容易被漏掉：管理员 A 打开还原对话框
 * （此时读到 revision=131），B 期间发布了 132，A 点确认如果不带 baseRevision
 * 就会把 B 的内容静默覆盖。所以 `RestoreRequest` 只有 baseRevision 一个字段，
 * 但它一个都不能少。
 */

import type { ServiceContext } from '../container.ts';
import type { PublishResult } from '../../services/publish.service.ts';
import type { ChangeRecord } from '../../repositories/revision.repository.ts';
import type { RestoreRequest } from '../support/requests.ts';

export function createRevisionsController(ctx: ServiceContext) {
  return {
    async list(limit: number): Promise<{ items: ChangeRecord[] }> {
      return ctx.revisions.listRevisions(limit);
    },

    async restore(
      revision: number,
      body: RestoreRequest,
      deviceId: string | null,
    ): Promise<PublishResult> {
      return ctx.publish.restore(revision, body.baseRevision, deviceId);
    },
  };
}
