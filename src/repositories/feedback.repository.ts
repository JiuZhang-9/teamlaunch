/**
 * src/repositories/feedback.repository.ts —— 服务端收到的失效反馈
 *
 * 只存结构化字段：entryId / entryRevision / reasonCode / occurredAt + 匿名设备 ID。
 * **不含任何自由文本**（openapi FeedbackItem 无文本字段，这是硬约束）。
 *
 * 去重与限流是内存态（服务层），这里只负责"存下来"与"读出来聚合"。
 * 超出上限时整体重写淘汰最旧的——反馈的价值随时间衰减，旧的可丢。
 */

import { RETENTION } from '../shared/constants.ts';
import { appendJsonLine, readJsonLines, rewriteJsonLines } from './jsonl.ts';
import type { StoragePaths } from './paths.ts';

export interface StoredFeedback {
  entryId: string;
  entryRevision: number | null;
  reasonCode: string;
  occurredAt: string;
  /** 客户端上报的匿名设备标识，仅用于去重与聚合计数。 */
  deviceId: string;
  receivedAt: string;
}

export class FeedbackRepository {
  constructor(private readonly paths: StoragePaths) {}

  async append(items: StoredFeedback[]): Promise<void> {
    for (const item of items) {
      await appendJsonLine(this.paths.feedbackFile, item);
    }
    await this.prune();
  }

  async readAll(): Promise<StoredFeedback[]> {
    return readJsonLines<StoredFeedback>(this.paths.feedbackFile);
  }

  private async prune(): Promise<void> {
    const all = await this.readAll();
    if (all.length <= RETENTION.feedbackItems) return;
    await rewriteJsonLines(this.paths.feedbackFile, all.slice(all.length - RETENTION.feedbackItems));
  }
}
