/**
 * src/server/hooks/rate-limit.ts —— 限流与失败锁定（ADR-006 §4）
 *
 * 分设备（X-TL-Device-Id）滑动窗口计数，内存态，重启清零是可接受的。
 *
 *   /auth/verify    5 分钟内 >10 次失败 → 该设备锁定 15 分钟
 *   /auth/challenge 30 次/分钟
 *   /feedback       20 条/设备/小时（按条目计费，由 service 层扣减）
 *   /telemetry      1 批/设备/分钟
 *   写端点与巡检     60 次/分钟
 *
 * 无 deviceId 的请求统一落到一个匿名桶（而不是放行）：
 * 否则任何人去掉一个头部就绕过了全部限流。
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { DEVICE_ID_HEADER, RATE_LIMIT, AUTH } from '../../shared/constants.ts';
import { AppError } from '../../shared/errors.ts';

interface Window {
  starts: number[];
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /**
   * 判定并占用一个配额。超限抛 429，并带 X-RateLimit-* 与 Retry-After。
   */
  consume(key: string, limit: number, windowMs: number, now: number = Date.now()): number {
    const window = this.windows.get(key) ?? { starts: [] };
    const cutoff = now - windowMs;
    window.starts = window.starts.filter((t) => t > cutoff);
    if (window.starts.length >= limit) {
      this.windows.set(key, window);
      const retryAfter = Math.max(1, Math.ceil((window.starts[0] + windowMs - now) / 1000));
      throw new AppError('ERR_RATE_LIMITED', '操作过于频繁，请稍后再试', {
        headers: {
          'Retry-After': retryAfter,
          'X-RateLimit-Limit': limit,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': Math.ceil((window.starts[0] + windowMs) / 1000),
        },
      });
    }
    window.starts.push(now);
    this.windows.set(key, window);
    return limit - window.starts.length;
  }

  /** 剩余配额（不占用）。仅用于回写响应头。 */
  remaining(key: string, limit: number, windowMs: number, now: number = Date.now()): number {
    const window = this.windows.get(key);
    if (window === undefined) return limit;
    const cutoff = now - windowMs;
    const active = window.starts.filter((t) => t > cutoff).length;
    return Math.max(0, limit - active);
  }

  /** 记录一次失败；返回该窗口内累计失败次数。 */
  recordFailure(key: string, windowMs: number, now: number = Date.now()): number {
    const bucket = `${key}:fail`;
    const window = this.windows.get(bucket) ?? { starts: [] };
    const cutoff = now - windowMs;
    window.starts = window.starts.filter((t) => t > cutoff);
    window.starts.push(now);
    this.windows.set(bucket, window);
    return window.starts.length;
  }

  countFailures(key: string, windowMs: number, now: number = Date.now()): number {
    const window = this.windows.get(`${key}:fail`);
    if (window === undefined) return 0;
    const cutoff = now - windowMs;
    return window.starts.filter((t) => t > cutoff).length;
  }

  clearFailures(key: string): void {
    this.windows.delete(`${key}:fail`);
  }

  sweep(windowMs: number = 60 * 60 * 1000, now: number = Date.now()): void {
    for (const [key, window] of this.windows) {
      const active = window.starts.filter((t) => t > now - windowMs);
      if (active.length === 0) this.windows.delete(key);
      else window.starts = active;
    }
  }
}

export const ANONYMOUS_BUCKET = 'anonymous';

export function deviceKeyOf(req: FastifyRequest, bodyDeviceId?: unknown): string {
  const header = req.headers[DEVICE_ID_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim().slice(0, 64);
  }
  // 挑战申请阶段设备 ID 在请求体里（头部还没建立约定），退回请求体取值。
  if (typeof bodyDeviceId === 'string' && bodyDeviceId.trim().length > 0) {
    return bodyDeviceId.trim().slice(0, 64);
  }
  return ANONYMOUS_BUCKET;
}

/**
 * 限流守卫：占用配额并回写 `X-RateLimit-*`。
 *
 * 桶的键带路由（`scope`），否则"发布"和"拉配置"会互相挤占配额，
 * 表现为某端点莫名其妙 429 —— 这类随机失败最难归因。
 */
export function createRateLimitGuard(
  limiter: RateLimiter,
  quota: { limit: number; windowMs: number },
  keyOf: (req: FastifyRequest) => string = (req) => deviceKeyOf(req),
): { preHandler: (req: FastifyRequest, reply: FastifyReply) => Promise<void> } {
  return {
    preHandler: async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const scope = req.routeOptions?.url ?? req.url;
      const now = Date.now();
      const remaining = limiter.consume(`${scope}:${keyOf(req)}`, quota.limit, quota.windowMs, now);
      writeRateHeaders(reply, quota.limit, remaining, now);
    },
  };
}

export function writeRateHeaders(reply: FastifyReply, limit: number, remaining: number, now: number): void {
  void reply.headers({
    'X-RateLimit-Limit': limit,
    'X-RateLimit-Remaining': remaining,
    // 窗口末尾按当前分钟对齐，客户端只需要一个可比较的秒级时间戳。
    'X-RateLimit-Reset': Math.ceil(now / 1000) + 60,
  });
}

/**
 * 登录失败锁定：5 分钟内超过 10 次 → 锁定 15 分钟。
 * 锁定期内**直接拒绝**，不再消耗挑战也不回更细的错误 —— 避免把锁定状态
 * 变成"口令对不对"的旁路信道。
 */
export class LoginLockout {
  private readonly lockedUntil = new Map<string, number>();

  constructor(
    private readonly limiter: RateLimiter,
    private readonly bucket: string,
  ) {}

  assertUnlocked(deviceKey: string, now: number = Date.now()): void {
    const until = this.lockedUntil.get(deviceKey);
    if (until === undefined) return;
    if (until <= now) {
      this.lockedUntil.delete(deviceKey);
      return;
    }
    const retryAfter = Math.max(1, Math.ceil((until - now) / 1000));
    throw new AppError('ERR_RATE_LIMITED', '操作过于频繁，请稍后再试', {
      headers: { 'Retry-After': retryAfter },
    });
  }

  recordFailure(deviceKey: string, now: number = Date.now()): void {
    const failures = this.limiter.recordFailure(`${this.bucket}:${deviceKey}`, AUTH.verifyFailureWindowMs, now);
    if (failures > AUTH.verifyMaxFailures) {
      this.lockedUntil.set(deviceKey, now + AUTH.lockoutMs);
    }
  }

  clear(deviceKey: string): void {
    this.lockedUntil.delete(deviceKey);
    this.limiter.clearFailures(`${this.bucket}:${deviceKey}`);
  }
}

/** 每分钟粒度的通用配额。 */
export function perMinute(limit: number): { limit: number; windowMs: number } {
  return { limit, windowMs: 60 * 1000 };
}

export const QUOTA = {
  challenge: perMinute(RATE_LIMIT.challengePerMinute),
  telemetry: perMinute(RATE_LIMIT.telemetryBatchesPerMinute),
  write: perMinute(RATE_LIMIT.writePerMinute),
  read: perMinute(RATE_LIMIT.readPerMinute),
  /** 反馈的**请求**配额。条目配额（20 条/小时）由 service 层按条扣减。 */
  feedback: perMinute(RATE_LIMIT.feedbackItemsPerHour),
} as const;
