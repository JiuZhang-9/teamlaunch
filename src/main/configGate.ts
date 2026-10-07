/**
 * src/main/configGate.ts —— 员工端缓存的读取与**三重闸门**
 *
 * 单独成文件是因为这两件事都涉及"什么才算一份可信的团队配置"，
 * 放在一起改才不会漏；也避免 syncClient 变成什么都往里塞的大文件。
 *
 * 三重闸门（任一条不过就拒收，且不动旧缓存）：
 *   1. HTTP 200（由调用方保证）
 *   2. TeamConfigSchema.safeParse 通过
 *   3. 本地重算 sha256 等于响应里的 contentHash
 */

import { readJsonFile } from '../repositories/atomic-json.ts';
import type { StoragePaths } from '../repositories/paths.ts';
import { TeamConfigRepository } from '../repositories/team-config.repository.ts';
import { computeContentHash } from '../shared/canonical-hash.ts';
import { TeamConfigSchema } from '../shared/schema/config.ts';
import type { TeamConfig } from '../shared/schema/config.ts';

export interface TeamCache {
  config: TeamConfig;
  /** 服务端签发的 ETag，原样回传（禁止本地构造）。 */
  etag: string | null;
}

/**
 * 读本机缓存。损坏时返回 null —— 不是"没缓存"，但也绝不能拿坏数据去渲染，
 * 等下一轮拉到好数据覆盖它。
 */
export async function loadCache(repo: TeamConfigRepository, paths: StoragePaths): Promise<TeamCache | null> {
  const loaded = await repo.load();
  if (loaded.config === null) return null;
  const meta = await readJsonFile<{ etag?: string }>(paths.teamMeta);
  return { config: loaded.config, etag: typeof meta?.etag === 'string' ? meta.etag : null };
}

/**
 * 三道闸门。返回的 config 为 null 即拒收，why 只用于日志/自检，不进 UI。
 *
 * 哈希重算走 shared/canonical-hash.ts 的 computeContentHash（规范化与 canonical.ts 共用同一份），
 * 不在这里另立规范化规则——两端各写一份，"随机校验失败"就是必然结果。
 */
export function validateBody(body: string | null): { config: TeamConfig | null; why: string } {
  if (body === null || body.length === 0) return { config: null, why: '正文为空' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { config: null, why: '不是合法 JSON' };
  }
  const envelope = parsed as { code?: number; data?: unknown };
  const payload = envelope.code === 0 && envelope.data !== undefined ? envelope.data : parsed;

  const result = TeamConfigSchema.safeParse(payload);
  if (!result.success) return { config: null, why: 'schema 校验未通过' };

  const config = result.data;
  if (computeContentHash(config) !== config.contentHash) {
    return { config: null, why: '内容哈希与 contentHash 不一致' };
  }
  return { config, why: '' };
}
