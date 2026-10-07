/**
 * src/services/feedback.service.ts —— 失效反馈的接收与聚合（Spec 端点 10 / 11）
 *
 * 三条服务端防线（ADR-006 §4）：
 *   - 每设备每小时 20 条（按条目计费，不是按请求数）
 *   - 同一 (deviceId, entryId, reasonCode) 24 小时内去重
 *   - 只收 reasonCode，**不接受任何自由文本**
 *
 * "200 仅代表服务端已确认接收"（openapi 原文）。accept 结果里如实区分
 * accepted / duplicated / rejected，客户端不得把入队说成已提交。
 */

import { FEEDBACK_DEDUPE_MS, RATE_LIMIT } from '../shared/constants.ts';
import type { FeedbackItem } from '../shared/schema/feedback.ts';
import type { FeedbackRepository, StoredFeedback } from '../repositories/feedback.repository.ts';

export interface FeedbackAcceptResult {
  accepted: number;
  duplicated: number;
  rejected: number;
}

export interface FeedbackAggregate {
  entryId: string;
  deviceCount: number;
  latestAt: string;
  reasonCounts: Record<string, number>;
}

interface DedupeEntry {
  expiresAt: number;
}

export class FeedbackService {
  /** key = deviceId|entryId|reasonCode */
  private readonly dedupe = new Map<string, DedupeEntry>();
  /** 每设备的小时窗口计数：{ windowStart, count } */
  private readonly hourly = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly repository: FeedbackRepository) {}

  async submit(deviceId: string, items: FeedbackItem[], now: number = Date.now()): Promise<FeedbackAcceptResult> {
    this.sweep(now);
    const budget = this.remainingBudget(deviceId, now);

    const acceptedRows: StoredFeedback[] = [];
    let duplicated = 0;
    let rejected = 0;

    for (const item of items) {
      if (this.isDuplicate(deviceId, item, now)) {
        duplicated += 1;
        continue;
      }
      if (acceptedRows.length >= budget) {
        rejected += 1;
        continue;
      }
      this.markSeen(deviceId, item, now);
      acceptedRows.push({
        entryId: item.entryId,
        entryRevision: item.entryRevision ?? null,
        reasonCode: item.reasonCode,
        occurredAt: item.occurredAt,
        deviceId,
        receivedAt: new Date(now).toISOString(),
      });
    }

    if (acceptedRows.length > 0) {
      await this.repository.append(acceptedRows);
      this.consume(deviceId, acceptedRows.length, now);
    }
    return { accepted: acceptedRows.length, duplicated, rejected };
  }

  async summary(since: string | null, limit: number): Promise<{ items: FeedbackAggregate[] }> {
    const all = await this.repository.readAll();
    const threshold = since === null ? null : Date.parse(since);
    const rows = all.filter((row) => {
      if (threshold === null || Number.isNaN(threshold)) return true;
      return Date.parse(row.occurredAt) >= threshold;
    });

    const byEntry = new Map<string, { devices: Set<string>; latestAt: number; reasonCounts: Record<string, number> }>();
    for (const row of rows) {
      const bucket = byEntry.get(row.entryId) ?? {
        devices: new Set<string>(),
        latestAt: 0,
        reasonCounts: {} as Record<string, number>,
      };
      bucket.devices.add(row.deviceId);
      bucket.reasonCounts[row.reasonCode] = (bucket.reasonCounts[row.reasonCode] ?? 0) + 1;
      const at = Date.parse(row.occurredAt);
      if (!Number.isNaN(at) && at > bucket.latestAt) bucket.latestAt = at;
      byEntry.set(row.entryId, bucket);
    }

    const items = [...byEntry.entries()]
      .map(([entryId, bucket]) => ({
        entryId,
        deviceCount: bucket.devices.size,
        latestAt: new Date(bucket.latestAt).toISOString(),
        reasonCounts: bucket.reasonCounts,
      }))
      .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt))
      .slice(0, limit);

    return { items };
  }

  private remainingBudget(deviceId: string, now: number): number {
    const state = this.hourly.get(deviceId);
    if (state === undefined || now - state.windowStart >= 60 * 60 * 1000) {
      return RATE_LIMIT.feedbackItemsPerHour;
    }
    return Math.max(0, RATE_LIMIT.feedbackItemsPerHour - state.count);
  }

  private consume(deviceId: string, count: number, now: number): void {
    const state = this.hourly.get(deviceId);
    if (state === undefined || now - state.windowStart >= 60 * 60 * 1000) {
      this.hourly.set(deviceId, { windowStart: now, count });
      return;
    }
    state.count += count;
  }

  private key(deviceId: string, item: FeedbackItem): string {
    return `${deviceId}|${item.entryId}|${item.reasonCode}`;
  }

  private isDuplicate(deviceId: string, item: FeedbackItem, now: number): boolean {
    const entry = this.dedupe.get(this.key(deviceId, item));
    return entry !== undefined && entry.expiresAt > now;
  }

  private markSeen(deviceId: string, item: FeedbackItem, now: number): void {
    this.dedupe.set(this.key(deviceId, item), { expiresAt: now + FEEDBACK_DEDUPE_MS });
  }

  sweep(now: number = Date.now()): void {
    for (const [key, entry] of this.dedupe) {
      if (entry.expiresAt <= now) this.dedupe.delete(key);
    }
    for (const [deviceId, state] of this.hourly) {
      if (now - state.windowStart >= 60 * 60 * 1000) this.hourly.delete(deviceId);
    }
  }
}
