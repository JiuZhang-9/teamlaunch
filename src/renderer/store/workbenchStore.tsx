/**
 * 工作区状态：Tab、搜索词、入口运行时状态（打开中/失败）、对话框路由。
 *
 * 两条容易被做错的规则在这里落实：
 *  - 切 Tab 必须清空搜索词（V-04 S10），但保留各自 Tab 的滚动位置；
 *  - 打开入口的结果由宿主判定，UI 不猜（K-06：禁止渲染期 stat 预检查）。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../bridge/index.ts';
import type { OpenFailure } from '../bridge/types.ts';
import type { Entry, EntryType } from '../../shared/schema/entry.ts';
import { useToasts } from './toastStore.tsx';
import { FAILURE_DETAIL, targetFull } from '../lib/entry.ts';

export type TabKey = 'home' | 'team' | 'personal';

export type DialogKey =
  | 'none'
  | 'settings'
  | 'publish'
  | 'feedback'
  | 'diagnostics'
  | 'adminUnlock'
  | 'privacy'
  | 'shortcuts'
  | 'announcements'
  | 'importResult';

/**
 * 设置对话框内的分区（左侧栏四页：通用/快捷键/高级/关于）。
 * 「关于」不再有独立对话框——标题栏版本号直接跳设置的这一页。
 */
export type SettingsSection = 'general' | 'hotkeys' | 'advanced' | 'about';

/**
 * 类型筛选：空数组 = 全部可见；非空 = 只显示所选类型。
 * 只影响可见性，不改组结构（组永远保留）；筛选生效期间拖拽禁用（索引对不上全量数组）。
 */
export type TypeFilter = EntryType[];

/** 入口编辑器的打开请求：create 带目标分组（null=自动）与作用域，edit 带原入口。
 *  prefill = 粘贴快捷添加的预填内容（与创建同一条确认链路，id 由确认时重新生成）。 */
export type EntryEditorRequest =
  | { mode: 'create'; groupId: string | null; scope: 'team' | 'personal'; prefill?: Entry }
  | { mode: 'edit'; entry: Entry; scope: 'team' | 'personal' };

export interface EntryRuntime {
  phase: 'idle' | 'opening' | 'failed';
  failure?: OpenFailure;
}

interface WorkbenchCtx {
  tab: TabKey;
  setTab(tab: TabKey): void;
  query: string;
  setQuery(q: string): void;
  runtime: Record<string, EntryRuntime>;
  openEntry(entry: Entry): Promise<void>;
  copyTarget(entry: Entry): Promise<void>;
  dialog: DialogKey;
  openDialog(d: DialogKey): void;
  closeDialog(): void;
  /** 设置对话框当前分区（会话内记住上次停留处；openSettings 可显式指定）。 */
  settingsSection: SettingsSection;
  /** 打开设置；传分区时直达对应页（标题栏版本号 → 关于，热键横幅 → 快捷键）。 */
  openSettings(section?: SettingsSection): void;
  feedbackTargetId: string | null;
  openFeedback(entryId: string): void;
  /** 应用入口的本机重新定位：选一次、本机记住、立刻再开（右键菜单常驻项）。 */
  relocateEntry(entry: Entry): Promise<void>;
  /** 入口编辑器（管理员草稿的新建/编辑对话框），带载荷所以独立于 dialog 键。 */
  entryEditor: EntryEditorRequest | null;
  openEntryEditor(req: EntryEditorRequest): void;
  closeEntryEditor(): void;
  /** 类型筛选（空 = 全部）。 */
  typeFilter: TypeFilter;
  toggleTypeFilter(t: EntryType): void;
  clearTypeFilter(): void;
  /** 多选连锁启动：selecting=多选模式；selected=按点击顺序的清单。 */
  selecting: boolean;
  selected: Entry[];
  toggleSelecting(): void;
  toggleSelected(entry: Entry): void;
  clearSelected(): void;
  exitSelecting(): void;
  launchChain(intervalMs: number): Promise<void>;
}

