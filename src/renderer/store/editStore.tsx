/**
 * 管理员编辑态（V-05）：解锁、草稿、发布。
 *
 * 四重信号的"数据部分"在这里保证：
 *  - 发布中/失败一律保留草稿（只有服务端 200 才清空）；
 *  - 校验失败定位到具体入口与字段，不清空其他编辑（AC-07）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../bridge/index.ts';
import type { PublishError, PublishOutcome } from '../bridge/types.ts';
import type { TeamConfig } from '../../shared/schema/config.ts';
import { CAPACITY, SCHEMA_VERSION } from '../../shared/schema/common.ts';
import type { Entry } from '../../shared/schema/entry.ts';
import { entryLimitCopy, groupLimitCopy } from '../../shared/capacity-copy.ts';
import { measure } from '../../shared/capacity-usage.ts';
import { makeEntry, type NewEntryInput } from '../../shared/new-entry.ts';
import { moveEntries } from '../../shared/move-entries.ts';
import { useSync } from './syncStore.tsx';
import { useSettings } from './settingsStore.tsx';
import { useToasts } from './toastStore.tsx';
import { changeCount, diffTeamConfig, validateDraft, type ChangeSet } from '../lib/publish.ts';

export type PublishPhase = 'idle' | 'publishing';

/** 从零开始编辑时的空白底稿：instanceId 由主进程本机端口在发布时盖戳。 */
const EMPTY_CONFIG: TeamConfig = {
  schemaVersion: SCHEMA_VERSION,
  instanceId: '',
  revision: 0,
  contentHash: '',
  publishedAt: '',
  groups: [],
  announcements: [],
};

interface EditCtx {
  unlocked: boolean;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  editing: boolean;
  beginEdit(): void;
  requestExit(): boolean;
  exit(discard: boolean): void;
  draft: TeamConfig;
  published: TeamConfig | null;
  changes: ChangeSet;
  dirtyCount: number;
  issues: ReturnType<typeof validateDraft>;
  undo(): void;
  renameEntry(id: string, name: string): void;
  /** 整体保存一条入口（编辑器对话框的唯一写入口）：按 id 原位替换。 */
  saveEntry(next: Entry): void;
  /**
   * 跨分组移动（可带目标位置 index）：拖拽排序与跨组移动的唯一写入口。
   * 语义与个人页 moveEntryToGroup 一致：落点前移除、同组补偿、拖回原位无操作。
   */
  moveEntryToGroup(entryId: string, toGroupId: string, toIndex?: number): void;
  /** 多选整块移动（2026-10-17 批 4）：一次 mutate＝一步撤销。 */
  moveEntriesToGroup(entryIds: string[], toGroupId: string, toIndex?: number): void;
  /** 新建入口落到指定分组；分组不存在时自动建一个默认分组（首跑空草稿的关键路径）。
      入口数撞上限时拒绝并给出原因（此前没有守卫：草稿能超到发布时才被 413 拦）。 */
  createEntry(groupId: string | null, entry: Entry): { ok: boolean; reason?: string };
  /** 批量新增（批量添加对话框的团队版）：**一次 mutate = 一步撤销**，放不下的那部分停下并报原因。 */
  createEntries(inputs: NewEntryInput[], groupName?: string): { ok: boolean; added: number; reason?: string };
  removeEntry(id: string): void;
  moveEntry(id: string, delta: -1 | 1): void;
  addGroup(name?: string): { ok: boolean; reason?: string };
  /** 主页公告（2026-10-05）：编辑态草稿内增删改/排序，走既有发布流程。 */
  addAnnouncement(): string;
  updateAnnouncement(id: string, patch: { title?: string; body?: string; backgroundImageUrl?: string | null }): void;
  removeAnnouncement(id: string): void;
  moveAnnouncement(id: string, delta: -1 | 1): void;
  renameGroup(groupId: string, name: string): void;
  /** 分组整体换序；已到边界时不动（不是循环移动）。 */
  moveGroup(groupId: string, delta: -1 | 1): void;
  /** 删除分组会连带删掉组内入口，调用方必须先让用户确认。 */
  removeGroup(groupId: string): void;
  /** 批量删除分组（侧栏分组多选，2026-10-18）：一次 mutate = 一步撤销。 */
  removeGroups(groupIds: string[]): void;
  /** 按名称重排本组入口（2026-10-18 用户要求加进分组菜单）：一次 mutate = 一步撤销。 */
  sortEntriesInGroup(groupId: string): void;
  phase: PublishPhase;
  lastError: PublishError | null;
  publish(summary: string): Promise<PublishOutcome>;
}

