/**
 * src/server/controllers/feedback.controller.ts —— 反馈上报与聚合
 *
 * 只收 reasonCode，不收任何自由文本：schema 里就没有文本字段，
 * 多一个字段就会有人往里写"这个软件装了但打不开因为……"，
 * 而那里面必然出现机器名、用户名、内部系统名。
 *
 * 聚合视图按入口给设备数与最近时间，**不展开单条**：反馈洪峰时
 * 展开明细没有意义，且会反向刺激"写点什么"的冲动。
 */

import { FeedbackBatchSchema } from '../../shared/schema/feedback.ts';
import type { FeedbackItem } from '../../shared/schema/feedback.ts';
import type { ServiceContext } from '../container.ts';
import type { FeedbackAcceptResult, FeedbackAggregate } from '../../services/feedback.service.ts';
import { parseOrThrow } from '../support/validate.ts';

export function createFeedbackController(ctx: ServiceContext) {
  return {
    async submit(body: unknown, deviceId: string): Promise<FeedbackAcceptResult> {
      const parsed = parseOrThrow(FeedbackBatchSchema, body);
      const items: FeedbackItem[] = parsed.items;
      return ctx.feedbackService.submit(deviceId, items);
    },

    async summary(since: string | null, limit: number): Promise<{ items: FeedbackAggregate[] }> {
      return ctx.feedbackService.summary(since, limit);
    },
  };
}
