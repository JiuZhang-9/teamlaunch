/**
 * 我的入口（personal.json）—— 本机可编辑，永不跨设备同步。
 * 导入导出走的两条铁律在 actions 里落实：非法文件不改现有数据（AC-14）、冲突不静默覆盖（AC-15）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../bridge/index.ts';
import type { PersonalConfig } from '../../shared/schema/local.ts';
import type { Entry } from '../../shared/schema/entry.ts';
import { CAPACITY } from '../../shared/schema/common.ts';
import { entryLimitCopy, groupLimitCopy } from '../../shared/capacity-copy.ts';
import { makeEntry, type NewEntryInput } from '../../shared/new-entry.ts';
import { moveEntries } from '../../shared/move-entries.ts';

/** 入口 id：本机生成，不依赖网络，也不与团队配置冲突（团队用 e- 前缀）。 */
const newId = (): string => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 逐项决定用的键是**导入文件里**的 id（后端 ImportDecisions.perEntry 的约定）。 */
export interface ImportConflictItem {
  id: string;
  name: string;
  existingName: string;
  kind: 'id' | 'target';
}

export type ImportChoice = 'copy' | 'overwrite' | 'skip';

/** 新增入口的入参（定义在 shared/new-entry.ts：个人页与团队编辑态共用同一套换算）。 */
export type { NewEntryInput } from '../../shared/new-entry.ts';

/** 个人入口的默认分组名：全新安装时没有任何分组，必须能自动建出来。 */
const DEFAULT_GROUP = '我的入口';

/**
 * 导入结果。三条分支必须分开：
 *  - `error`    预览就被拒（文件坏了 / 文件本身超限）—— 现有数据零改动；
 *  - `conflict` 有冲突，等用户逐项决定；
 *  - `applied`  已落地。
 * 另有一个**只在提交阶段**才可能出现的失败（文件合法、无冲突，但合并后超限），
 * 由 `resolveImport` 抛出、交给界面按 error 呈现（见 beginImport 的注释）。
 */
export type ImportOutcome =
  | { kind: 'error'; error: string; line: number | null }
  | { kind: 'conflict'; conflicts: ImportConflictItem[] }
  | { kind: 'applied'; added: number; overwritten: number; skipped: number; copied: number }
  | null;

/** 提交阶段被容量闸拦下：预览过了，但一个字节都没写。 */
export class ImportRejectedError extends Error {}

export interface CapacityUsage {
  entries: number;
  groups: number;
  atEntryLimit: boolean;
  atGroupLimit: boolean;
}

