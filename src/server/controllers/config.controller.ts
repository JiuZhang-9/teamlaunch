/**
 * src/server/controllers/config.controller.ts —— GET /config 与 PUT /config
 *
 * GET 的两条铁律：
 *   1. `If-None-Match` 命中就返回 304，**不做任何其他事**——
 *      不读文件、不重算哈希、不记设备。客户端拿到 304 立即 return。
 *      这是 30 秒轮询不打爆管理员机的前提。
 *   2. ETag 是强校验器 `<revision>-<contentHash 前16位>`，由 revision 与
 *      内容哈希共同构成：只比 revision 会在"还原到旧内容"时漏判，
 *      只比哈希则无法区分同内容的不同版本。
 *
 * PUT 的三条铁律：
 *   1. **忽略客户端提交的 revision**：新版本永远是 `current + 1`（乐观并发）。
 *   2. 容量闸门在 schema 之前：413（量太大）与 422（内容错）必须分开，
 *      否则"入口太多"会被报成"某个字段不合法"，管理员会去改字段而不是减量。
 *   3. 先落盘再换内存快照，中途失败不会留下"看起来发布成功"的状态。
 */

import { PublishRequestSchema } from '../../shared/schema/config.ts';
import type { TeamConfig } from '../../shared/schema/config.ts';
import { AppError } from '../../shared/errors.ts';
import { checkCapacity } from '../../services/capacity.service.ts';
import type { PublishResult } from '../../services/publish.service.ts';
import type { ServiceContext } from '../container.ts';
import { buildETag, parseETag } from '../../services/team-config.service.ts';
import { parseOrThrow } from '../support/validate.ts';

export type GetConfigResult =
  | { kind: 'notModified'; etag: string }
  | { kind: 'ok'; config: TeamConfig; etag: string; revision: number; publishedAt: string };

export function createConfigController(ctx: ServiceContext) {
  return {
    get(ifNoneMatch: string | null, deviceId: string | null): GetConfigResult {
      const config = ctx.teamConfig.current;

      const claimed = parseETag(ifNoneMatch ?? undefined);
      if (config !== null && claimed !== null) {
        const matches = claimed.revision === config.revision
          && config.contentHash.startsWith(claimed.hashPrefix);
        if (matches) return { kind: 'notModified', etag: buildETag(config) };
      }

      if (config === null) {
        throw new AppError('ERR_NOT_FOUND', '尚未发布任何团队配置');
      }

      // 设备计数服务于遥测覆盖率的分母，只记匿名 ID 集合（不记时间、不记次数）。
      // 304 那条路已经提前返回，不做这件事——它的成本虽小，但"304 = 什么都不做"
      // 这条不变式一旦破掉，将来就会有人在 304 分支里加逻辑。
      ctx.telemetry.noteConfigDevice(deviceId);

      return {
        kind: 'ok',
        config,
        etag: buildETag(config),
        revision: config.revision,
        publishedAt: config.publishedAt,
      };
    },

    async publish(args: {
      body: unknown;
      bodyBytes: number;
      deviceId: string | null;
    }): Promise<PublishResult> {
      // 容量闸在 schema 之前（本文件 PUT 铁律 2）。GroupListSchema 里也带容量自定义检查，
      // 先 parse 会把"量太大"报成 422 字段错误——这里必须用原始 body 先判量。
      // 注意请求体是 PublishRequest 信封：{ baseRevision, summary, config }，groups 在 config 里。
      const rawConfig = (args.body ?? null) as { config?: { groups?: unknown } } | null;
      const rawGroups = Array.isArray(rawConfig?.config?.groups) ? (rawConfig?.config?.groups as unknown[]) : [];
      const rawEntries = rawGroups.reduce((n: number, g) => {
        const entries = (g as { entries?: unknown } | null)?.entries;
        return n + (Array.isArray(entries) ? entries.length : 0);
      }, 0);
      checkCapacity({
        bodyBytes: args.bodyBytes,
        groupCount: rawGroups.length,
        entryCount: rawEntries,
      });

      const parsed = parseOrThrow(PublishRequestSchema, args.body);
      return ctx.publish.publish({
        baseRevision: parsed.baseRevision,
        summary: parsed.summary,
        config: parsed.config,
        operatorDeviceId: args.deviceId,
      });
    },
  };
}
