/**
 * src/shared/personal-import.ts —— 个人入口导入的解析、冲突判定与合并
 *
 * 放在 shared 而不是 services 的原因不是"文件该放哪"的风格问题：
 * **预览与提交必须共用同一个 `measureImport`**。分成两处写就会出现
 * "预览说 3 条冲突、实际覆盖了 5 条"——用户只会事后发现数据不对，
 * 根本不知道当初预览给错了数，属于最难的那一类静默数据丢失。
 * 而渲染层要在浏览器预览里跑同一套判定，所以它必须能被渲染层 import，
 * 不能待在只有主进程能碰的 services 里。
 *
 * 三条产品语义（Spec AC-14 / AC-15、PRD §11.3）：
 *   1. 导入文件必须**先过 zod 全量校验**才允许继续，失败给可复制的原因。
 *   2. 冲突必须显式列出（新增 / 覆盖 / 冲突各自计数），供界面预览。
 *   3. 冲突处置只有 skip / overwrite / copy 三种，没有任何"默认覆盖"的分支。
 *
 * 纯函数约束：不依赖 repository、不落盘、不读时钟、不 import electron。
 */

import { PersonalConfigSchema } from './schema/local.ts';
import type { PersonalConfig } from './schema/local.ts';
import type { Entry } from './schema/entry.ts';
import type { Group } from './schema/group.ts';
import { importFileTooLargeCopy } from './capacity-copy.ts';
import { measure, withinCapacity } from './capacity-usage.ts';

export type ConflictAction = 'skip' | 'overwrite' | 'copy';
export type ConflictPolicy = 'ask' | ConflictAction;

export interface PersonalImportConflict {
  incomingId: string;
  incomingName: string;
  existingId: string;
  existingName: string;
  /** id 重复 = 同一条；target 重复 = 目标一致但 id 不同。 */
  kind: 'id' | 'target';
}

export interface PersonalImportPreview {
  /** 导入文件中的入口总数（含重复 id）。 */
  total: number;
  added: number;
  overwritten: number;
  conflicts: PersonalImportConflict[];
}

export interface PersonalImportApplied {
  added: number;
  overwritten: number;
  skipped: number;
  copied: number;
}

export type PersonalImportOutcome =
  /** 回带落盘后的规范配置，供调用方刷新缓存（与 PersonalSaveResult.ok:true 同形态）。 */
  | { kind: 'applied'; result: PersonalImportApplied; config: PersonalConfig }
  /** ask 且仍有未决定的项：不落盘，把冲突清单交回界面。 */
  | { kind: 'needs-decision'; conflicts: PersonalImportConflict[] }
  /** 提交阶段被拦下（文件非法、或合并后超限）：未做任何改动。 */
  | { kind: 'error'; reason: string };

export interface ImportDecisions {
  policy: ConflictPolicy;
  /** 逐项决定，键是**导入文件中**的入口 id。仅在 policy='ask' 时需要。 */
  perEntry?: Record<string, ConflictAction>;
}

/** 一条"最终要写入什么"的计划。副本的新 id 在这里定下来，避免合并时丢映射。 */
export interface PlannedEntry {
  groupId: string;
  entry: Entry;
  action: 'add' | 'overwrite' | 'copy';
}

export type ParsedPersonal = { ok: true; config: PersonalConfig }
  | { ok: false; reason: string; details?: string[] };

/**
 * 导入文件的唯一解析入口：JSON 解析 → 容量闸门 → zod 全量校验。
 *
 * 容量必须**单独判、单独给文案**：它会被 schema 一起拒，但那样得到的只有
 * "结构校验未通过"，用户不知道是"文件坏了"还是"入口太多了"。
 * 上限是不可协商的限制，静默失败等于让用户对着一个没反应的界面猜。
 */
