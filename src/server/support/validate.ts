/**
 * src/server/support/validate.ts —— zod 校验失败到 422 的唯一转换点
 *
 * 为什么不用 Fastify 自带的 JSON Schema 校验：契约的唯一事实源是
 * `src/shared/schema/*.ts`（zod），同一份 schema 还要给渲染层复用。
 * 再维护一套 JSON Schema 等于把每个字段写两遍，漂移只是时间问题。
 *
 * 422 的 `details` 只回字段路径与人类可读原因，**不回原始输入值**：
 * 请求体里可能有入口名等团队内部信息，原样回显没有必要。
 */

import { ZodError, type z } from 'zod';
import { validationFailed } from '../../shared/errors.ts';

const MAX_DETAIL_ISSUES = 20;

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data as z.infer<S>;
  throw validationFailed(issueDetails(parsed.error));
}

/** 结构化字段路径。`a.b[0]` 这种形状足够定位，且不含任何值。 */
export function issueDetails(error: ZodError): Record<string, unknown> {
  const issues = error.issues.slice(0, MAX_DETAIL_ISSUES).map((issue) => {
    const path = issue.path
      .map((segment) => (typeof segment === 'number' ? `[${segment}]` : String(segment)))
      .join('.');
    return { path: path.length === 0 ? '(root)' : path, message: issue.message };
  });
  return { issues, truncated: error.issues.length > MAX_DETAIL_ISSUES };
}

export function isZodError(err: unknown): err is ZodError {
  return err instanceof ZodError;
}
