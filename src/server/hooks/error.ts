/**
 * src/server/hooks/error.ts —— 统一信封的错误侧
 *
 * 三类输入，三条不同的处置：
 *   1. AppError（业务失败）→ 用它自带的 ERR_* 机器码与 HTTP 状态，
 *      409/429 等还会带上结构化 data 与响应头。
 *   2. zod 校验失败 → 422 + details 字段路径。
 *   3. 其他（含 Fastify 自身的 413/415/400）→ 归一成信封；
 *      真正未预期的才是 500，且必须带 diagnosticId 供复制诊断。
 *
 * 铁律：任何分支都不得把堆栈、内部路径、端口、口令规则写进 message。
 * 500 的原文一律是"服务内部错误"，细节只进日志（且日志也不带 IP）。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { appError, isAppError, newDiagnosticId } from '../../shared/errors.ts';
import { isZodError, issueDetails } from '../support/validate.ts';
import { signaturePathOf } from './raw-body.ts';

export interface ErrorEnvelope {
  code: number;
  data: unknown;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
  diagnosticId?: string;
}

/** Fastify 自身错误码 → 我们的机器码。写死一张表，避免把 FST_* 漏到 API 上。 */
const FASTIFY_STATUS_FALLBACK: Record<number, string> = {
  400: 'ERR_BAD_REQUEST',
  404: 'ERR_NOT_FOUND',
  411: 'ERR_BAD_REQUEST',
  413: 'ERR_PAYLOAD_TOO_LARGE',
  415: 'ERR_BAD_REQUEST',
  422: 'ERR_VALIDATION_FAILED',
  429: 'ERR_RATE_LIMITED',
  500: 'ERR_INTERNAL',
};

export type ErrorLogger = (entry: Record<string, unknown>) => void;

export function registerErrorHandler(app: FastifyInstance, log: ErrorLogger = () => undefined): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const path = signaturePathOf(req);

    if (isAppError(err)) {
      if (err.headers !== undefined) void reply.headers(err.headers);
      const body: ErrorEnvelope = {
        code: err.status,
        data: err.data ?? null,
        message: err.message,
        error: err.code,
      };
      if (err.details !== undefined) body.details = err.details;
      body.diagnosticId = newDiagnosticId();
      void reply.status(err.status).send(body);
      return;
    }

    if (isZodError(err)) {
      const e = appError('ERR_VALIDATION_FAILED', { details: issueDetails(err) });
      void reply.status(422).send({
        code: 422,
        data: null,
        message: e.message,
        error: 'ERR_VALIDATION_FAILED',
        details: e.details,
        diagnosticId: newDiagnosticId(),
      } satisfies ErrorEnvelope);
      return;
    }

    const status = readStatus(err);
    if (status !== null && status < 500) {
      const error = FASTIFY_STATUS_FALLBACK[status] ?? 'ERR_BAD_REQUEST';
      void reply.status(status).send({
        code: status,
        data: null,
        message: messageOf(error),
        error,
        diagnosticId: newDiagnosticId(),
      } satisfies ErrorEnvelope);
      return;
    }

    const diagnosticId = newDiagnosticId();
    log({
      level: 'error',
      diagnosticId,
      method: req.method,
      path,
      name: err instanceof Error ? err.name : 'UnknownError',
      // 只留错误类型与消息；不含请求体（其中可能有团队入口名）。
      message: err instanceof Error ? err.message : String(err),
    });
    void reply.status(500).send({
      code: 500,
      data: null,
      message: '服务内部错误',
      error: 'ERR_INTERNAL',
      diagnosticId,
    } satisfies ErrorEnvelope);
  });

  app.setNotFoundHandler((_req: FastifyRequest, reply: FastifyReply) => {
    const e = appError('ERR_NOT_FOUND');
    void reply.status(404).send({
      code: 404,
      data: null,
      message: e.message,
      error: e.code,
      diagnosticId: newDiagnosticId(),
    } satisfies ErrorEnvelope);
  });
}

function readStatus(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  const status = (err as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function messageOf(error: string): string {
  switch (error) {
    case 'ERR_PAYLOAD_TOO_LARGE':
      return '内容超出上限，请减少分组或入口数量';
    case 'ERR_RATE_LIMITED':
      return '操作过于频繁，请稍后再试';
    case 'ERR_NOT_FOUND':
      return '未找到请求的内容';
    default:
      return '请求结构不正确';
  }
}
