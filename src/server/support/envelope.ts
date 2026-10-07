/**
 * src/server/support/envelope.ts —— 成功响应的统一信封
 *
 * 成功一律 `{code: 0, data, message: ''}`；失败侧由 hooks/error.ts 负责。
 * 这里刻意只暴露一个 `sendOk`：路由层不允许自己拼响应体，
 * 否则"某个端点多返回一个字段"这种漂移迟早发生，而客户端是按信封解析的。
 */

import type { FastifyReply } from 'fastify';

export interface SuccessEnvelope {
  code: 0;
  data: unknown;
  message: string;
}

/** 成功响应。headers 只放契约里写明的那些（ETag / X-TL-* / X-RateLimit-*）。 */
export function sendOk(
  reply: FastifyReply,
  data: unknown,
  headers?: Record<string, string | number>,
): void {
  if (headers !== undefined) void reply.headers(headers);
  const body: SuccessEnvelope = { code: 0, data: data ?? null, message: '' };
  void reply.send(body);
}

/**
 * 304：无正文。**服务端在 304 这条路上也不做任何额外工作**
 * （不读文件、不重算哈希、不记设备）——客户端侧对应"立即 return，不重绘"。
 * 仍按 RFC 回带 ETag，便于客户端核对校验器没变。
 */
export function sendNotModified(reply: FastifyReply, etag?: string): void {
  if (etag !== undefined) void reply.header('ETag', etag);
  void reply.status(304).send();
}
