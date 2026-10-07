/**
 * src/services/team-config.service.ts —— 当前团队配置快照与 ETag
 *
 * 快照常驻内存：`GET /config` 由它直接应答，无磁盘 IO、无锁竞争（ADR-003 T3.5）。
 * 发布时同步重算快照，不引入异步写盘的中间态。
 *
 * `contentHash` 与磁盘一致性由 diagnostics 的 DATA_INTEGRITY 巡检项负责，
 * 这里只保证内存态自洽。
 */

import type { TeamConfig } from '../shared/schema/config.ts';
import { TeamConfigSchema } from '../shared/schema/config.ts';
import { computeContentHash } from '../shared/canonical-hash.ts';
import { readJsonFile } from '../repositories/atomic-json.ts';
import type { StoragePaths } from '../repositories/paths.ts';

/** ETag 是强校验器：`<revision>-<contentHash 前16位>`。 */
export function buildETag(config: TeamConfig): string {
  return `"${config.revision}-${config.contentHash.slice(0, 16)}"`;
}

/** 解析 If-None-Match。容忍带/不带引号、大小写一致即可，不做宽容归并。 */
export function parseETag(value: string | undefined): { revision: number; hashPrefix: string } | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^"|"$/g, '');
  const idx = raw.indexOf('-');
  if (idx <= 0) return null;
  const revision = Number.parseInt(raw.slice(0, idx), 10);
  const hashPrefix = raw.slice(idx + 1);
  if (!Number.isSafeInteger(revision) || hashPrefix.length === 0) return null;
  return { revision, hashPrefix };
}

export class TeamConfigService {
  private snapshot: TeamConfig | null = null;

  /** 启动时载入。文件损坏不算致命：快照为 null，等待管理员发布或修复。 */
  async load(paths: StoragePaths): Promise<void> {
    const raw = await readJsonFile<unknown>(paths.teamCurrent);
    const parsed = TeamConfigSchema.safeParse(raw);
    this.snapshot = parsed.success ? parsed.data : null;
  }

  get current(): TeamConfig | null {
    return this.snapshot;
  }

  get revision(): number {
    return this.snapshot?.revision ?? 0;
  }

  get etag(): string | null {
    return this.snapshot === null ? null : buildETag(this.snapshot);
  }

  /** 由发布流程调用（已在互斥锁内）。 */
  replace(config: TeamConfig): void {
    this.snapshot = config;
  }

  /** 重算哈希，用于 DATA_INTEGRITY 巡检：内存态与内容是否自洽。 */
  integrityOk(): boolean {
    if (this.snapshot === null) return true;
    const expected = computeContentHash({
      schemaVersion: this.snapshot.schemaVersion,
      instanceId: this.snapshot.instanceId,
      publishedAt: this.snapshot.publishedAt,
      groups: this.snapshot.groups,
    });
    return expected === this.snapshot.contentHash;
  }
}
