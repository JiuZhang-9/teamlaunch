/**
 * 入口（Entry）三类判别联合。type 是判别键，缺对应字段即拒绝，不做宽容合并。
 */

import { z } from 'zod';
import { CAPACITY, IsoDateTimeSchema, Sha256HexSchema } from './common.ts';

export const IconRefSchema = z.object({
  kind: z.enum(['local', 'asset', 'fallback', 'emoji']),
  /** kind=emoji 时的表情字符（如 🚀）。服务端/客户端都只当文本渲染，长度钉死防滥用。 */
  char: z.string().min(1).max(8).optional(),
});

export const EntryTypeSchema = z.enum(['app', 'folder', 'web']);

const EntryBaseSchema = z.object({
  id: z.string().min(1).max(CAPACITY.MAX_ID_LEN),
  name: z.string().min(1).max(CAPACITY.MAX_NAME_LEN),
  description: z.string().max(CAPACITY.MAX_DESC_LEN).nullable().optional(),
  keywords: z
    .array(z.string().min(1).max(CAPACITY.MAX_KEYWORD_LEN))
    .max(CAPACITY.MAX_KEYWORDS)
    .optional(),
  sort: z.int(),
  icon: IconRefSchema,
  iconAssetHash: Sha256HexSchema.nullable().optional(),
  updatedAt: IsoDateTimeSchema,
});

/** 软件：必须有 target。sourcePath 保留原始 lnk，用于重新解析与 UWP 打开。 */
export const AppEntrySchema = EntryBaseSchema.extend({
  type: z.literal('app'),
  target: z.string().min(1),
  sourcePath: z.string().nullable().optional(),
  args: z.string().nullable().optional(),
  cwd: z.string().nullable().optional(),
  expandEnv: z.boolean().default(false),
});

/** 文件夹：本地目录或 UNC 共享路径。禁止渲染期 stat 预检查（K-06）。 */
export const FolderEntrySchema = EntryBaseSchema.extend({
  type: z.literal('folder'),
  target: z.string().min(1),
});

/** 网页：仅 http / https，一律走外部浏览器（K-07）。 */
export const WebEntrySchema = EntryBaseSchema.extend({
  type: z.literal('web'),
  url: z.url({ protocol: /^https?$/ }).max(CAPACITY.MAX_URL_LEN),
});

export const EntrySchema = z.discriminatedUnion('type', [
  AppEntrySchema,
  FolderEntrySchema,
  WebEntrySchema,
]);

export type IconRef = z.infer<typeof IconRefSchema>;
export type EntryType = z.infer<typeof EntryTypeSchema>;
export type AppEntry = z.infer<typeof AppEntrySchema>;
export type FolderEntry = z.infer<typeof FolderEntrySchema>;
export type WebEntry = z.infer<typeof WebEntrySchema>;
export type Entry = z.infer<typeof EntrySchema>;
