/**
 * src/shared/errors.ts —— 错误码字典与统一信封的错误侧
 *
 * 铁律：底层不得把裸错误抛到 API 层。所有业务失败都必须是 AppError，
 * 由 server/hooks/error.ts 统一转成 `{code, data, message, error, diagnosticId}`。
 *
 * 错误文案不得泄露口令规则、端口、堆栈或内部路径（PRD §14.1）。
 * 因此本文件里的 message 都是面向管理员的成品文案，不拼内部细节。
 */

import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { ErrorCodeSchema } from './schema/envelope.ts';

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** 机器码 → HTTP 状态。唯一映射点，散落在各路由里会立刻漂移。 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  ERR_BAD_REQUEST: 400,
  ERR_AUTH_REQUIRED: 401,
  ERR_BAD_PROOF: 401,
  ERR_CHALLENGE_EXPIRED: 401,
  ERR_TOKEN_INVALID: 401,
  ERR_SIGNATURE_INVALID: 401,
  ERR_ROLE_MISMATCH: 403,
  ERR_REVISION_CONFLICT: 409,
  ERR_INSTANCE_MISMATCH: 409,
  ERR_PAYLOAD_TOO_LARGE: 413,
  ERR_VALIDATION_FAILED: 422,
  ERR_RATE_LIMITED: 429,
  ERR_NOT_FOUND: 404,
  ERR_INTERNAL: 500,
};

export interface AppErrorInit {
  /** 409 等需要附带结构化数据的场景（如 ConflictDetail）。 */
  data?: unknown;
  /** 422 时附字段路径。 */
  details?: Record<string, unknown>;
  /** 需要回写的响应头（限流场景）。 */
  headers?: Record<string, string | number>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly data: unknown;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string | number> | undefined;

  constructor(code: ErrorCode, message: string, init: AppErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'AppError';
    this.code = code;
    this.data = init.data ?? null;
    this.details = init.details;
    this.headers = init.headers;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

/** 面向用户的固定文案。刻意不拼接任何内部细节。 */
export const ERROR_MESSAGE: Record<ErrorCode, string> = {
  ERR_BAD_REQUEST: '请求结构不正确',
  ERR_AUTH_REQUIRED: '需要管理员凭据',
  ERR_BAD_PROOF: '口令校验未通过',
  ERR_CHALLENGE_EXPIRED: '登录挑战已过期，请重试',
  ERR_TOKEN_INVALID: '登录状态已失效，请重新解锁',
  ERR_SIGNATURE_INVALID: '请求签名校验未通过',
  ERR_ROLE_MISMATCH: '该设备不是管理员数据源',
  ERR_REVISION_CONFLICT: '版本已变更，请查看最新内容后重新发布',
  ERR_INSTANCE_MISMATCH: '连接到了另一个团队数据源',
  ERR_PAYLOAD_TOO_LARGE: '内容超出上限',
  ERR_VALIDATION_FAILED: '内容校验未通过',
  ERR_RATE_LIMITED: '操作过于频繁，请稍后再试',
  ERR_NOT_FOUND: '未找到请求的内容',
  ERR_INTERNAL: '服务内部错误',
};

export function appError(code: ErrorCode, init: AppErrorInit = {}): AppError {
  return new AppError(code, ERROR_MESSAGE[code], init);
}

/** 容量超限：413。文案给的是可执行动作，不是内部字节数。 */
export function payloadTooLarge(details?: Record<string, unknown>): AppError {
  return new AppError('ERR_PAYLOAD_TOO_LARGE', '内容超出上限，请减少分组或入口数量', { details });
}

export function validationFailed(details?: Record<string, unknown>): AppError {
  return new AppError('ERR_VALIDATION_FAILED', ERROR_MESSAGE.ERR_VALIDATION_FAILED, { details });
}

/** 诊断 ID：给用户复制、给日志定位。不承载任何内部路径。 */
export function newDiagnosticId(): string {
  return randomUUID();
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
