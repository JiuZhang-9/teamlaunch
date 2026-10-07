/**
 * src/services/publish.service.ts —— 发布与还原（ADR-003 版本只增不减）
 *
 * 三条不变式，任何一条破了都是静默数据事故：
 *   1. revision 只增不减。**还原也产生新的更高 revision**，历史始终线性，
 *      客户端因此不需要任何"版本回退"分支。
 *   2. 乐观并发：`baseRevision` 必须等于服务端当前 revision，否则 409。
 *      还原同样要带 baseRevision —— 否则管理员 A 打开还原对话框期间
 *      B 发布的内容会被静默覆盖（Spec §5 补充字段的明确要求）。
 *   3. instanceId 必须匹配，否则 409 ERR_INSTANCE_MISMATCH（连错数据源）。
 *
 * 整段流程串行化：读当前版本 → 校验 → 推进 → 落盘 → 替换内存快照。
 * 中间有 await，不串行就会出现两次发布拿到同一个 baseRevision 的窗口。
 */

import { computeContentHash } from '../shared/canonical-hash.ts';
import { AppError } from '../shared/errors.ts';
import type { TeamConfig, TeamConfigBody } from '../shared/schema/config.ts';
import type { Entry } from '../shared/schema/entry.ts';
import type { Group } from '../shared/schema/group.ts';
import type { RevisionRepository } from '../repositories/revision.repository.ts';
import type { TeamConfigRepository } from '../repositories/team-config.repository.ts';
import type { TeamConfigService } from './team-config.service.ts';
import { createMutex } from '../utils/single-flight.ts';

export interface PublishInput {
  baseRevision: number;
  summary: string;
  config: TeamConfigBody;
  operatorDeviceId: string | null;
}

export interface PublishResult {
  revision: number;
  contentHash: string;
  publishedAt: string;
}

export interface ConflictDetail {
  currentRevision: number;
  currentContentHash: string;
}

export class PublishService {
  private readonly mutex = createMutex();

  constructor(
    private readonly configService: TeamConfigService,
    private readonly configRepository: TeamConfigRepository,
    private readonly revisions: RevisionRepository,
    private readonly instanceId: string,
  ) {}

  publish(input: PublishInput): Promise<PublishResult> {
    return this.mutex(() => this.commit(input.config, input.summary, input.operatorDeviceId, input.baseRevision));
  }

  /**
   * 以历史版本的内容生成新版本。快照不存在 → 404；baseRevision 不符 → 409。
   */
  async restore(revision: number, baseRevision: number, operatorDeviceId: string | null): Promise<PublishResult> {
    return this.mutex(async () => {
      const snapshot = await this.revisions.readSnapshot(revision);
      if (snapshot === null) {
        throw new AppError('ERR_NOT_FOUND', '未找到该版本');
      }
      const body: TeamConfigBody = {
        schemaVersion: snapshot.schemaVersion,
        instanceId: snapshot.instanceId,
        groups: snapshot.groups,
        announcements: snapshot.announcements ?? [],
      };
      return this.commit(body, `还原到版本 ${revision}`, operatorDeviceId, baseRevision);
    });
  }

  private async commit(
    body: TeamConfigBody,
    summary: string,
    operatorDeviceId: string | null,
    baseRevision: number,
  ): Promise<PublishResult> {
    const current = this.configService.current;
    const currentRevision = current?.revision ?? 0;

    if (body.instanceId !== this.instanceId) {
      throw new AppError('ERR_INSTANCE_MISMATCH', '连接到了另一个团队数据源');
    }
    if (baseRevision !== currentRevision) {
      throw new AppError('ERR_REVISION_CONFLICT', '版本已变更，请查看最新内容后重新发布', {
        data: {
          currentRevision,
          currentContentHash: current?.contentHash ?? '',
        } satisfies ConflictDetail,
      });
    }

    const revision = currentRevision + 1;
    const publishedAt = new Date().toISOString();
    const contentHash = computeContentHash({
      schemaVersion: body.schemaVersion,
      instanceId: body.instanceId,
      publishedAt,
      groups: body.groups,
      announcements: body.announcements,
    });

    const next: TeamConfig = { ...body, revision, contentHash, publishedAt };

    // 先落盘再换内存：中途失败时内存仍是旧版本，不会"看起来发布成功"。
    await this.configRepository.save(next);
    await this.revisions.saveSnapshot(next);
    await this.revisions.append({
      revision,
      publishedAt,
      operatorDeviceId,
      summary,
      diff: diffOf(current?.groups ?? [], body.groups),
    });
    this.configService.replace(next);

    return { revision, contentHash, publishedAt };
  }
}

/** 变更摘要的计数。按 id 比对，内容变了才算 updated（避免把"顺序调整"谎报为修改）。 */
export function diffOf(previous: Group[], next: Group[]): { added: number; updated: number; removed: number } {
  const before = new Map<string, string>();
  for (const group of previous) {
    for (const entry of group.entries) before.set(entry.id, fingerprint(entry));
  }
  const after = new Map<string, string>();
  for (const group of next) {
    for (const entry of group.entries) after.set(entry.id, fingerprint(entry));
  }

  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const [id, fp] of after) {
    const old = before.get(id);
    if (old === undefined) added += 1;
    else if (old !== fp) updated += 1;
  }
  for (const id of before.keys()) {
    if (!after.has(id)) removed += 1;
  }
  return { added, updated, removed };
}

function fingerprint(entry: Entry): string {
  return JSON.stringify(entry);
}
