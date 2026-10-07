/**
 * src/repositories/revision.repository.ts —— 发布历史：变更记录 + 版本快照
 *
 * 两条保留线各 20 条（PRD P0-11）：
 *   - `revisions/index.jsonl`：变更记录追加日志，超出时整体重写保留最近 20 条
 *   - `revisions/0000000128.json`：该版本的完整配置快照，滚动清理最近 20 个
 *
 * 版本序列只增不减，回滚也产生新的更高 revision —— 快照因此是纯追加的，
 * 不存在"改历史"的路径，客户端也就不需要任何版本回退分支。
 */

import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { TeamConfigSchema } from '../shared/schema/config.ts';
import type { TeamConfig } from '../shared/schema/config.ts';
import { RETENTION } from '../shared/constants.ts';
import { readJsonFile, writeJsonAtomic } from './atomic-json.ts';
import { appendJsonLine, readJsonLines, rewriteJsonLines } from './jsonl.ts';
import { revisionSnapshotPath, type StoragePaths } from './paths.ts';

/** 变更记录（openapi ChangeRecord）。 */
export interface ChangeRecord {
  revision: number;
  publishedAt: string;
  operatorDeviceId: string | null;
  summary: string;
  diff: { added: number; updated: number; removed: number };
}

export class RevisionRepository {
  constructor(private readonly paths: StoragePaths) {}

  async append(record: ChangeRecord): Promise<void> {
    await appendJsonLine(this.paths.revisionIndex, record);
    await this.pruneIndex();
  }

  async readAll(): Promise<ChangeRecord[]> {
    return readJsonLines<ChangeRecord>(this.paths.revisionIndex);
  }

  /** 最近 n 条，从旧到新。 */
  async tail(n: number): Promise<ChangeRecord[]> {
    const all = await this.readAll();
    return all.length <= n ? all : all.slice(all.length - n);
  }

  async saveSnapshot(config: TeamConfig): Promise<void> {
    await writeJsonAtomic(revisionSnapshotPath(this.paths, config.revision), config);
    await this.pruneSnapshots();
  }

  async readSnapshot(revision: number): Promise<TeamConfig | null> {
    const raw = await readJsonFile<unknown>(revisionSnapshotPath(this.paths, revision));
    if (raw === null) return null;
    const parsed = TeamConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private async pruneIndex(): Promise<void> {
    const all = await this.readAll();
    if (all.length <= RETENTION.revisions) return;
    await rewriteJsonLines(this.paths.revisionIndex, all.slice(all.length - RETENTION.revisions));
  }

  private async pruneSnapshots(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.paths.revisionsDir);
    } catch {
      return;
    }
    const revisions = entries
      .filter((name) => /^\d{9}\.json$/.test(name))
      .map((name) => Number.parseInt(name.slice(0, 9), 10))
      .sort((a, b) => a - b);

    const stale = revisions.slice(0, Math.max(0, revisions.length - RETENTION.revisions));
    for (const revision of stale) {
      await rm(join(this.paths.revisionsDir, `${String(revision).padStart(9, '0')}.json`), {
        force: true,
      });
    }
  }
}