const Ctx = createContext<WorkbenchCtx | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [tab, setTabRaw] = useState<TabKey>('team');
  const [query, setQuery] = useState('');
  const [runtime, setRuntime] = useState<Record<string, EntryRuntime>>({});
  const [dialog, setDialog] = useState<DialogKey>('none');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [feedbackTargetId, setFeedbackTargetId] = useState<string | null>(null);
  const [entryEditor, setEntryEditor] = useState<EntryEditorRequest | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>([]);
  /** 多选连锁启动（2026-10-05）：selecting=多选模式；selected 按点击顺序排列=启动顺序。 */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Entry[]>([]);
  const { push } = useToasts();

  const toggleTypeFilter = useCallback((t: EntryType) => {
    setTypeFilter((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }, []);
  const clearTypeFilter = useCallback(() => setTypeFilter([]), []);

  const setTab = useCallback((next: TabKey) => {
    setTabRaw(next);
    setQuery('');
    setSelected([]);
    setSelecting(false);
  }, []);

  /** 在本机重新定位（分层解析第 5 步）：选一次、本机记住、立刻再开。取消不算失败、不提示。 */
  const relocateEntry = useCallback(
    async (entry: Entry) => {
      const r = await api.entries.relocate(entry);
      if (r.ok) {
        setRuntime((cur) => ({ ...cur, [entry.id]: { phase: 'idle' } }));
        push({ title: `已记住「${entry.name}」在这台电脑上的位置`, tone: 'success' });
        return;
      }
      if (r.reason === 'cancelled') return;
      push({ title: FAILURE_DETAIL[r.reason] ?? '没能完成重新定位', tone: 'danger' });
    },
    [push],
  );

  const openEntry = useCallback(
    async (entry: Entry) => {
      setRuntime((r) => ({ ...r, [entry.id]: { phase: 'opening' } }));
      // 直接按对象打开（主进程仍做 schema 校验）：团队已发布入口、个人入口、
      // 以及尚未发布的编辑态草稿都能开——此前草稿入口按 id 解析必然失败。
      const result = await api.entries.openObject(entry);
      if (result.ok) {
        setRuntime((r) => ({ ...r, [entry.id]: { phase: 'idle' } }));
        return;
      }
      setRuntime((r) => ({ ...r, [entry.id]: { phase: 'failed', failure: result.failure } }));
      // 应用类入口 = 装的位置跟管理员不一样是常态：给"本机重新定位"这个动作出口
      //（分层解析 2026-10-04）。只在"本机没找到"时出现，别的失败形态不给假选项。
      const canRelocate = entry.type === 'app' && result.failure === 'NOT_INSTALLED';
      push({
        title: `没能打开「${entry.name}」`,
        tone: 'danger',
        duration: 6000,
        actions: [
          ...(canRelocate
            ? [{ label: '在本机重新定位…', onSelect: () => void relocateEntry(entry) }]
            : []),
          { label: '查看诊断', onSelect: () => setDialog('diagnostics') },
          { label: '反馈给管理员', onSelect: () => setFeedbackTargetId(entry.id) },
        ],
      });
    },
    [push, relocateEntry],
  );

  const copyTarget = useCallback(
    async (entry: Entry) => {
      const ok = await api.entries.copyTarget(entry.id);
      if (!ok) {
        const fallback = await api.clipboard.write(targetFull(entry));
        if (!fallback) {
          push({ title: '没能写入剪贴板，请手动选择文本复制', tone: 'danger' });
          return;
        }
      }
      push({ title: entry.type === 'web' ? '链接已复制' : '路径已复制', tone: 'success' });
    },
    [push],
  );

  const openFeedback = useCallback((entryId: string) => setFeedbackTargetId(entryId), []);

  const toggleSelecting = useCallback(() => {
    setSelecting((v) => {
      if (v) setSelected([]);
      return !v;
    });
  }, []);
  /** 点击卡片：已在清单中则移出，否则按点击顺序追加。 */
  const toggleSelected = useCallback((entry: Entry) => {
    setSelected((list) =>
      list.some((e) => e.id === entry.id) ? list.filter((e) => e.id !== entry.id) : [...list, entry],
    );
  }, []);
  const clearSelected = useCallback(() => setSelected([]), []);
  const exitSelecting = useCallback(() => {
    setSelecting(false);
    setSelected([]);
  }, []);
  /**
   * 连锁启动：按清单顺序逐个打开，每步之间等待设置里的间隔；
   * 某一步失败 = 跳过并记录，最后一条警告汇总，绝不中断剩余步骤（用户定稿 2026-10-05）。
   */
  const launchChain = useCallback(
    async (intervalMs: number) => {
      const list = selected;
      exitSelecting();
      if (list.length === 0) return;
      const failed: string[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        setRuntime((r) => ({ ...r, [entry.id]: { phase: 'opening' } }));
        const result = await api.entries.openObject(entry);
        if (result.ok) {
          setRuntime((r) => ({ ...r, [entry.id]: { phase: 'idle' } }));
        } else {
          setRuntime((r) => ({ ...r, [entry.id]: { phase: 'failed', failure: result.failure } }));
          failed.push(entry.name);
        }
        if (i < list.length - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      if (failed.length > 0) {
        push({ title: `连锁启动完成，${failed.length} 项未能打开：${failed.join('、')}`, tone: 'warn', duration: 6000 });
      } else {
        push({ title: `连锁启动完成（共 ${list.length} 项）`, tone: 'success' });
      }
    },
    [selected, exitSelecting, push],
  );

  const openSettings = useCallback(
    (section?: SettingsSection) => {
      if (section) setSettingsSection(section);
      setDialog('settings');
    },
    [],
  );

  const openEntryEditor = useCallback((req: EntryEditorRequest) => setEntryEditor(req), []);
  const closeEntryEditor = useCallback(() => setEntryEditor(null), []);

  const value = useMemo<WorkbenchCtx>(
    () => ({
      tab,
      setTab,
      query,
      setQuery,
      runtime,
      openEntry,
      copyTarget,
      dialog,
      openDialog: setDialog,
      closeDialog: () => setDialog('none'),
      settingsSection,
      openSettings,
      feedbackTargetId,
      openFeedback,
      relocateEntry,
      entryEditor,
      openEntryEditor,
      closeEntryEditor,
      typeFilter,
      toggleTypeFilter,
      clearTypeFilter,
      selecting,
      selected,
      toggleSelecting,
      toggleSelected,
      clearSelected,
      exitSelecting,
      launchChain,
    }),
    [tab, setTab, query, runtime, openEntry, copyTarget, dialog, settingsSection, openSettings, feedbackTargetId, openFeedback, relocateEntry, entryEditor, openEntryEditor, closeEntryEditor, typeFilter, toggleTypeFilter, clearTypeFilter, selecting, selected, toggleSelecting, toggleSelected, clearSelected, exitSelecting, launchChain],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkbench(): WorkbenchCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkbench 必须在 WorkbenchProvider 内使用');
  return v;
}
