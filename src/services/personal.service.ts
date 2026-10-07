/**
 * src/services/personal.service.ts —— 个人入口的 CRUD 与导入导出（P0-07）
 *
 * 纯逻辑（解析 / 冲突判定 / 合并）在 `src/shared/personal-import.ts`，本文件只负责
 * 编排与落盘。放 shared 而不是本目录下，是因为渲染层的浏览器预览要用同一份判定——
 * 一旦它另写一份，就会出现"预览说没冲突、真机覆盖了 5 条"这种用户无法察觉的差异。
 *
 * 落盘纪律（AC-14 的实现方式）：
 *   **先在内存里把结果算完，最后一次 save**。中途任何一步抛错都不写盘，
 *   因此"导入失败"绝不会留下半份被改过的个人数据。
 *
 * 冲突纪律（AC-15 的实现方式）：
 *   默认策略 ask；ask 且拿不到逐项决定时返回 needs-decision，**一个字节都不写**。
 *   静默覆盖的表现是"我导入之后旧入口没了"，现场只能靠猜，属于最难查的一类。
 */

import { randomUUID } from 'node:crypto';
import type { PersonalConfig } from '../shared/schema/local.ts';
import type { Entry } from '../shared/schema/entry.ts';
import type { Group } from '../shared/schema/group.ts';
import { AppError, isAppError } from '../shared/errors.ts';
import type { PersonalRepository } from '../repositories/personal.repository.ts';
import { capacityExceededCopy } from '../shared/capacity-copy.ts';
import { measure, withinCapacity } from '../shared/capacity-usage.ts';
import {
  measureImport,
  mergeGroups,
  parsePersonalFile,
  type ConflictAction,
  type ImportDecisions,
  type PersonalImportApplied,
  type PersonalImportOutcome,
  type PersonalImportPreview,
  type PlannedEntry,
} from '../shared/personal-import.ts';

export type {
  ConflictAction,
  ConflictPolicy,
  ImportDecisions,
  PersonalImportApplied,
  PersonalImportConflict,
  PersonalImportOutcome,
  PersonalImportPreview,
} from '../shared/personal-import.ts';

const EMPTY_GROUPS: Group[] = [];

/**
 * 个人入口与团队配置共用 `GroupListSchema`（≤8 组 / ≤200 入口）——这是刻意的，
 * 好处是个人导出的 JSON 与团队配置结构完全一致，将来"个人配置提交为团队入口"
 * 不需要做结构转换（team-lead 裁决，MVP 不放宽）。
 *
 * 上限不可协商，但**必须让人知道撞上了上限**：直接在 schema 里被拒的话，
 * 调用方拿到的是一条字段级的 ZodError，界面只能显示"操作失败"，
 * 用户就会对着一个没反应的界面猜。因此单独判、单独给带数字的文案。
 */
function assertWithinCapacity(config: { groups: Group[] }): void {
  const usage = measure(config);
  if (!withinCapacity(usage)) {
    throw new AppError('ERR_PAYLOAD_TOO_LARGE', capacityExceededCopy(usage));
  }
}

export class PersonalService {
  constructor(
    private readonly repository: PersonalRepository,
    private readonly newId: () => string = () => randomUUID(),
  ) {}

  /**
   * 读取当前配置。文件损坏时返回空配置但**不落盘**——
   * 要不要覆盖必须由用户在界面上决定（不许自愈式清空，AC-14 的精神）。
   */
  async load(): Promise<PersonalConfig> {
    const loaded = await this.repository.load();
    return loaded.config ?? { schemaVersion: 1, groups: [...EMPTY_GROUPS] };
  }

  /** 损坏诊断，供界面显示可复制的说明。 */
  async corruption(): Promise<{ corrupt: boolean; reason: string | null }> {
    const loaded = await this.repository.load();
    return { corrupt: loaded.corrupt, reason: loaded.reason ?? null };
  }

  async save(config: PersonalConfig): Promise<void> {
    assertWithinCapacity(config);
    await this.repository.save(config);
  }

  /**
   * 新增或更新一条入口。分组不存在时**连带建组**：
   * "我的入口"一开始没有任何分组，若要求调用方先建组才能加条目，
   * 界面上就会出现"添加成功但什么都没有"的空转。
   */
  async upsertEntry(groupId: string, entry: Entry, groupName = '我的入口'): Promise<PersonalConfig> {
    const config = await this.load();
    const groups = config.groups.some((group) => group.id === groupId)
      ? config.groups.map((group) => {
          if (group.id !== groupId) return group;
          const replacing = group.entries.some((e) => e.id === entry.id);
          return {
            ...group,
            entries: replacing
              ? group.entries.map((e) => (e.id === entry.id ? entry : e))
              : [...group.entries, entry],
          };
        })
      : [...config.groups, { id: groupId, name: groupName, sort: config.groups.length, entries: [entry] }];
    return this.persist(config, groups);
  }

  async removeEntry(entryId: string): Promise<PersonalConfig> {
    const config = await this.load();
    const groups = config.groups.map((group) => ({
      ...group,
      entries: group.entries.filter((e) => e.id !== entryId),
    }));
    return this.persist(config, groups);
  }