const Ctx = createContext<EditCtx | null>(null);

const clone = (c: TeamConfig): TeamConfig => JSON.parse(JSON.stringify(c)) as TeamConfig;

export function EditProvider({ children }: { children: ReactNode }) {
  const { snapshot } = useSync();
  const { settings } = useSettings();
  const { push } = useToasts();
  const published = snapshot.config;
  const [unlocked, setUnlocked] = useState(api.settings.get().role === 'admin');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeamConfig | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<TeamConfig | null>(null);
  const [phase, setPhase] = useState<PublishPhase>('idle');
  const [lastError, setLastError] = useState<PublishError | null>(null);
  /** Toast 的最新引用：闲置计时器只该被"用户活动"重置，不能被无关重渲染（同步广播每 30s 一次）重置。 */
  const pushRef = useRef(push);
  pushRef.current = push;

  /**
   * R23 的 editStore 分支（2026-10-30）：首帧同步读 preload 缓存时，预热可能还没完成，
   * `api.settings.get().role` 还是默认 member，`unlocked` 会被初始化成 false；随后
   * settings 预热成 admin，但这里不会自己补回来——表现就是"点编辑模式突然要口令"。
   * 预热完成后按真实角色补一次，且只补一次：之后 idle lock 清掉的 unlocked
   * 不能被这条 effect 又解回去。
   */
  const initialRoleApplied = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void api.ready.then(() => {
      if (cancelled || initialRoleApplied.current) return;
      initialRoleApplied.current = true;
      setUnlocked(api.settings.get().role === 'admin');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 关闭管理员模式 = 编辑会话立即回收：解锁态、编辑态、草稿全部清空。
      此前只停了本机服务，界面上的编辑能力原样保留——开关形同虚设。 */
  useEffect(() => {
    if (settings.role === 'admin') return;
    setUnlocked(false);
    setEditing(false);
    setDraft(null);
    setUndoSnapshot(null);
  }, [settings.role]);

  /**
   * 锁定会话：清解锁态 + 退出编辑，**草稿保留在内存**。
   *
   * 只回收本机会话，不动 role——角色是"这台机器是不是管理员机"（设置开关管），
   * 会话是"当前有没有编辑权限"。（此前 lock() 顺手把 role 改回 member，
   * 会把关闭服务的重活和退出编辑混在一件事里。）
   *
   * 保留草稿是有意的：这个函数现在是 ADR-006「闲置自动清除解锁态」的落点，
   * 而闲置退出不该把管理员十来分钟的编辑一笔勾销——重新解锁后 beginEdit 会复用这份草稿。
   */
  const lock = useCallback(() => {
    setUnlocked(false);
    setEditing(false);
  }, []);

  /**
   * 闲置自动退出编辑（PRD §14.1 / ADR-006）。
   *
   * 三条约定：
   *  - 只在**编辑态内**计时：打开应用但没进编辑不算闲置——否则管理员机一启动就可能被"锁上"，
   *    点开编辑还要先设口令，纯属给日常添堵；
   *  - 窗口内的键盘 / 指针 / 滚轮活动都会重置计时；
   *  - 超时后按本机**是否设置过口令**分流（用户拍板的折中）：设过口令 = 有要保护的边界，
   *    清解锁态（回只读、重新进入要口令）；没设过口令 = 没有边界，只退出编辑，
   *    不制造"强制设口令"的流程。
   * 无论哪种，草稿都保留在内存（＝ exit(false) 的语义），不丢工作。
   */
  useEffect(() => {
    if (!editing) return;
    const timeoutMs = Math.max(30_000, settings.editIdleTimeoutMs);
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void (async () => {
          let enrolled = false;
          try {
            enrolled = (await api.admin.status()).enrolled;
          } catch {
            // 问不到就按"没设过口令"处理：宁可不锁，也不能把管理员挡在编辑之外
          }
          if (enrolled) lock();
          else setEditing(false);
          pushRef.current({
            title: enrolled
              ? '闲置过久，已退出并锁定编辑模式。未发布的改动保留在本机，重新解锁可继续。'
              : '闲置过久，已退出编辑模式。未发布的改动保留在本机，点「编辑模式」可继续。',
            tone: 'info',
            duration: 6000,
          });
        })();
      }, timeoutMs);
    };
    arm();
    window.addEventListener('keydown', arm, true);
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('wheel', arm, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', arm, true);
      window.removeEventListener('pointerdown', arm, true);
      window.removeEventListener('wheel', arm, true);
    };
  }, [editing, settings.editIdleTimeoutMs, lock]);

  const base = draft ?? published;
  const changes = useMemo(
    () => diffTeamConfig(published ?? EMPTY_CONFIG, base ?? EMPTY_CONFIG),
    [published, base],
  );
  const issues = useMemo(() => (base ? validateDraft(base) : []), [base]);

  const mutate = (fn: (c: TeamConfig) => TeamConfig) => {
    /* 草稿只允许在编辑态写入。此前没有任何守卫：只读团队页上点「上移一位 / 重命名 / 删除分组」
       会静默改草稿，而界面读的是已发布快照——表现是"可点但无效果"，并且改动会在
       下次 beginEdit 时被整份丢弃。UI 层已经禁用了那些入口，这里是绕不过去的兜底。 */
    if (!editing) return;
    const current = base ? clone(base) : clone(EMPTY_CONFIG);
    setUndoSnapshot(clone(current));
    setDraft(fn(current));
  };

  const value: EditCtx = {
    unlocked,
    async unlock(passphrase) {
      const r = await api.admin.unlock(passphrase);
      if (r.ok) {
        setUnlocked(true);
        await api.settings.patch({ role: 'admin' });
      }
      return r.ok;
    },
    lock,
    editing,
    /** 空草稿（从未发布过）也允许进入编辑——管理员首跑的必经之路，此前在这里被挡死。
        已有草稿（闲置退出保留的那份）直接复用：否则重新进入编辑会静默丢掉未发布的改动。 */
    beginEdit() {
      setDraft((cur) => cur ?? clone(published ?? EMPTY_CONFIG));
      setUndoSnapshot(null);
      setEditing(true);
      setLastError(null);
    },
    /** 有改动时返回 true，让调用方弹出「放弃未发布的改动？」确认框。 */
    requestExit() {
      return changeCount(changes) > 0;
    },
    exit(discard) {
      if (discard) setDraft(null);
      setEditing(false);
    },
    draft: base as TeamConfig,
    published,
    changes,
    dirtyCount: changeCount(changes),
    issues,
    undo() {
      if (!undoSnapshot) return;
      setDraft(undoSnapshot);
      setUndoSnapshot(null);
    },
    renameEntry(id, name) {
      mutate((c) => ({
        ...c,
        groups: c.groups.map((g) => ({
          ...g,
          entries: g.entries.map((e) => (e.id === id ? ({ ...e, name } as Entry) : e)),
        })),
      }));
    },
    /** 编辑器对话框的写入口：整条替换，类型切换（app/folder/web）也走这里。 */
    saveEntry(next) {
      mutate((c) => ({
        ...c,
        groups: c.groups.map((g) => ({
          ...g,
          entries: g.entries.map((e) => (e.id === next.id ? next : e)),
        })),
      }));
    },
    /** 拖拽落点：跨组移动 / 组内重排（个人页同款语义）。 */
    /* 单条与整块移动共用 shared/move-entries 的唯一实现（补偿索引只有一处）。 */
    moveEntryToGroup(entryId, toGroupId, toIndex) {
      mutate((c) => ({ ...c, groups: moveEntries(c.groups, [entryId], toGroupId, toIndex) }));
    },
    /** 多选整块移动（拖拽整块 / 批量菜单）：一次 mutate = 一步撤销。 */
    moveEntriesToGroup(entryIds, toGroupId, toIndex) {
      mutate((c) => ({ ...c, groups: moveEntries(c.groups, entryIds, toGroupId, toIndex) }));
    },
    /**
     * 新建入口落到指定分组；groupId 为空或不存在时依次回退：
     * 已有分组取第一个，完全没有分组则自动建「其他」（PRD 5.1：未分组入口进「其他」组）。
     */
    createEntry(groupId, entry) {
      /* 容量真守卫（前置禁用只是提示）：入口数到顶时直接拒绝，别拖到发布才 413。 */
      const usage = measure(base ?? EMPTY_CONFIG);
      if (usage.entries >= CAPACITY.MAX_ENTRIES) {
        return { ok: false, reason: entryLimitCopy(usage) };
      }
      mutate((c) => {
        let groups = c.groups;
        let target = groups.find((g) => g.id === groupId);
        if (!target) {
          if (groups.length > 0) {
            target = groups[0];
          } else {
            target = { id: `g-new-${Date.now()}`, name: '其他', sort: 0, entries: [] };
            groups = [...groups, target];
          }
        }
        const t = target;
        return {
          ...c,
          // 追加到组尾：sort 以组内实际位置为准，不信任对话框带来的占位值。
          groups: groups.map((g) =>
            g.id === t.id ? { ...g, entries: [...g.entries, { ...entry, sort: g.entries.length }] } : g,
          ),
        };
      });
      return { ok: true };
    },
    /**
     * 批量新增（团队版「批量添加」）：**一次 mutate = 一步撤销**。
     * 逐条调 createEntry 会让撤销只能回退最后一条（每次 mutate 都覆盖 undoSnapshot），
     * 所以这里在 mutate 之外先把整批算完，放不下的部分停下并如实回报。
     */
    createEntries(inputs, groupName) {
      const usageNow = measure(base ?? EMPTY_CONFIG);
      if (usageNow.entries >= CAPACITY.MAX_ENTRIES) {
        return { ok: false, added: 0, reason: entryLimitCopy(usageNow) };
      }
      /* 在草稿的浅拷贝上算完整批：命中上限就停在"放得下的那几条"，与个人页 addEntries 同语义。 */
      const groups = (base ?? EMPTY_CONFIG).groups.map((g) => ({ ...g, entries: [...g.entries] }));
      let total = groups.reduce((n, g) => n + g.entries.length, 0);
      const wanted = (groupName ?? '').trim() || groups[0]?.name || '其他';
      let added = 0;
      let reason: string | undefined;
      for (const input of inputs) {
        let group = groups.find((g) => g.name === wanted);
        if (!group) {
          if (groups.length >= CAPACITY.MAX_GROUPS) {
            reason = groupLimitCopy({ groups: groups.length, entries: total });
            break;
          }
          group = { id: `g-new-${Date.now()}`, name: wanted, sort: groups.length, entries: [] };
          groups.push(group);
        }
        if (total >= CAPACITY.MAX_ENTRIES) {
          reason = entryLimitCopy({ groups: groups.length, entries: total });
          break;
        }
        group.entries.push(
          makeEntry(input, group.entries.length, `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, new Date().toISOString()),
        );
        total += 1;
        added += 1;
      }
      /* added === 0 时不写草稿：不留一个"纯回退"的撤销步。 */
      if (added > 0) {
        const nextGroups = groups;
        mutate((c) => ({ ...c, groups: nextGroups }));
      }
      return { ok: reason === undefined, added, reason };
    },
    removeEntry(id) {
      mutate((c) => ({
        ...c,
        groups: c.groups.map((g) => ({
          ...g,
          entries: g.entries.filter((e) => e.id !== id),
        })),
      }));
    },
    moveEntry(id, delta) {
      mutate((c) => ({
        ...c,
        groups: c.groups.map((g) => {
          const i = g.entries.findIndex((e) => e.id === id);
          if (i < 0) return g;
          const j = i + delta;
          if (j < 0 || j >= g.entries.length) return g;
          const entries = [...g.entries];
          [entries[i], entries[j]] = [entries[j], entries[i]];
          return { ...g, entries: entries.map((e, k) => ({ ...e, sort: k })) };
        }),
      }));
    },
    addAnnouncement(): string {
      const id = `a-new-${Date.now()}`;
      mutate((c) => ({
        ...c,
        announcements: [
          ...c.announcements,
          { id, title: '新公告', body: '', backgroundImageUrl: null, createdAt: new Date().toISOString() },
        ],
      }));
      return id;
    },
    updateAnnouncement(id: string, patch: { title?: string; body?: string; backgroundImageUrl?: string | null }) {
      mutate((c) => ({
        ...c,
        announcements: c.announcements.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    removeAnnouncement(id: string) {
      mutate((c) => ({
        ...c,
        announcements: c.announcements.filter((a) => a.id !== id),
      }));
    },
    moveAnnouncement(id: string, delta: -1 | 1) {
      mutate((c) => {
        const i = c.announcements.findIndex((a) => a.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= c.announcements.length) return c;
        const list = [...c.announcements];
        [list[i], list[j]] = [list[j], list[i]];
        return { ...c, announcements: list };
      });
    },
    addGroup(name) {
      /* 容量真守卫（同 createEntry）：分组数到顶就拒绝并说明，别等发布才被拦。 */
      const usage = measure(base ?? EMPTY_CONFIG);
      if (usage.groups >= CAPACITY.MAX_GROUPS) {
        return { ok: false, reason: groupLimitCopy(usage) };
      }
      const trimmed = (name ?? '').trim();
      mutate((c) => ({
        ...c,
        groups: [
          ...c.groups,
          {
            id: `g-new-${Date.now()}`,
            name: trimmed.length > 0 ? trimmed : `新分组 ${c.groups.length + 1}`,
            sort: c.groups.length,
            entries: [],
          },
        ],
      }));
      return { ok: true };
    },

    /**
     * 分组三操作：此前 editStore 只有入口级操作，分组的「重命名 / 移动 / 删除」完全没实现，
     * 界面上那个"..."按钮只能弹一句"尚未开放"。这里补齐（P0-09 可视化编辑）。
     */
    renameGroup(groupId, name) {
      mutate((c) => ({
        ...c,
        groups: c.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
      }));
    },
    moveGroup(groupId, delta) {
      mutate((c) => {
        const i = c.groups.findIndex((g) => g.id === groupId);
        if (i < 0) return c;
        const j = i + delta;
        if (j < 0 || j >= c.groups.length) return c;
        const groups = [...c.groups];
        [groups[i], groups[j]] = [groups[j], groups[i]];
        return { ...c, groups: groups.map((g, k) => ({ ...g, sort: k })) };
      });
    },
    /** 删分组会连带删掉组内所有入口，必须先在界面上确认（不是静默执行）。 */
    removeGroup(groupId) {
      mutate((c) => ({
        ...c,
        groups: c.groups.filter((g) => g.id !== groupId).map((g, k) => ({ ...g, sort: k })),
      }));
    },
    /** 批量删分组（侧栏分组多选）：一次 mutate = 一步撤销（与批量删入口同一纪律）。 */
    removeGroups(groupIds) {
      const gone = new Set(groupIds);
      mutate((c) => ({
        ...c,
        groups: c.groups.filter((g) => !gone.has(g.id)).map((g, k) => ({ ...g, sort: k })),
      }));
    },
    /* 按名称重排本组入口（2026-10-18）：分组菜单里的"整理"动作，一次 mutate = 一步撤销。 */
    sortEntriesInGroup(groupId) {
      mutate((c) => ({
        ...c,
        groups: c.groups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                entries: [...g.entries]
                  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
                  .map((e, k) => ({ ...e, sort: k })),
              }
            : g,
        ),
      }));
    },
    phase,
    lastError,
    async publish(summary) {
      const config = draft ?? published;
      if (!config) return { ok: false, error: 'NETWORK_UNREACHABLE' };
      setPhase('publishing');
      setLastError(null);
      // 发布必须把完整草稿和它基于的版本一起上送：服务端按 baseRevision 做乐观并发、
      // 按草稿生成新版本。此前这里只送 summary，服务端拿不到配置，发布从未成功过。
      const outcome = await api.publish.put({ summary, config, baseRevision: published?.revision ?? 0 });
      setPhase('idle');
      if (outcome.ok) {
        setDraft(null);
        setUndoSnapshot(null);
        setEditing(false);
        return { ok: true, revision: outcome.revision, changedCount: outcome.changedCount };
      }
      setLastError(outcome.error);
      return { ok: false, error: outcome.error };
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEdit(): EditCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEdit 必须在 EditProvider 内使用');
  return v;
}