export function parsePersonalFile(text: string): ParsedPersonal {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: '这不是合法的 JSON 文件，个人入口未做任何改动' };
  }

  const usage = measure(raw);
  if (!withinCapacity(usage)) {
    return { ok: false, reason: importFileTooLargeCopy(usage) };
  }

  const parsed = PersonalConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 5).map((issue) => {
      const path = issue.path.map((p) => String(p)).join('.');
      return `${path.length === 0 ? '(根)' : path}: ${issue.message}`;
    });
    return { ok: false, reason: '导入文件的结构校验未通过，个人入口未做任何改动', details };
  }
  return { ok: true, config: parsed.data };
}

/** 目标键：app/folder 比 target，web 比 url；Windows 路径大小写不敏感，统一小写。 */
export function targetKeyOf(entry: Entry): string | null {
  const target = entry.type === 'web' ? entry.url : entry.target;
  return typeof target === 'string' && target.length > 0 ? target.toLowerCase() : null;
}

/**
 * 冲突判定。预览与提交**共用这一个函数**，分两处写必分叉。
 *
 * 注意"目标重复"用的是现有配置的**首个**匹配：同一 target 在现有数据里
 * 出现多次时，报哪一条并不影响处置结果（都要用户决定），因此取首个即可。
 */
export function measureImport(incoming: PersonalConfig, current: PersonalConfig): PersonalImportPreview {
  const existingById = new Map<string, Entry>();
  const existingByTarget = new Map<string, Entry>();
  for (const group of current.groups) {
    for (const entry of group.entries) {
      existingById.set(entry.id, entry);
      const key = targetKeyOf(entry);
      if (key !== null && !existingByTarget.has(key)) existingByTarget.set(key, entry);
    }
  }

  const conflicts: PersonalImportConflict[] = [];
  const seenIncoming = new Set<string>();
  let total = 0;
  let added = 0;
  let overwritten = 0;

  for (const group of incoming.groups) {
    for (const entry of group.entries) {
      total += 1;
      if (seenIncoming.has(entry.id)) continue;
      seenIncoming.add(entry.id);

      const byId = existingById.get(entry.id);
      if (byId !== undefined) {
        conflicts.push({
          incomingId: entry.id,
          incomingName: entry.name,
          existingId: byId.id,
          existingName: byId.name,
          kind: 'id',
        });
        overwritten += 1;
        continue;
      }
      const key = targetKeyOf(entry);
      const byTarget = key === null ? undefined : existingByTarget.get(key);
      if (byTarget !== undefined) {
        conflicts.push({
          incomingId: entry.id,
          incomingName: entry.name,
          existingId: byTarget.id,
          existingName: byTarget.name,
          kind: 'target',
        });
        overwritten += 1;
        continue;
      }
      added += 1;
    }
  }

  return { total, added, overwritten, conflicts };
}

/** 合并：覆盖就地替换，新增/副本追加到它来源的那个分组（分组不存在则按导入定义建组）。 */
export function mergeGroups(
  current: PersonalConfig,
  incoming: PersonalConfig,
  planned: PlannedEntry[],
): Group[] {
  const overwriteById = new Map<string, Entry>();
  for (const item of planned) {
    if (item.action === 'overwrite') overwriteById.set(item.entry.id, item.entry);
  }

  const merged: Group[] = current.groups.map((group) => ({
    ...group,
    entries: group.entries.map((entry) => overwriteById.get(entry.id) ?? entry),
  }));
  const indexByGroupId = new Map<string, number>(merged.map((group, i) => [group.id, i]));

  for (const item of planned) {
    if (item.action === 'overwrite') continue;
    const known = indexByGroupId.get(item.groupId);
    if (known !== undefined) {
      const target = merged[known];
      if (target !== undefined) {
        merged[known] = { ...target, entries: [...target.entries, item.entry] };
        continue;
      }
    }
    const definition = incoming.groups.find((group) => group.id === item.groupId);
    merged.push({
      id: item.groupId,
      name: definition?.name ?? '导入的分组',
      sort: definition?.sort ?? merged.length,
      entries: [item.entry],
    });
    indexByGroupId.set(item.groupId, merged.length - 1);
  }

  return merged;
}
