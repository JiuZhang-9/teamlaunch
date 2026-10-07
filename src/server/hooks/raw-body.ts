/**
 * src/server/hooks/raw-body.ts —— 拿到请求的**原始字节**（最易错点 1 的正面解答）
 *
 * Fastify 默认把 application/json 解析成对象。但 HMAC 验的是原始字节串：
 * 拿解析后的对象重新序列化，键顺序、空格、Unicode 转义任何一个不同都会算出
 * 不同的签名 —— 而且失败得很随机，现场看起来像网络问题。
 *
 * 做法：注册一个 `parseAs: 'buffer'` 的解析器，把原始 Buffer 挂到 `req.rawBody`，
 * 再交给 Fastify 自带的默认 JSON 解析器去解析（保留其原型污染防护，不自己 JSON.parse）。
 *
 * 配套的 Content-Type 白名单：只接受裸 `application/json`。
 * 必须显式做白名单，因为 **Fastify 的解析器匹配会退化到 mediaType**
 * —— `application/json; charset=utf-8` 也会命中同一个解析器。不同编码声明
 * 带来的字节差异足以让签名校验随机失败（见 lib/content-type-parser.js 的 getParser）。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

export interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

/** 空体的签名按 sha256(空串) 计算，GET 类签名请求走这条路。 */
export const EMPTY_RAW_BODY = Buffer.alloc(0);

export function rawBodyOf(req: FastifyRequest): Buffer {
  return (req as RawBodyRequest).rawBody ?? EMPTY_RAW_BODY;
}

export function registerRawBodyCapture(app: FastifyInstance): void {
  // 已有同名解析器时 add 会抛 FST_ERR_CTP_ALREADY_PRESENT，先移除再注册。
  if (app.hasContentTypeParser('application/json')) {
    app.removeContentTypeParser(['application/json']);
  }

  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      (req as RawBodyRequest).rawBody = body;
      defaultJsonParser(req, body.toString('utf8'), done);
    },
  );
}

/** 请求路径：去掉 query，保留 /api/v1 前缀。签名覆盖的就是这个串。 */
export function signaturePathOf(req: FastifyRequest): string {
  const url = req.url ?? '';
  const qIndex = url.indexOf('?');
  return qIndex === -1 ? url : url.slice(0, qIndex);
}
