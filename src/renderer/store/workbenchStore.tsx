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
import { readMemoryString, writeMemoryString } from '../lib/localMemory.ts';
import { pushRecentOpen } from '../lib/recentOpens.ts';

export type TabKey = 'home' | 'team' | 'personal';

/** 上次所在页（本机记忆，不跨机同步、不进 settings）。默认团队入口。 */
const LAST_TAB_KEY = 'lastTab';
const DEFAULT_TAB: TabKey = 'team';
const TAB_KEYS: TabKey[] = ['home', 'team', 'personal'];

function readLastTab(): TabKey {
  const v = readMemoryString(LAST_TAB_KEY);
  return v !== null && (TAB_KEYS as string[]).includes(v) ? (v as TabKey) : DEFAULT_TAB;
}

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
  | 'importResult'
  /** 个人页的两个"批量"对话框：多行粘贴 / 扫描本机入口点。 */
  | 'batchAdd'
  | 'scanPicker';

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
  /** 多选批量复制：一次写入多行（每行一个目标）。 */
  copyManyTargets(entries: Entry[]): Promise<void>;
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
  /**
   * 一段文本（粘贴 / 快捷面板候选行）→ 识别 → 预填进与手动添加同一套编辑器。
   * 落点永远是「我的入口」：个人场景为主、行为可预期（PRD §8.4 最近使用是独立快捷区）。
   */
  quickAddFromText(text: string): Promise<void>;
  /** 类型筛选（空 = 全部）。 */
  typeFilter: TypeFilter;
  toggleTypeFilter(t: EntryType): void;
  clearTypeFilter(): void;
  /** 多选连锁启动：selecting=多选模式；selected=按点击顺序的清单。 */
  selecting: boolean;
  selected: Entry[];
  toggleSelecting(): void;
  toggleSelected(entry: Entry): void;
  /** 多选批量：整批加入清单（全选本组用），已在清单里的跳过。 */
  addSelected(list: Entry[]): void;
  clearSelected(): void;
  exitSelecting(): void;
  launchChain(intervalMs: number): Promise<void>;
}

const Ctx = createContext<WorkbenchCtx | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [tab, setTabRaw] = useState<TabKey>(readLastTab);
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
    /* 本机记忆：从哪一页关掉，下次打开就回到哪一页。只记在这台机器的浏览器存储里——
       不进 settings（那会广播给所有窗口、变成"可同步的偏好"），也不跨机同步，
       否则两台机器会互相顶掉对方的记忆。 */
    writeMemoryString(LAST_TAB_KEY, next);
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
        // 最近打开只记"真的打开了"的（面板空查询要显示它，失败的不算）。
        pushRecentOpen(entry.id);
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

  /** 多选批量复制：主进程逐个取目标、拼成多行后一次写入（循环调单条只会互相覆盖）。 */
  const copyManyTargets = useCallback(
    async (entries: Entry[]) => {
      if (entries.length === 0) return;
      const ok = await api.entries.copyMany(entries);
      push(
        ok
          ? { title: `已复制 ${entries.length} 项（每行一条）`, tone: 'success' }
          : { title: '没能写入剪贴板，请手动选择文本复制', tone: 'danger' },
      );
    },
    [push],
  );

  /** 多选批量：把一组入口追加进清单（已在清单里的跳过，保持现有顺序 = 启动顺序）。 */
  const addSelected = useCallback((list: Entry[]) => {
    setSelected((cur) => {
      const has = new Set(cur.map((e) => e.id));
      const add = list.filter((e) => !has.has(e.id));
      return add.length === 0 ? cur : [...cur, ...add];
    });
  }, []);

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

  /**
   * 粘贴快捷添加（方案 A）与面板「加为入口」的唯一实现：识别 → 预填 → 打开编辑器。
   * 此前这段逻辑长在 MainWindowShell 里（只服务 Ctrl+V），快捷面板够不着，
   * 面板只好另写一套——"同一件事两个实现"迟早分叉，所以上收到 store。
   * 识别失败只说清楚原因，绝不静默；落点仍是「我的入口」+ 新建编辑器（可改名字与分组）。
   */
  const quickAddFromText = useCallback(
    async (text: string) => {
      const identified = await api.entries.identify(text);
      if (identified.kind === 'none') {
        push({ title: identified.reason, tone: 'info' });
        return;
      }
      const now = new Date().toISOString();
      const prefill: Entry =
        identified.kind === 'web'
          ? {
              id: '', name: identified.name, type: 'web', url: identified.url,
              sort: 0, description: null, icon: { kind: 'fallback' }, iconAssetHash: null, updatedAt: now,
            }
          : identified.kind === 'app'
            ? {
                id: '', name: identified.name, type: 'app', target: identified.target,
                sourcePath: identified.sourcePath, args: identified.args ?? '', cwd: '', expandEnv: true,
                sort: 0, description: null, icon: { kind: 'local' }, iconAssetHash: null, updatedAt: now,
              }
            : {
                id: '', name: identified.name, type: 'folder', target: identified.target,
                sort: 0, description: null, icon: { kind: 'local' }, iconAssetHash: null, updatedAt: now,
              };
      setTab('personal');
      setEntryEditor({ mode: 'create', groupId: null, scope: 'personal', prefill });
    },
    [push, setTab],
  );

  const value = useMemo<WorkbenchCtx>(
    () => ({
      tab,
      setTab,
      query,
      setQuery,
      runtime,
      openEntry,
      copyTarget,
      copyManyTargets,
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
      quickAddFromText,
      typeFilter,
      toggleTypeFilter,
      clearTypeFilter,
      selecting,
      selected,
      toggleSelecting,
      toggleSelected,
      addSelected,
      clearSelected,
      exitSelecting,
      launchChain,
    }),
    [tab, setTab, query, runtime, openEntry, copyTarget, copyManyTargets, dialog, settingsSection, openSettings, feedbackTargetId, openFeedback, relocateEntry, entryEditor, openEntryEditor, closeEntryEditor, quickAddFromText, typeFilter, toggleTypeFilter, clearTypeFilter, selecting, selected, toggleSelecting, toggleSelected, addSelected, clearSelected, exitSelecting, launchChain],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkbench(): WorkbenchCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkbench 必须在 WorkbenchProvider 内使用');
  return v;
}