interface PersonalCtx {
  config: PersonalConfig;
  /** 当前占用与是否撞上限 —— 「添加」按钮据此前置禁用（不等后端抛错才说）。 */
  usage: CapacityUsage;
  removeEntry(entryId: string): Promise<void>;
  /** 批量删除（多选）：一次落盘，不做逐条覆盖写。 */
  removeEntries(entryIds: string[]): Promise<void>;
  renameEntry(entryId: string, name: string): Promise<void>;
  moveEntry(entryId: string, delta: -1 | 1): Promise<void>;
  addCopy(entryId: string): Promise<void>;
  /** 批量创建副本（多选）：容量按整批在写之前判，命名去重也跨整批算。 */
  addCopies(entryIds: string[]): Promise<{ ok: boolean; added: number; reason?: string }>;
  /**
   * 新增一个入口（从本机选择的程序或文件夹）。
   *
   * 这个方法此前**完全不存在**——个人页的「添加」按钮只有一句提示、没有任何真实路径，
   * 所以 P0-07 的"本机新增"一直是空的。这里补齐。
   * 分组不存在时自动创建（否则第一条入口永远加不进去）。
   */
  addEntry(input: NewEntryInput): Promise<{ ok: boolean; reason?: string }>;
  /** 批量新增（开始菜单扫描后多选添加用）。 */
  addEntries(inputs: NewEntryInput[]): Promise<{ ok: boolean; added: number; reason?: string }>;
  /**
   * 整条新增（入口编辑器对话框的写入口）：与团队编辑器同一套类型/目标表单，
   * 支持 web（此前的 pickers 只能加 app/folder，个人入口添加网页没有入口）。
   * groupId 为空时落到第一个分组，没有任何分组则自动建「我的入口」。
   */
  addEntryObject(entry: Entry, groupId: string | null): Promise<{ ok: boolean; reason?: string }>;
  /**
   * 整条替换（卡片「重编辑」）：按 id 原位替换；groupId 非空且不同于当前组时，
   * 迁移到目标组末尾。不是新增，不触发容量闸。
   */
  updateEntryObject(entry: Entry, groupId: string | null): Promise<{ ok: boolean; reason?: string }>;
  /** 新建分组（「新分组 N」），容量闸前置。 */
  /** name 由「新建分组」对话框传入；不传时自动命名（默认「新分组 N」）。 */
  addGroup(name?: string): Promise<{ ok: boolean; reason?: string }>;
  renameGroup(groupId: string, name: string): Promise<void>;
  /** 分组整体换序；到边界时不动。 */
  moveGroup(groupId: string, delta: -1 | 1): Promise<void>;
  /** 分组按名称排序（zh-CN 拼音序）。整理顺序拖拽/快捷键之外的粗粒度整理手段。 */
  sortGroupsByName(): Promise<void>;
  /** 删除分组连带组内入口，调用方必须先确认。 */
  removeGroup(groupId: string): Promise<void>;
  /**
   * 把入口移动到另一个分组（可带目标位置 index）：拖拽排序与跨组移动的唯一写入口。
   * toIndex 是"落点前移除后"的插入位置；同组内自动补偿移除造成的索引偏移；
   * 落点与原位相同则原样返回（拖回自己 = 无操作）。
   */
  moveEntryToGroup(entryId: string, toGroupId: string, toIndex?: number): Promise<void>;
  /** 批量移动到同一个分组（多选）：按清单顺序追加到目标组末尾，一次落盘。 */
  /** 多选整块移动（右键批量菜单与拖拽整块）：可带目标位置，语义同单条移动。 */
  moveEntriesToGroup(entryIds: string[], toGroupId: string, toIndex?: number): Promise<void>;
  exportJson(): Promise<{ ok: true; path: string; count: number } | { ok: false; reason: string }>;
  /** 两段式的第一段：预览，不改任何数据。 */
  beginImport(text: string): Promise<ImportOutcome>;
  /** 第二段：带逐项决定提交。默认策略恒为 ask（AC-15）。 */
  resolveImport(choices: Record<string, ImportChoice>): Promise<ImportOutcome>;
}

const Ctx = createContext<PersonalCtx | null>(null);

const clone = (c: PersonalConfig): PersonalConfig => JSON.parse(JSON.stringify(c)) as PersonalConfig;

