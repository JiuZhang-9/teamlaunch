/**
 * src/server/support/params.ts —— 查询参数与路径参数的取值
 *
 * Fastify 的 query 是 `Record<string, unknown>`，直接用会一路 any。
 * 这里统一做「取值 → 校验 → 越界即 400」：非法参数回 400 而不是悄悄取默认值，
 * 否则客户端拼错参数时会静默拿到一份看起来正常但语义不同的数据。
 */

import { appError } from '../../shared/errors.ts';

export function queryValue(source: unknown, key: string): unknown {
  if (source === null || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[key];
}

/** 整数参数。缺省用 def；存在但不合法 → 400。 */
export function readIntParam(
  source: unknown,
  key: string,
  def: number,
  min: number,
  max: number,
): number {
  const raw = queryValue(source, key);
  if (raw === undefined || raw === '') return def;
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw appError('ERR_BAD_REQUEST', { details: { param: key } });
  }
  return value;
}

/** `since`：revision 开区间下界，最小 0。 */
export function readSinceParam(source: unknown, key: string, def: number): number {
  return readIntParam(source, key, def, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * `since` 的日期时间版本（反馈聚合）。非法 ISO 串 → 400，
 * 不做宽容解析：宽容解析会把 `2026-09-31` 变成 10 月 1 日这类静默偏移。
 */
export function readIsoParam(source: unknown, key: string): string | null {
  const raw = queryValue(source, key);
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    throw appError('ERR_BAD_REQUEST', { details: { param: key } });
  }
  if (Number.isNaN(Date.parse(raw))) {
    throw appError('ERR_BAD_REQUEST', { details: { param: key } });
  }
  return raw;
}

/** 路径参数里的 revision：必须是 ≥1 的安全整数。 */
export function readRevisionParam(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw appError('ERR_BAD_REQUEST', { details: { param: 'revision' } });
  }
  return value;
}

/** 首部取值（同名多值时取第一个）。 */
export function headerValue(source: unknown, key: string): string | null {
  if (source === null || typeof source !== 'object') return null;
  const raw = (source as Record<string, unknown>)[key];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

/** 匿名设备标识：只用于限流与去重，超长截断而非报错。 */
export function deviceIdOf(source: unknown): string | null {
  const raw = headerValue(source, 'x-tl-device-id');
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 64);
}
