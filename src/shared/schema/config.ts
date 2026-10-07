/**
 * 团队配置：同步报文体、1MB 闸门、发布请求。
 *
 * 容量闸门（≤8 组 / ≤200 入口 / ≤1MB）挂在 GroupList 与 Wire 两层，
 * 服务端与客户端共用同一份判定，不依赖任何 UI 提示或前端自觉。
 */

import { z } from 'zod';
import {
  CAPACITY,
  IsoDateTimeSchema,
  RevisionSchema,
  SCHEMA_VERSION,
  Sha256HexSchema,
  utf8Bytes,
} from './common.ts';
import { GroupListSchema } from './group.ts';

/** 发布方提交的内容部分：revision / contentHash / publishedAt 由服务端生成。 */
/** 公告（2026-10-05 主页模块）：管理员在编辑态撰写，随团队配置同步给全员。 */
export const AnnouncementSchema = z.object({
  id: z.string().min(1).max(CAPACITY.MAX_ID_LEN),
  title: z.string().min(1).max(CAPACITY.MAX_NAME_LEN),
  /** Markdown 子集（标题/加粗/斜体/列表/链接/图片），渲染端转义后重建，不透传原始 HTML。 */
  body: z.string().max(2_000),
  backgroundImageUrl: z
    .string()
    .max(CAPACITY.MAX_URL_LEN)
    .refine((v) => v.length === 0 || /^https:\/\//i.test(v), '背景图仅支持 https 地址')
    .nullable()
    .optional(),
  createdAt: IsoDateTimeSchema,
});

export const TeamConfigBodySchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  instanceId: z.uuid(),
  groups: GroupListSchema,
  // default([])：旧版本落盘的配置没有这个字段，必须能继续通过校验（向后兼容）。
  announcements: z.array(AnnouncementSchema).max(CAPACITY.MAX_ANNOUNCEMENTS).default([]),
});

export const TeamConfigSchema = TeamConfigBodySchema.extend({
  revision: RevisionSchema,
  contentHash: Sha256HexSchema,
  publishedAt: IsoDateTimeSchema,
});

/** 1 MB 硬闸门：先按字符数廉价快筛，再按 UTF-8 字节精确判定。 */
export const TeamConfigWireSchema = z
  .string()
  .check((ctx) => {
    const s = ctx.value;
    if (s.length <= CAPACITY.MAX_CONFIG_BYTES && utf8Bytes(s) <= CAPACITY.MAX_CONFIG_BYTES) return;
    ctx.issues.push({
      code: 'custom',
      message: `配置超过 ${CAPACITY.MAX_CONFIG_BYTES} 字节上限`,
      path: [],
      input: s.length,
    });
  })
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: 'custom', message: '配置不是合法 JSON' });
      return z.NEVER;
    }
  })
  .pipe(TeamConfigSchema);

export const PublishRequestSchema = z.object({
  baseRevision: RevisionSchema,
  summary: z.string().min(1).max(CAPACITY.MAX_SUMMARY_LEN),
  config: TeamConfigBodySchema,
});

export type TeamConfigBody = z.infer<typeof TeamConfigBodySchema>;
export type TeamConfig = z.infer<typeof TeamConfigSchema>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