  /** 移动：跨组或组内换位置。越界索引夹到末尾，不抛错。 */
  async moveEntry(entryId: string, toGroupId: string, toIndex: number): Promise<PersonalConfig> {
    const config = await this.load();
    let moving: Entry | undefined;
    const without = config.groups.map((group) => {
      const found = group.entries.find((e) => e.id === entryId);
      if (found === undefined) return group;
      moving = found;
      return { ...group, entries: group.entries.filter((e) => e.id !== entryId) };
    });
    if (moving === undefined) return config;
    const entry = moving;

    const groups = without.map((group) => {
      if (group.id !== toGroupId) return group;
      const entries = [...group.entries];
      entries.splice(Math.max(0, Math.min(toIndex, entries.length)), 0, entry);
      return { ...group, entries };
    });
    return this.persist(config, groups);
  }

  /** 导出。带回入口数量——PRD §11.3 要求导出前显示包含多少条。 */
  async exportJson(): Promise<{ text: string; entryCount: number }> {
    const config = await this.load();
    return {
      text: `${JSON.stringify(config, null, 2)}\n`,
      entryCount: config.groups.reduce((sum, group) => sum + group.entries.length, 0),
    };
  }

  /** 预览。校验不过时返回可复制的原因，且**不读也不写**现有数据。 */
  previewImport(
    text: string,
    current: PersonalConfig,
  ): { ok: true; preview: PersonalImportPreview } | { ok: false; reason: string; details?: string[] } {
    const parsed = parsePersonalFile(text);
    if (!parsed.ok) return parsed;
    return { ok: true, preview: measureImport(parsed.config, current) };
  }

  /**
   * 提交导入。三条"不成功"的出口**一律返回、不抛错**（AC-14）：
   *   - 文件非法 / 文件超上限 → `kind:'error'` + 可复制的原因
   *   - 合并后撞上限         → `kind:'error'` + 容量文案
   *   - ask 且仍有未决定项   → `kind:'needs-decision'` + 冲突清单
   *
   * 为什么不抛：这个结果是直接过 IPC 给界面的（`ImportCommitResult` 有 error 变体）。
   * 抛出去就是一个未捕获的 Promise rejection，界面上表现为"点了导入，没反应"——
   * 正是"静默失败"最难查的那种。可预期的结果就该是可展示的值。
   * 真正不可预期的（写盘失败）才由调用方兜底。
   */
  async commitImport(text: string, decisions: ImportDecisions): Promise<PersonalImportOutcome> {
    const parsed = parsePersonalFile(text);
    if (!parsed.ok) {
      return { kind: 'error', reason: parsed.reason };
    }
    const current = await this.load();
    const preview = measureImport(parsed.config, current);
    const perEntry = decisions.perEntry ?? {};

    if (decisions.policy === 'ask' && preview.conflicts.length > 0) {
      const undecided = preview.conflicts.filter((c) => perEntry[c.incomingId] === undefined);
      if (undecided.length > 0) {
        return { kind: 'needs-decision', conflicts: preview.conflicts };
      }
    }

    const actionOf = (conflictId: string): ConflictAction => {
      const explicit = perEntry[conflictId];
      if (explicit !== undefined) return explicit;
      // 走到这里 policy 必然不是 ask（ask 已在上一步被拦截）。
      return decisions.policy === 'ask' ? 'skip' : decisions.policy;
    };

    const conflictById = new Set(preview.conflicts.map((c) => c.incomingId));
    const result: PersonalImportApplied = { added: 0, overwritten: 0, skipped: 0, copied: 0 };
    const planned: PlannedEntry[] = [];
    const seenIncoming = new Set<string>();

    for (const group of parsed.config.groups) {
      for (const entry of group.entries) {
        if (seenIncoming.has(entry.id)) continue;
        seenIncoming.add(entry.id);

        if (!conflictById.has(entry.id)) {
          planned.push({ groupId: group.id, entry, action: 'add' });
          result.added += 1;
          continue;
        }
        const action = actionOf(entry.id);
        if (action === 'skip') {
          result.skipped += 1;
          continue;
        }
        if (action === 'copy') {
          planned.push({ groupId: group.id, entry: { ...entry, id: this.newId() }, action: 'copy' });
          result.copied += 1;
          continue;
        }
        planned.push({ groupId: group.id, entry, action: 'overwrite' });
        result.overwritten += 1;
      }
    }

    let saved: PersonalConfig;
    try {
      saved = await this.persist(current, mergeGroups(current, parsed.config, planned));
    } catch (err) {
      // 文件合法、也无冲突，但"现有 + 导入"合起来撞上限——预览阶段算不出来，
      // 只能在这里拦。抛出去会变成界面上的"没反应"，因此转成可展示的结果。
      if (isAppError(err) && err.code === 'ERR_PAYLOAD_TOO_LARGE') {
        return { kind: 'error', reason: err.message };
      }
      throw err;
    }
    // 回带落盘后的配置：调用方（preload）据此刷新缓存，
    // 否则导入成功后读到的还是旧值，界面上就是"导入了但没变化"。
    return { kind: 'applied', result, config: saved };
  }

  private async persist(config: PersonalConfig, groups: Group[]): Promise<PersonalConfig> {
    const next: PersonalConfig = { ...config, updatedAt: new Date().toISOString(), groups };
    // 先判容量再落盘：超限时不留下任何半份改动。
    assertWithinCapacity(next);
    await this.repository.save(next);
    return next;
  }
}
