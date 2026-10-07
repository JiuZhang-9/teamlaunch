/**
 * src/main/feedbackOutbox.ts —— 员工端待发送反馈队列（ADR-005 outbox/feedback.jsonl）
 *
 * AC-13 的三条不准：
 *   1. 写进队列 ≠ 上报成功。入队一律回 `PENDING`，UI 不得显示"已提交"。
 *   2. 只有服务端返回 200 才允许转 `SENT` —— 由调用方在确认后调 `clear()`。
 *   3. 丢弃必须**可见**：队列上限 200 条 / 保留 30 天，超限回 `DROPPED` 并说明原因，
 *      不允许静默丢。
 *
 * 全程异步 IO（K-05），落盘用原子替换（ADR-005）。
 */

import { appendJsonLine, readJsonLines, rewriteJsonLines } from '../repositories/jsonl.ts';
import type { FeedbackItem } from '../shared/schema/feedback.ts';
import { createMutex } from '../utils/single-flight.ts';

export const OUTBOX_MAX_ITEMS = 200;
export const OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface QueuedFeedback {
  item: FeedbackItem;
  /** 入队时刻（UTC ISO）。保留期从这里起算。 */
  queuedAt: string;
}

export type EnqueueOutcome =
  | { status: 'PENDING'; queuedAt: string; queued: number }
  | { status: 'DROPPED'; reason: 'EXPIRED' | 'QUEUE_FULL' };

export interface FeedbackOutbox {
  /** 入队并做保留期/上限淘汰。返回本次是排队成功还是被丢弃。 */
  enqueue(item: FeedbackItem, now?: number): Promise<EnqueueOutcome>;
  /** 当前待发条目（旧 → 新）。 */
  pending(): Promise<QueuedFeedback[]>;
  /** 服务端确认接收后清空指定条目（只清给出的这些，不误删期间新入队的）。 */
  clearSent(items: FeedbackItem[], now?: number): Promise<void>;
  /** 队列长度（诊断/自检用）。 */
  size(): Promise<number>;
}

export function createFeedbackOutbox(file: string): FeedbackOutbox {
  // 读—改—写必须整段串行：入队与 flush 会并发，交错起来会漏删或重复发。
  const mutex = createMutex();

  const load = async (): Promise<QueuedFeedback[]> => {
    const rows = await readJsonLines<Partial<QueuedFeedback>>(file);
    return rows.filter(isQueued);
  };

  return {
    enqueue(item, now = Date.now()) {
      return mutex(async () => {
        const queuedAt = new Date().toISOString();
        await appendJsonLine(file, { item, queuedAt } satisfies QueuedFeedback);

        const all = await load();
        const fresh = all.filter((row) => now - Date.parse(row.queuedAt) <= OUTBOX_RETENTION_MS);
        // 超期先于超限淘汰：一条超期的旧反馈不该把新反馈挤出队列。
        const kept = fresh.slice(-OUTBOX_MAX_ITEMS);
        if (kept.length !== all.length) {
          await rewriteJsonLines(file, kept);
        }
        const survived = kept.some((row) => row.queuedAt === queuedAt && row.item.entryId === item.entryId);
        if (!survived) {
          const expired = all.length !== fresh.length;
          return { status: 'DROPPED', reason: expired ? 'EXPIRED' : 'QUEUE_FULL' } as const;
        }
        return { status: 'PENDING', queuedAt, queued: kept.length } as const;
      });
    },

    pending() {
      return load();
    },

    async clearSent(items, now = Date.now()) {
      await mutex(async () => {
        if (items.length === 0) return;
        const sentKeys = new Set(items.map(keyOf));
        const all = await load();
        const kept = all.filter((row) => !sentKeys.has(keyOf(row.item)));
        // 期间新入队的条目必须留下：只重写"剩下的"，绝不整份清空。
        await rewriteJsonLines(file, kept);
      });
      void now;
    },

    async size() {
      return (await load()).length;
    },
  };
}

/**
 * 去重键。服务端按 (deviceId, entryId, reasonCode) 24 小时去重，
 * 这里只需要在本机队列里认出"同一条"，按条目内容比对即可。
 */
function keyOf(item: FeedbackItem): string {
  return `${item.entryId}|${item.reasonCode}|${item.occurredAt}`;
}

function isQueued(row: Partial<QueuedFeedback> | null): row is QueuedFeedback {
  if (row === null || typeof row !== 'object') return false;
  const item = row.item;
  if (item === null || typeof item !== 'object') return false;
  return typeof item.entryId === 'string' && typeof item.reasonCode === 'string'
    && typeof item.occurredAt === 'string' && typeof row.queuedAt === 'string';
}
