/**
 * 契约原语与容量常量。所有其他 schema 文件都从这里取，禁止各写一份。
 */

import { z } from 'zod';

export const CAPACITY = {
  MAX_GROUPS: 8,
  MAX_ENTRIES: 200,
  MAX_CONFIG_BYTES: 1024 * 1024,
  MAX_ID_LEN: 64,
  MAX_NAME_LEN: 40,
  MAX_DESC_LEN: 80,
  MAX_KEYWORDS: 10,
  MAX_KEYWORD_LEN: 20,
  MAX_URL_LEN: 2048,
  MAX_SUMMARY_LEN: 200,
  MAX_ANNOUNCEMENTS: 10,
  MAX_FEEDBACK_BATCH: 100,
  MAX_TELEMETRY_BATCH: 200,
} as const;

export const SCHEMA_VERSION = 1;

/** 时间一律 UTC 且带 Z 后缀。禁止带偏移量的本地时间：版本判定绝不能依赖本地时钟。 */
export const IsoDateTimeSchema = z.iso.datetime();

/** SHA-256 十六进制小写。资源寻址与内容校验共用。 */
export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** revision：单调递增，只增不减，回滚也产生更大的值。JSON 数字，安全整数范围内。 */
export const RevisionSchema = z.int().min(0);

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

export type Revision = z.infer<typeof RevisionSchema>;
