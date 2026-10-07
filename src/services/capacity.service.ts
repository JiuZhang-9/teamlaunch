/**
 * src/services/capacity.service.ts —— 容量硬上限（服务端强制，T6.7）
 *
 * 为什么不交给 zod 一次做完：413 与 422 是两种不同的处置。
 *   413 ERR_PAYLOAD_TOO_LARGE：超 1 MB、超 8 组、超 200 入口 → 是"量太大"，要缩减
 *   422 ERR_VALIDATION_FAILED：字段不合法 → 是"内容错"，要改具体某项
 * zod 的自定义 issue 无法可靠区分这两类，因此在 schema 之外单立一道闸，
 * 顺序上先判容量再走 schema，避免把"量太大"误报成"某字段不合法"。
 *
 * 占用统计（`measure` / `withinCapacity`）在 `src/shared/capacity-usage.ts`：
 * 渲染层的"还可添加几个"和这里的 413 闸必须数的是同一件事，
 * 而 `src/shared/**` 不能反向依赖 services。
 */

import { CAPACITY } from '../shared/schema/common.ts';
import { payloadTooLarge } from '../shared/errors.ts';

export interface CapacityInput {
  /** 请求体 UTF-8 字节数。 */
  bodyBytes: number;
  groupCount: number;
  entryCount: number;
}

export function checkCapacity(input: CapacityInput): void {
  if (input.bodyBytes > CAPACITY.MAX_CONFIG_BYTES) {
    throw payloadTooLarge({ reason: 'bodyBytes', limit: CAPACITY.MAX_CONFIG_BYTES, actual: input.bodyBytes });
  }
  if (input.groupCount > CAPACITY.MAX_GROUPS) {
    throw payloadTooLarge({ reason: 'groups', limit: CAPACITY.MAX_GROUPS, actual: input.groupCount });
  }
  if (input.entryCount > CAPACITY.MAX_ENTRIES) {
    throw payloadTooLarge({ reason: 'entries', limit: CAPACITY.MAX_ENTRIES, actual: input.entryCount });
  }
}

