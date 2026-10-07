/**
 * src/services/revision.service.ts —— 发布历史的只读侧
 *
 * 变更记录由 `revisions/index.jsonl` 派生（保留最近 20 条，仓库层已滚动）。
 * `/changes` 面向员工做增量（from old → new），`/revisions` 面向管理员做历史（new → old）。
 * 两者读同一份数据，但**排序语义相反**，这是刻意的：员工关心"之后发生了什么"，
 * 管理员关心"最近做过什么"。
 */

import type { ChangeRecord, RevisionRepository } from '../repositories/revision.repository.ts';

export interface ChangeList {
  items: ChangeRecord[];
  latestRevision: number;
}

export class RevisionService {
  constructor(private readonly repository: RevisionRepository) {}

  /** since 为开区间：只返回 revision 严格大于 since 的记录。 */
  async listChanges(since: number, limit: number, currentRevision: number): Promise<ChangeList> {
    const all = await this.repository.readAll();
    const filtered = all.filter((r) => r.revision > since);
    const items = filtered.length <= limit ? filtered : filtered.slice(filtered.length - limit);
    return { items, latestRevision: currentRevision };
  }

  async listRevisions(limit: number): Promise<{ items: ChangeRecord[] }> {
    const all = await this.repository.readAll();
    const newestFirst = [...all].reverse();
    return { items: newestFirst.slice(0, limit) };
  }
}
