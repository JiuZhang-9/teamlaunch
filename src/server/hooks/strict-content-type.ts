/**
 * src/server/hooks/strict-content-type.ts —— Content-Type 白名单
 *
 * 只接受裸 `application/json`（不带任何参数）。不接受 `; charset=utf-8` 变体。
 *
 * 这条不是洁癖：HMAC 验的是原始字节。允许 charset 变体意味着"看起来一样的请求"
 * 可能以不同编码被发出并由不同解析器处理，签名校验会以难以复现的方式失败。
 * 与其让客户端带着侥幸去猜，不如在协议层钉死一种写法。
 *
 * 只在**有请求体**时校验；GET / HEAD 不受影响。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { STRICT_JSON_CONTENT_TYPE } from '../../shared/constants.ts';
import { AppError } from '../../shared/errors.ts';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerStrictContentType(app: FastifyInstance): void {
  app.addHook('preValidation', async (req: FastifyRequest) => {
    if (!METHODS_WITH_BODY.has(req.method)) return;

    const declared = req.headers['content-type'];
    // 无 content-type 但有体：按不合法处理，避免走进默认解析器产生歧义字节。
    if (typeof declared !== 'string') {
      throw new AppError('ERR_BAD_REQUEST', `请求必须声明 Content-Type: ${STRICT_JSON_CONTENT_TYPE}`);
    }
    const normalized = declared.trim().toLowerCase();
    if (normalized !== STRICT_JSON_CONTENT_TYPE) {
      throw new AppError(
        'ERR_BAD_REQUEST',
        `不支持的 Content-Type，只接受 ${STRICT_JSON_CONTENT_TYPE}`,
      );
    }
  });
}
