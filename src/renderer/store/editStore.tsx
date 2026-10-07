/**
 * 管理员编辑态（V-05）：解锁、草稿、发布。
 *
 * 四重信号的"数据部分"在这里保证：
 *  - 发布中/失败一律保留草稿（只有服务端 200 才清空）；
 *  - 校验失败定位到具体入口与字段，不清空其他编辑（AC-07）。
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../bridge/index.ts';
import type { PublishError, PublishOutcome } from '../bridge/types.ts';
import type { TeamConfig } from '../../shared/schema/config.ts';
import { SCHEMA_VERSION } from '../../shared/schema/common.ts';
import type { Entry } from '../../shared/schema/entry.ts';
import { useSync } from './syncStore.tsx';
import { useSettings } from './settingsStore.tsx';
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
  /** 新建入口落到指定分组；分组不存在时自动建一个默认分组（首跑空草稿的关键路径）。 */
  createEntry(groupId: string | null, entry: Entry): void;
  removeEntry(id: string): void;
  moveEntry(id: string, delta: -1 | 1): void;
  addGroup(): void;
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
  phase: PublishPhase;
  lastError: PublishError | null;
  publish(summary: string): Promise<PublishOutcome>;
}

const Ctx = createContext<EditCtx | null>(null);

const clone = (c: TeamConfig): TeamConfig => JSON.parse(JSON.stringify(c)) as TeamConfig;

export function EditProvider({ children }: { children: ReactNode }) {
  const { snapshot } = useSync();
  const { settings } = useSettings();
  const published = snapshot.config;
  const [unlocked, setUnlocked] = useState(api.settings.get().role === 'admin');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TeamConfig | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<TeamConfig | null>(null);
  const [phase, setPhase] = useState<PublishPhase>('idle');
  const [lastError, setLastError] = useState<PublishError | null>(null);

  /** 关闭管理员模式 = 编辑会话立即回收：解锁态、编辑态、草稿全部清空。
      此前只停了本机服务，界面上的编辑能力原样保留——开关形同虚设。 */
  useEffect(() => {
    if (settings.role === 'admin') return;
    setUnlocked(false);
    setEditing(false);
    setDraft(null);
    setUndoSnapshot(null);
  }, [settings.role]);

  const base = draft ?? published;
  const changes = useMemo(
    () => diffTeamConfig(published ?? EMPTY_CONFIG, base ?? EMPTY_CONFIG),
    [published, base],
  );
  const issues = useMemo(() => (base ? validateDraft(base) : []), [base]);

  const mutate = (fn: (c: TeamConfig) => TeamConfig) => {
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
    lock() {
      // 只回收本机会话，不动 role——角色是"这台机器是不是管理员机"（设置开关管），
      // 会话是"当前有没有编辑权限"。此前 lock() 顺手把 role 改回 member，
      // 会把关闭服务的重活和退出编辑混在一件事里。
      setUnlocked(false);
      setEditing(false);
      setDraft(null);
    },
    editing,
    /** 空草稿（从未发布过）也允许进入编辑——管理员首跑的必经之路，此前在这里被挡死。 */
    beginEdit() {
      setDraft(clone(published ?? EMPTY_CONFIG));
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
    moveEntryToGroup(entryId, toGroupId, toIndex) {
      mutate((c) => {
        const groups = clone(c).groups;
        let moved: Entry | null = null;
        let fromIndex = -1;
        let fromGroupId: string | null = null;
        for (const g of groups) {
          const idx = g.entries.findIndex((e) => e.id === entryId);
          if (idx >= 0) {
            moved = g.entries.splice(idx, 1)[0];
            fromIndex = idx;
            fromGroupId = g.id;
            break;
          }
        }
        const target = groups.find((g) => g.id === toGroupId);
        if (!moved || !target) return c;

        const sameGroup = fromGroupId === toGroupId;
        let insertAt = toIndex ?? target.entries.length;
        if (sameGroup) {
          if (insertAt === fromIndex) return c;
          if (insertAt > fromIndex) insertAt -= 1;
        }
        insertAt = Math.max(0, Math.min(insertAt, target.entries.length));
        target.entries.splice(insertAt, 0, moved);
        return {
          ...c,
          groups: groups.map((g, k) => ({
            ...g,
            sort: k,
            entries: g.entries.map((e, i) => ({ ...e, sort: i })),
          })),
        };
      });
    },
    /**
     * 新建入口落到指定分组；groupId 为空或不存在时依次回退：
     * 已有分组取第一个，完全没有分组则自动建「其他」（PRD 5.1：未分组入口进「其他」组）。
     */
    createEntry(groupId, entry) {
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
    addGroup() {
      mutate((c) => ({
        ...c,
        groups: [
          ...c.groups,
          {
            id: `g-new-${Date.now()}`,
            name: `新分组 ${c.groups.length + 1}`,
            sort: c.groups.length,
            entries: [],
          },
        ],
      }));
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
