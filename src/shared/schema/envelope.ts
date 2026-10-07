/**
 * 统一响应信封与错误码。所有 HTTP 响应体都是 `{code, data, message, ...}`。
 * 错误文案不得泄露口令规则、端口、堆栈或内部路径。
 */

import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'ERR_BAD_REQUEST',
  'ERR_AUTH_REQUIRED',
  'ERR_BAD_PROOF',
  'ERR_CHALLENGE_EXPIRED',
  'ERR_TOKEN_INVALID',
  'ERR_SIGNATURE_INVALID',
  'ERR_ROLE_MISMATCH',
  'ERR_REVISION_CONFLICT',
  'ERR_INSTANCE_MISMATCH',
  'ERR_PAYLOAD_TOO_LARGE',
  'ERR_VALIDATION_FAILED',
  'ERR_RATE_LIMITED',
  'ERR_NOT_FOUND',
  'ERR_INTERNAL',
]);

const envelopeBase = {
  code: z.int(),
  message: z.string(),
  error: ErrorCodeSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  diagnosticId: z.string().optional(),
};

/** 信封工厂：envelopeOf(TeamConfigSchema) 即 GET /config 的 200 响应体校验器。 */
export function envelopeOf<T extends z.ZodType>(dataSchema: T) {
  return z.object({ ...envelopeBase, data: dataSchema.nullable() });
}

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