export function PersonalProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PersonalConfig>(() => api.personal.get());
  /** 最近一次通过预览的待导入**原文**。提交前不落盘（AC-14 / AC-15）。 */
  const pendingText = useRef<string | null>(null);

  /* R23（2026-10-17）：首帧读缓存可能早于 preload 预热完成——那时「我的入口」是空的
     （重启即好）。预热完成后重取一次；缓存被每次保存实时更新，不会覆盖用户刚做的改动。 */
  useEffect(() => {
    let cancelled = false;
    void api.ready.then(() => {
      if (!cancelled) setConfig(api.personal.get());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const usage = useMemo<CapacityUsage>(() => {
    const entries = config.groups.reduce((n, g) => n + g.entries.length, 0);
    const groups = config.groups.length;
    return {
      entries,
      groups,
      atEntryLimit: entries >= CAPACITY.MAX_ENTRIES,
      atGroupLimit: groups >= CAPACITY.MAX_GROUPS,
    };
  }, [config.groups]);

  const commit = useCallback(async (next: PersonalConfig) => {
    setConfig(next);
    await api.personal.save(next);
  }, []);

  /** 对所有分组统一施加变换（用于删除 / 改名 / 复制）。 */
  const mapEntries = (mapper: (e: Entry, groupId: string, index: number) => Entry[]) =>
    clone(config).groups.map((g) => ({
      ...g,
      entries: g.entries.flatMap((e, i) => mapper(e, g.id, i)),
    }));

  const removeEntry = useCallback(
    async (entryId: string) => {
      const groups = mapEntries((e) => (e.id === entryId ? [] : [e]));
      await commit({ ...config, groups });
    },
    [config, commit, mapEntries],
  );

  const renameEntry = useCallback(
    async (entryId: string, name: string) => {
      const groups = mapEntries((e) => (e.id === entryId ? [{ ...e, name }] : [e]));
      await commit({ ...config, groups });
    },
    [config, commit, mapEntries],
  );

  /** 键盘 Alt+↑/↓ 在组内移动顺序（拖拽的等价物），不做错误的是否跨组判断。 */
  const moveEntry = useCallback(
    async (entryId: string, delta: -1 | 1) => {
      const groups = clone(config).groups.map((g) => {
        const i = g.entries.findIndex((e) => e.id === entryId);
        if (i < 0) return g;
        const j = i + delta;
        if (j < 0 || j >= g.entries.length) return g;
        const entries = [...g.entries];
        [entries[i], entries[j]] = [entries[j], entries[i]];
        return { ...g, entries: entries.map((e, k) => ({ ...e, sort: k })) };
      });
      await commit({ ...config, groups });
    },
    [config, commit],
  );

  const addCopy = useCallback(
    async (entryId: string) => {
      const existing = config.groups.flatMap((g) => g.entries).map((e) => e.name);
      const groups = mapEntries((e, _gid) => {
        if (e.id !== entryId) return [e];
        let n = 1;
        while (existing.includes(`${e.name}（副本${n === 1 ? '' : ` ${n}`}）`)) n += 1;
        const name = `${e.name}（副本${n === 1 ? '' : ` ${n}`}）`;
        return [e, { ...e, id: `${e.id}-copy-${n}`, name, sort: e.sort + 1 }];
      });
      await commit({ ...config, groups });
    },
    [config, commit, mapEntries],
  );

  /**
   * 新增入口：分组不存在时自动创建。
   *
   * 这条很重要——全新安装时 personal.json 里没有任何分组，
   * 若只在已存在分组里追加，第一条入口永远加不进去（界面表现为"点了没反应"）。
   */
  const addEntry = useCallback(
    async (input: NewEntryInput): Promise<{ ok: boolean; reason?: string }> => {
      const total = config.groups.reduce((n, g) => n + g.entries.length, 0);
      if (total >= CAPACITY.MAX_ENTRIES) {
        return { ok: false, reason: entryLimitCopy({ entries: total, groups: config.groups.length }) };
      }
      const name = (input.groupName ?? DEFAULT_GROUP).trim() || DEFAULT_GROUP;
      const groups = clone(config).groups;
      let group = groups.find((g) => g.name === name);
      if (!group) {
        if (groups.length >= CAPACITY.MAX_GROUPS) {
          return { ok: false, reason: groupLimitCopy({ entries: total, groups: groups.length }) };
        }
        group = { id: `g-${newId()}`, name, sort: groups.length, entries: [] };
        groups.push(group);
      }
      // app / folder 是判别联合的不同分支：造条目的规则在 makeEntry 里，批量路径共用同一份。
      group.entries.push(makeEntry(input, group.entries.length, newId(), new Date().toISOString()));
      await commit({ ...config, groups });
      return { ok: true };
    },
    [config, commit],
  );

  /** 批量删除：一次算完、只落盘一次（逐条 removeEntry 会各写一次且互相覆盖）。 */
  const removeEntries = useCallback(
    async (entryIds: string[]) => {
      const gone = new Set(entryIds);
      const groups = mapEntries((e) => (gone.has(e.id) ? [] : [e]));
      await commit({ ...config, groups });
    },
    [config, commit, mapEntries],
  );

  /** 副本命名：与单条 addCopy 同一套格式（去重基准跨整批统一）。 */
  const copyName = (base: string, n: number): string => `${base}（副本${n === 1 ? '' : ` ${n}`}）`;

  /**
   * 批量创建副本：容量在写之前按整批判（超了就只做放得下的那几条），
   * 命名去重也在整批范围内算——否则同一批里会出现两个同名副本。
   */
  const addCopies = useCallback(
    async (entryIds: string[]): Promise<{ ok: boolean; added: number; reason?: string }> => {
      const total = config.groups.reduce((n, g) => n + g.entries.length, 0);
      const room = CAPACITY.MAX_ENTRIES - total;
      if (room <= 0 || entryIds.length === 0) {
        return {
          ok: false,
          added: 0,
          reason: entryLimitCopy({ entries: total, groups: config.groups.length }),
        };
      }
      const wanted = entryIds.slice(0, room);
      const taken = new Set(config.groups.flatMap((g) => g.entries.map((e) => e.name)));
      let added = 0;
      const groups = clone(config).groups.map((g) => {
        const entries: Entry[] = [];
        for (const e of g.entries) {
          entries.push(e);
          if (!wanted.includes(e.id)) continue;
          let n = 1;
          while (taken.has(copyName(e.name, n))) n += 1;
          const name = copyName(e.name, n);
          taken.add(name);
          entries.push({ ...e, id: `${e.id}-copy-${n}`, name, sort: e.sort + 1 });
          added += 1;
        }
        return { ...g, entries: entries.map((e, i) => ({ ...e, sort: i })) };
      });
      await commit({ ...config, groups });
      return {
        ok: entryIds.length <= room,
        added,
        reason: entryIds.length > room ? entryLimitCopy({ entries: total, groups: config.groups.length }) : undefined,
      };
    },
    [config, commit],
  );

  /** 批量移动到同一个分组：按清单顺序追加到目标组末尾，一次落盘。 */
  /** 多选批量移动（右键批量菜单与拖拽整块都走它）：一次落盘、按页面顺序追加/插入。 */
  const moveEntriesToGroup = useCallback(
    async (entryIds: string[], toGroupId: string, toIndex?: number) => {
      const next = moveEntries(clone(config).groups, entryIds, toGroupId, toIndex);
      await commit({ ...config, groups: next });
    },
    [config, commit],
  );

  /**
   * 批量新增：**一次性算完、只落盘一次**。
   *
   * 此前是循环调 addEntry——每个调用都基于同一份旧 config 克隆，
   * 结果是"加了 N 条只剩最后一条"（勾选多个程序一起导入时就撞上）。
   * 容量按累计条数在写之前判，撞上限时停下并回报已加入的条数。
   */
  const addEntries = useCallback(
    async (inputs: NewEntryInput[]): Promise<{ ok: boolean; added: number; reason?: string }> => {
      const groups = clone(config).groups;
      let total = groups.reduce((n, g) => n + g.entries.length, 0);
      let added = 0;
      for (const input of inputs) {
        const groupName = (input.groupName ?? DEFAULT_GROUP).trim() || DEFAULT_GROUP;
        let group = groups.find((g) => g.name === groupName);
        if (!group) {
          /* 目标分组还不存在（首次导入到自定义组名）：两个上限都可能挡住它，
             报**真正挡住的那个**，别用合并文案让人自己去猜。 */
          if (groups.length >= CAPACITY.MAX_GROUPS) {
            return { ok: added > 0, added, reason: groupLimitCopy({ entries: total, groups: groups.length }) };
          }
          if (total >= CAPACITY.MAX_ENTRIES) {
            return { ok: added > 0, added, reason: entryLimitCopy({ entries: total, groups: groups.length }) };
          }
          group = { id: `g-${newId()}`, name: groupName, sort: groups.length, entries: [] };
          groups.push(group);
        } else if (total >= CAPACITY.MAX_ENTRIES) {
          return { ok: added > 0, added, reason: entryLimitCopy({ entries: total, groups: groups.length }) };
        }
        group.entries.push(makeEntry(input, group.entries.length, newId(), new Date().toISOString()));
        total += 1;
        added += 1;
      }
      await commit({ ...config, groups });
      return { ok: true, added };
    },
    [config, commit],
  );

  /**
   * 整条新增：入口编辑器（与团队同款表单）的落盘口。
   * schema 校验交给 savePersonal 的既有闸（zod + 容量），这里只做分组定位与占位。
   */
  const addEntryObject = useCallback(
    async (entry: Entry, groupId: string | null): Promise<{ ok: boolean; reason?: string }> => {
      const total = config.groups.reduce((n, g) => n + g.entries.length, 0);
      if (total >= CAPACITY.MAX_ENTRIES) {
        return { ok: false, reason: entryLimitCopy({ entries: total, groups: config.groups.length }) };
      }
      const groups = clone(config).groups;
      let group = groups.find((g) => g.id === groupId);
      if (!group && groups.length > 0) group = groups[0];
      if (!group) {
        if (groups.length >= CAPACITY.MAX_GROUPS) {
          return { ok: false, reason: groupLimitCopy({ entries: total, groups: groups.length }) };
        }
        group = { id: `g-${newId()}`, name: DEFAULT_GROUP, sort: groups.length, entries: [] };
        groups.push(group);
      }
      const next: PersonalConfig = {
        ...config,
        groups: groups.map((g) =>
          g.id === group.id ? { ...g, entries: [...g.entries, { ...entry, sort: g.entries.length }] } : g,
        ),
      };
      await commit(next);
      return { ok: true };
    },
    [config, commit],
  );

  /** 整条替换（卡片「重编辑」的落盘口）：原 id 原位替换，选了别的组就迁过去（追加到组尾）。 */
  const updateEntryObject = useCallback(
    async (entry: Entry, groupId: string | null): Promise<{ ok: boolean; reason?: string }> => {
      const groups = clone(config).groups;
      let replaced = false;
      for (const g of groups) {
        const idx = g.entries.findIndex((e) => e.id === entry.id);
        if (idx < 0) continue;
        const target = groupId ? groups.find((x) => x.id === groupId) : undefined;
        if (target && target.id !== g.id) {
          g.entries.splice(idx, 1);
          target.entries.push({ ...entry, sort: target.entries.length });
        } else {
          g.entries[idx] = { ...entry, sort: idx };
        }
        replaced = true;
        break;
      }
      if (!replaced) return { ok: false, reason: '找不到要编辑的入口，可能已被删除' };
      const next = groups.map((g, k) => ({
        ...g,
        sort: k,
        entries: g.entries.map((e, i) => ({ ...e, sort: i })),
      }));
      await commit({ ...config, groups: next });
      return { ok: true };
    },
    [config, commit],
  );

  /** name 由「新建分组」对话框传入（同名与长度已在对话框校验）；不传时仍自动命名。 */
  const addGroup = useCallback(
    async (name?: string): Promise<{ ok: boolean; reason?: string }> => {
      if (config.groups.length >= CAPACITY.MAX_GROUPS) {
        return { ok: false, reason: groupLimitCopy(usage) };
      }
      const groups = clone(config).groups;
      const trimmed = (name ?? '').trim();
      groups.push({
        id: `g-${newId()}`,
        name: trimmed.length > 0 ? trimmed : `新分组 ${groups.length + 1}`,
        sort: groups.length,
        entries: [],
      });
      await commit({ ...config, groups });
      return { ok: true };
    },
    [config, commit, usage],
  );

  const renameGroup = useCallback(
    async (groupId: string, name: string) => {
      const groups = clone(config).groups.map((g) => (g.id === groupId ? { ...g, name } : g));
      await commit({ ...config, groups });
    },
    [config, commit],
  );

  const moveGroup = useCallback(
    async (groupId: string, delta: -1 | 1) => {
      const groups = clone(config).groups;
      const i = groups.findIndex((g) => g.id === groupId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= groups.length) return;
      [groups[i], groups[j]] = [groups[j], groups[i]];
      await commit({ ...config, groups: groups.map((g, k) => ({ ...g, sort: k })) });
    },
    [config, commit],
  );

  const sortGroupsByName = useCallback(
    async () => {
      const groups = clone(config).groups
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map((g, k) => ({ ...g, sort: k }));
      await commit({ ...config, groups });
    },
    [config, commit],
  );

  const removeGroup = useCallback(
    async (groupId: string) => {
      const groups = clone(config).groups
        .filter((g) => g.id !== groupId)
        .map((g, k) => ({ ...g, sort: k }));
      await commit({ ...config, groups });
    },
    [config, commit],
  );

  /* 单条与整块移动共用 shared/move-entries 的唯一实现（补偿索引这类细节只有一处）。 */
  const moveEntryToGroup = useCallback(
    async (entryId: string, toGroupId: string, toIndex?: number) => {
      const next = moveEntries(clone(config).groups, [entryId], toGroupId, toIndex);
      await commit({ ...config, groups: next });
    },
    [config, commit],
  );

  /** 辅助：把宿主的冲突清单映射成界面用的形状。 */
  const toItems = (list: Array<{ incomingId: string; incomingName: string; existingName: string; kind: 'id' | 'target' }>): ImportConflictItem[] =>
    list.map((c) => ({
      id: c.incomingId,
      name: c.incomingName,
      existingName: c.existingName,
      kind: c.kind,
    }));

  /**
   * 第二段：带逐项决定提交。`policy` 恒为 `ask` —— 不显式选过就不许覆盖（AC-15）。
   * 声明顺序必须在 beginImport 之前：beginImport 的依赖数组要读它。
   */
  const resolveImport = useCallback(
    async (choices: Record<string, ImportChoice>): Promise<ImportOutcome> => {
      const text = pendingText.current;
      if (text === null) return null;
      const outcome = await api.personal.commitImport(text, { policy: 'ask', perEntry: choices });
      if (outcome.kind === 'needs-decision') return { kind: 'conflict', conflicts: toItems(outcome.conflicts) };
      if (outcome.kind === 'error') {
        // 文件合法、无冲突，但合并后超限：预览过了、提交被拦，一个字节都没写。
        // 这里必须返回 error —— 若当成成功，用户会看到"导入成功"却什么都没变。
        pendingText.current = null;
        return { kind: 'error', error: outcome.reason, line: null };
      }
      pendingText.current = null;
      setConfig(api.personal.get());
      return { kind: 'applied', ...outcome.result };
    },
    [toItems],
  );

  /**
   * 第一段：预览。**只问宿主，不改任何数据**（AC-14）。
   * 无冲突时也不能自行落盘——容量闸只在提交侧，预览通过 ≠ 能写。
   */
  const beginImport = useCallback(
    async (text: string): Promise<ImportOutcome> => {
      const preview = await api.personal.previewImport(text, config);
      if (!preview.ok) {
        pendingText.current = null;
        return { kind: 'error', error: preview.reason, line: null };
      }
      pendingText.current = text;
      if (preview.preview.conflicts.length > 0) {
        return { kind: 'conflict', conflicts: toItems(preview.preview.conflicts) };
      }
      return await resolveImport({});
    },
    [config, resolveImport, toItems],
  );

  const value = useMemo<PersonalCtx>(
    () => ({
      config,
      usage,
      removeEntry,
      renameEntry,
      moveEntry,
      addCopy,
      addEntry,
      addEntries,
      addEntryObject,
      updateEntryObject,
      addGroup,
      renameGroup,
      moveGroup,
      removeGroup,
      moveEntryToGroup,
      moveEntriesToGroup,
      removeEntries,
      addCopies,
      sortGroupsByName,
      exportJson: () => api.personal.exportJson(),
      beginImport,
      resolveImport,
    }),
    [config, usage, removeEntry, removeEntries, renameEntry, moveEntry, addCopy, addCopies, addEntry, addEntries, addEntryObject, updateEntryObject, addGroup, renameGroup, moveGroup, removeGroup, moveEntryToGroup, moveEntriesToGroup, sortGroupsByName, beginImport, resolveImport],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePersonal(): PersonalCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePersonal 必须在 PersonalProvider 内使用');
  return v;
}
