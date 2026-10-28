/**
 * MainWindowShell —— TitleBar / Sidebar + ContentHeader / Banner / Content / EditActionBar 的装配，
 * 以及全局键位与对话框路由。
 *
 * 布局：顶部 40px 自定义标题栏（唯一 app-region: drag 区域）+ 下方横向分为
 * 「240px 侧栏 | 内容列」。内容区可用宽度 `1040 − 240 − 24×2 = 752`，
 * 卡片列数由 CardGrid 按宽度推导（4 列 ×176），不再依赖固定的 6 列整除链；
 * 配合覆盖式滚动条（atoms/ScrollArea，原生条宽度归零）才不会被滚动条挤掉一列（K-A）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, FileDown, FileUp, FolderPlus, Layers, LogOut, Pencil, Plus, ScanSearch, Undo2 } from 'lucide-react';

import { api } from '../../bridge/index.ts';
import { ScrollArea } from '../atoms/ScrollArea.tsx';
import { Banner } from '../molecules/Banner.tsx';
import { TitleBar } from './TitleBar.tsx';
import { ContentHeader } from './ContentHeader.tsx';
import { Sidebar, type SidebarMode } from './Sidebar.tsx';
import { GroupActionsDialog } from './GroupActionsDialog.tsx';
import { ConfirmDialog, RenameDialog } from './SimpleDialog.tsx';
import { EditActionBar } from './EditActionBar.tsx';
import { ChainLaunchBar } from './ChainLaunchBar.tsx';
import { DialogRouter } from './DialogRouter.tsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys.ts';
import { useMarqueeSelect } from '../../hooks/useMarqueeSelect.ts';
import { readMemoryList, writeMemoryList } from '../../lib/localMemory.ts';
import { useToolbarMenus } from '../../hooks/useToolbarMenus.ts';
import { entryLimitCopy, groupLimitCopy } from '../../../shared/capacity-copy.ts';
import { measure } from '../../../shared/capacity-usage.ts';
import { CAPACITY } from '../../../shared/schema/common.ts';
import { DEFAULT_APP_HOTKEYS, type HotkeyConflictInfo } from '../../../shared/app-hotkeys.ts';
import { useEntryIcons } from '../../hooks/useEntryIcons.ts';
import {
  MAX_WINDOW_PROGRAM_ROWS,
  MAX_WINDOW_ROWS,
  buildCandidates,
  buildHits,
  buildProgramHits,
  readClipboardCandidate,
  type ClipboardCandidate,
  type PaletteHit,
} from '../../lib/palette-source.ts';
import { usePrograms } from '../../lib/programs.ts';
import { usePinnedEntryIds } from '../../lib/pinnedEntries.ts';
import { useRecentOpenIds } from '../../lib/recentOpens.ts';
import { syncPresentation } from '../../services/syncCopy.ts';
import { useEdit } from '../../store/editStore.tsx';
import { useChains } from '../../store/chainStore.tsx';
import { usePersonal, type ImportOutcome } from '../../store/personalStore.tsx';
import { useSettings } from '../../store/settingsStore.tsx';
import { useSync } from '../../store/syncStore.tsx';
import { useToasts } from '../../store/toastStore.tsx';
import { useWorkbench } from '../../store/workbenchStore.tsx';
import { WindowSearchView } from '../../pages/WindowSearchView.tsx';
import { TeamEntriesView } from '../../pages/TeamEntriesView.tsx';
import { PersonalEntriesView } from '../../pages/PersonalEntriesView.tsx';
import { AdminEditView } from '../../pages/AdminEditView.tsx';
import { HomePageView } from '../../pages/HomePageView.tsx';
import type { Group } from '../../../shared/schema/group.ts';
import type { ToolbarAction } from '../../lib/toolbar-actions.ts';
import { updateStatusLine } from '../../../shared/update-copy.ts';

/** 本机记忆键：已提示过的公告 id（见 lib/localMemory.ts 的三条边界）。 */
const ANNOUNCEMENTS_SEEN_KEY = 'announcements-seen';

const OFFLINE_BANNER_STATES = new Set([
  'OFFLINE_CACHED',
  'OFFLINE_EMPTY',
  'SYNC_DATA_REJECTED',
  'SYNC_FAILED_UNKNOWN',
]);

export function MainWindowShell() {
  const { tab, setTab, setEditingLock, query, setQuery, runtime, openEntry, dialog, openDialog, closeDialog, feedbackTargetId, openEntryEditor, entryEditor, typeFilter, toggleTypeFilter, clearTypeFilter, openSettings, selecting, selected, toggleSelecting, addSelected, selectMany, clearSelected, exitSelecting, launchChain, quickAddFromText } =
    useWorkbench();
  const { snapshot, refresh } = useSync();
  const { settings, patch } = useSettings();
  const edit = useEdit();
  const { config: personal, usage, beginImport, addEntries: addPersonalEntries, addGroup: addPersonalGroup, renameGroup: personalRenameGroup, moveGroup: personalMoveGroup, removeGroup: personalRemoveGroup, removeGroups: personalRemoveGroups, sortGroupsByName: personalSortGroupsByName } = usePersonal();
  /** 连锁收藏（2026-10-19）：这里只用「保存」——主页负责展示与启动。 */
  const { chains, save: saveChain } = useChains();
  const { push } = useToasts();

  const [miniOpen, setMiniOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  /** 搜索框是否聚焦（1.4.0）：聚焦且未输入时显示固定 + 最近打开的快速打开面板。 */
  const [searchFocused, setSearchFocused] = useState(false);
  /** 搜索框聚焦时读一次的剪贴板候选（不持续监听）。 */
  const [clip, setClip] = useState<ClipboardCandidate | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [importOutcome, setImportOutcome] = useState<ImportOutcome>(null);
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);
  /**
   * 应用自更新（2026-10-18 改版）：有新版时不再顶部挂横幅，而是在工作区按钮上方的小窗里提示
   * ——小窗里有圆形下载进度；下载完成后那里长出「立即更新并重启」。
   * `updateSignal` 每次"该说一声"时自增，侧栏据此把弹层自动弹出来一次。
   */
  const [appUpdate, setAppUpdate] = useState<{ version: string; percent: number | null; ready: boolean } | null>(null);
  const [updateSignal, setUpdateSignal] = useState(0);
  const [updateChecking, setUpdateChecking] = useState(false);
  /** 热键注册状态只信主进程推送：此前这里写死 true + 按默认键名猜测，横幅常年说谎。 */
  const [hotkeyConflicts, setHotkeyConflicts] = useState<HotkeyConflictInfo[]>([]);
  const [locateId, setLocateId] = useState<string | null>(null);
  /** 侧栏分组右键触发的分组操作对话框（重命名/删除按当前页分发到对应 store）。 */
  const [sidebarGroup, setSidebarGroup] = useState<Group | null>(null);
  /** 分组多选批量删除的待确认清单（非空即弹确认框）。 */
  const [deleteGroups, setDeleteGroups] = useState<Group[] | null>(null);
  /** 「保存为连锁」的名称输入框（2026-10-19）：开着时把当前多选清单存成一条连锁。 */
  const [saveChainOpen, setSaveChainOpen] = useState(false);
  /** 刚发过"新公告"的系统通知：用户点它时把页面切到主页（2026-10-19）。
      用 ref 而不是 state：只在点击回调里读一次，不需要触发重渲染。 */
  const noticePendingRef = useRef(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastRevision = useRef(snapshot.revision);
  const scrollTop = useRef<Record<string, number>>({ team: 0, personal: 0 });

  const p = syncPresentation(snapshot);
  const debouncedQuery = useDebouncedValue(query, 120);
  const searching = debouncedQuery.trim().length > 0;
  const { editing, dirtyCount, unlocked, phase } = edit;

  /* 热键注册结果由主进程推送（注册失败每个键每次会话只报一次，见 hotkey.ts）。
     两个全局键分别记账：某一个冲突时，另一个仍然正常工作，界面不能一起判死。 */
  useEffect(() => {
    const addConflict = (info: HotkeyConflictInfo) => {
      setHotkeyConflicts((prev) =>
        prev.some((x) => x.accelerator === info.accelerator && x.kind === info.kind) ? prev : [...prev, info],
      );
    };
    const offConflict = api.events.onHotkeyConflict(addConflict);
    const offStatus = api.events.onHotkeyStatus((r) => {
      /* 'empty'（用户停用）不是失败：accelerator 为空时只清掉该键的旧冲突，
         不要给用户挂一条"热键没能注册"的横幅。 */
      if (r.registered || r.accelerator.length === 0) {
        setHotkeyConflicts((prev) => prev.filter((x) => x.kind !== r.kind));
      } else {
        addConflict({ accelerator: r.accelerator, kind: r.kind });
      }
    });
    return () => {
      offConflict();
      offStatus();
    };
  }, []);

  /* 自动更新：发现新版/下载完成都在工作区小窗里说（2026-10-18 用户要求），
     不再往内容区顶部塞横幅；每次"该说一声"自增 updateSignal 让侧栏把小窗弹出来一次。
     装与重启仍不自动做（主进程 autoInstallOnAppQuit=false）——用户不确认就不动他的机器。 */
  useEffect(() => {
    const off = api.events.onAppUpdate((event) => {
      if (event.type === 'available') {
        setAppUpdate({ version: event.version, percent: 0, ready: false });
        setUpdateSignal((n) => n + 1);
        return;
      }
      if (event.type === 'progress') {
        setAppUpdate((prev) => {
          const version = event.version || prev?.version || '';
          // 版本号都拿不到时不动状态：宁可不显示进度，也不显示"新版本 v"这种半截话。
          if (version === '') return prev;
          return { version, percent: event.percent, ready: false };
        });
        return;
      }
      setAppUpdate({ version: event.version, percent: 100, ready: true });
      setUpdateSignal((n) => n + 1);
    });
    return off;
  }, []);

  /* 启动时先捞一次状态：上次会话已下载好的更新不必等 30 秒后的周期检查才露面。
     刻意**不**在这条路径上自增 updateSignal——那会变成"每次开应用都弹一次小窗"。 */
  useEffect(() => {
    void api.updater
      .status()
      .then((s) => {
        if (s.availableVersion !== null) {
          setAppUpdate({ version: s.availableVersion, percent: s.downloadPercent, ready: s.readyToInstall });
        }
      })
      .catch(() => undefined);
  }, []);

  /** 小窗里的「检测版本更新」：跑完一轮用 toast 把结论说清楚（点了必须有回声）。 */
  const checkUpdate = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const s = await api.updater.check();
      setAppUpdate(
        s.availableVersion !== null
          ? { version: s.availableVersion, percent: s.downloadPercent, ready: s.readyToInstall }
          : null,
      );
      push({
        title: updateStatusLine(s),
        tone: s.lastError !== null || s.lastResult === 'unreachable' ? 'warn' : 'info',
        duration: 6000,
      });
    } catch {
      push({ title: '检查更新没能完成，可以稍后再试', tone: 'warn' });
    } finally {
      setUpdateChecking(false);
    }
  }, [push]);

  /** 小窗里的「立即更新并重启」：安装器起不来时必须当场说出来——点下去没反应是最糟的答案。 */
  const installUpdate = useCallback(async () => {
    try {
      const r = await api.updater.install();
      if (!r.ok) {
        push({ title: r.reason ?? '没能开始安装，可以稍后再试', tone: 'warn', duration: 8000 });
      }
    } catch {
      push({ title: '没能开始安装，详情见 logs\\main.log', tone: 'danger' });
    }
  }, [push]);

  const groups: Group[] = useMemo(() => {
    if (tab === 'home') return [];
    if (tab === 'personal') return personal.groups;
    if (editing) return edit.draft?.groups ?? [];
    return snapshot.config?.groups ?? [];
  }, [tab, personal.groups, editing, edit.draft, snapshot.config]);

  const entriesFlat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const icons = useEntryIcons(entriesFlat);

  /* ---------- 主窗口搜索（1.4.0）：与快捷窗口共用候选/打分/去重 ---------- */
  const programs = usePrograms();
  const pinnedIds = usePinnedEntryIds();
  const recentIds = useRecentOpenIds();
  /** 全部候选（团队 + 本机）：固定/最近/剪贴板去重用。团队侧用已发布配置，不用编辑草稿。 */
  const allCandidates = useMemo(
    () => buildCandidates(snapshot.config?.groups ?? [], personal.groups),
    [snapshot.config, personal.groups],
  );
  /** 入口查询只搜当前 Tab（沿用 V-04 纪律）；固定/最近/程序仍是全局。 */
  const searchCandidates = useMemo(
    () => allCandidates.filter((c) => (tab === 'personal' ? c.source === '本机' : c.source === '团队')),
    [allCandidates, tab],
  );
  const programHits = useMemo(
    () => buildProgramHits(programs, debouncedQuery, MAX_WINDOW_PROGRAM_ROWS),
    [programs, debouncedQuery],
  );
  const hits = useMemo(
    () =>
      buildHits({
        candidates: allCandidates,
        searchCandidates,
        clip,
        query: debouncedQuery,
        pinnedIds,
        recentIds,
        programHits,
        maxRows: MAX_WINDOW_ROWS,
      }),
    [allCandidates, searchCandidates, clip, debouncedQuery, pinnedIds, recentIds, programHits],
  );

  /* 搜索态：输入框聚焦（空查询 = 快速打开）或已有查询词；编辑态不参与搜索。 */
  const showSearch = !editing && (searching || searchFocused);
  const quickAccess = showSearch && !searching;

  /* 搜索结果的图标：当前 Tab 的卡片图标已有；固定/最近可能来自另一页，按命中补取。 */
  const searchHitEntries = useMemo(
    () => hits.filter((h) => h.kind !== 'clip-new').map((h) => h.entry),
    [hits],
  );
  const searchIcons = useEntryIcons(searchHitEntries, showSearch);
  const iconsForSearch = useMemo(() => ({ ...icons, ...searchIcons }), [icons, searchIcons]);

  useEffect(() => {
    if (searchIndex > hits.length - 1) setSearchIndex(0);
  }, [hits.length, searchIndex]);

  /* 软更新到达：只提示一次，不打断焦点（AC-08） */
  useEffect(() => {
    const prev = lastRevision.current;
    const now = snapshot.revision;
    if (prev != null && now != null && now > prev) setUpdateBanner(`团队入口已更新至 v${now}`);
    lastRevision.current = now;
  }, [snapshot.revision]);

  /* 隐私门未确认时，一律不打扰（零上报状态下也不弹业务提示）。声明提前到这里：
     下面的公告广播 effect 与粘贴处理都要用，而 effect 的依赖必须在它之前可见。 */
  const gateBlocking = settings.telemetryNoticeAckedAt === null;

  /* 搜索进入活跃态时读一次剪贴板（1.4.0）：不持续监听；隐私门未确认时不读。
     用 showSearch 而不是 searchFocused：查询词已经让搜索成立时（例如刚打开过编辑器、
     焦点状态被重置过），也应该补读一次；失焦且清空后关闭搜索再清空。 */
  useEffect(() => {
    if (!showSearch || gateBlocking) {
      setClip(null);
      return;
    }
    let cancelled = false;
    void readClipboardCandidate().then((c) => {
      if (!cancelled) setClip(c);
    });
    return () => {
      cancelled = true;
    };
  }, [showSearch, gateBlocking]);

  /* 切页 / 进出编辑时收起搜索态：输入框可能还留着焦点，但当前页已经换了。 */
  useEffect(() => {
    setSearchFocused(false);
  }, [tab, editing]);

  /** 关闭搜索：清空查询 + 失焦，回到当前页的卡片视图。 */
  const closeSearch = useCallback(() => {
    setQuery('');
    setSearchFocused(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [setQuery]);

  /* Ctrl+F 是开关：已打开就退出，否则聚焦（useGlobalHotkeys 只负责派发 tl:focus-search）。
     2026-10-27 用户反馈：原来只能切界面或点侧栏才能退出搜索，不顺手。 */
  useEffect(() => {
    const onToggle = () => {
      if (showSearch) closeSearch();
      else window.dispatchEvent(new Event('tl:focus-search-open'));
    };
    window.addEventListener('tl:focus-search', onToggle);
    return () => window.removeEventListener('tl:focus-search', onToggle);
  }, [showSearch, closeSearch]);

  /* 主窗口每次被显示（托盘 / 热键 / 任务栏还原）时默认聚焦搜索框：
     用页面可见性变化判断"窗口被打开"，比 window.focus 精确——切回一个本来就可见的窗口不抢焦点。
     首次挂载时页面已经是 visible（启动即显示），visibilitychange 不会再触发，补一次。 */
  useEffect(() => {
    const focusSearch = () => window.dispatchEvent(new Event('tl:focus-search-open'));
    const timer = document.visibilityState === 'visible' ? window.setTimeout(focusSearch, 0) : null;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') focusSearch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /* 点击搜索框 / 结果区以外的地方（顶栏、侧栏、工作栏按钮等）退出搜索。 */
  useEffect(() => {
    if (!showSearch) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-tl-search-surface]')) return;
      closeSearch();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [showSearch, closeSearch]);

  /* 主页公告广播（2026-10-17 用户要求"让所有人知晓"；2026-10-19 改为**系统通知**）：
     挑出"没提示过的公告"，走 Windows 系统 toast——应用在后台/最小化/被托盘藏着时也能看到，
     这是应用内 Toast 做不到的。每篇只提示一次（本机记 id、最多留 100 条）；
     关掉提示不影响公告本身——主页上一直看得到。首次装机的存量公告也会提示一次。
     点击通知：主进程把窗口拿到前台，这里再把页面切到主页。 */
  useEffect(() => {
    if (gateBlocking || !settings.announcementNotify) return;
    const list = snapshot.config?.announcements ?? [];
    if (list.length === 0) return;
    const seen = new Set(readMemoryList(ANNOUNCEMENTS_SEEN_KEY));
    const fresh = list.filter((a) => !seen.has(a.id));
    if (fresh.length === 0) return;
    for (const a of fresh) seen.add(a.id);
    writeMemoryList(ANNOUNCEMENTS_SEEN_KEY, [...seen]);
    const latest = fresh[fresh.length - 1];
    void api.notify.system({
      title: `新公告：${latest.title}`,
      body: latest.body.replace(/\s+/g, ' ').trim().slice(0, 120) || '点这里打开 TeamLaunch 查看',
    });
    noticePendingRef.current = true;
  }, [snapshot.config, settings.announcementNotify, gateBlocking]);

  /* 用户点了系统通知 → 把页面切到主页（公告在那儿）。没有待看公告时就只前台化。 */
  useEffect(
    () =>
      api.events.onNoticeClick(() => {
        if (!noticePendingRef.current) return;
        noticePendingRef.current = false;
        setTab('home');
      }),
    [setTab],
  );

  useEffect(() => {
    if (!updateBanner) return;
    const t = window.setTimeout(() => setUpdateBanner(null), 3000);
    return () => window.clearTimeout(t);
  }, [updateBanner]);

  /* 定位问题项：高亮 1.6s 后撤销（V-06 S2） */
  useEffect(() => {
    if (!locateId) return;
    const t = window.setTimeout(() => setLocateId(null), 1600);
    return () => window.clearTimeout(t);
  }, [locateId]);

  /* 编辑态锁同步进 store（2026-10-17）：页面切换与"打开设置/帮助"的所有入口都收口在
     workbenchStore（setTab / openDialog），把 editing 的真相交给它才能一处管全——
     Ctrl+E、侧栏页签、空状态按钮、粘贴强制跳个人页都不会漏。 */
  useEffect(() => {
    setEditingLock(editing);
  }, [editing, setEditingLock]);

  const toggleEdit = useCallback(() => {
    if (!unlocked) {
      openDialog('adminUnlock');
      return;
    }
    if (editing) {
      if (edit.requestExit()) setConfirmExit(true);
      else {
        edit.exit(true);
        push({ title: '已退出编辑模式', tone: 'info' });
      }
      return;
    }
    /* 编辑会话属于团队页：在「我的入口」上按快捷键进编辑时先把人带回团队页，
       否则会停在一个"正在编辑、页面却是个人页"的分裂状态（编辑态锁不允许切到个人页）。 */
    if (tab === 'personal') setTab('team');
    edit.beginEdit();
  }, [unlocked, editing, edit, openDialog, push, tab, setTab]);

  /** Ctrl+N：新建入口，行为跟随当前页。个人页直接开编辑器；
      团队页编辑态直接开；未编辑的管理员先进编辑模式；非管理员如实说明。 */
  const newEntryForCurrentTab = useCallback(() => {
    if (tab === 'personal') {
      openEntryEditor({ mode: 'create', groupId: null, scope: 'personal' });
      return;
    }
    if (editing) {
      openEntryEditor({ mode: 'create', groupId: null, scope: 'team' });
      return;
    }
    if (settings.role === 'admin') {
      toggleEdit();
      push({ title: '已进入编辑模式，再按 Ctrl+N 新建团队入口', tone: 'info' });
      return;
    }
    push({ title: '团队入口由管理员维护，本机未开启管理员模式', tone: 'info' });
  }, [tab, editing, settings.role, openEntryEditor, toggleEdit, push]);

  /** 主窗口搜索结果：系统程序直接开（不进最近打开），其余走既有 openEntry（含失败解释）。 */
  const handleSearchOpen = useCallback(
    (hit: PaletteHit) => {
      if (hit.kind === 'system') {
        void api.entries.openObject(hit.entry).then((r) => {
          if (!r.ok) {
            push({ title: `没能打开「${hit.entry.name}」，可能已被卸载或没有权限`, tone: 'danger', duration: 6000 });
          }
        });
        return;
      }
      void openEntry(hit.entry);
    },
    [openEntry, push],
  );

  /** 搜索结果里的「加为入口」：系统程序交 .lnk 路径，剪贴板新内容交原文，走粘贴添加同一条链路。 */
  const handleSearchAdd = useCallback(
    (hit: PaletteHit) => {
      const text =
        hit.kind === 'system'
          ? hit.entry.type === 'app'
            ? (hit.entry.sourcePath ?? hit.entry.target)
            : ''
          : (clip?.text ?? '');
      if (text.length === 0) return;
      void quickAddFromText(text);
    },
    [clip, quickAddFromText],
  );

  /** 应用内快捷键：内置默认 + 用户覆盖（settings.appHotkeys 只存改过的动作）。 */
  const appHotkeys = useMemo(() => ({ ...DEFAULT_APP_HOTKEYS, ...settings.appHotkeys }), [settings.appHotkeys]);

  /**
   * Ctrl+A 两级全选（2026-10-17 用户要求）：第一次全选**当前分组**、第二次全选**整页**、第三次**清空**。
   * 「当前分组」按按下时的滚动位置取（分组头 id 是 `tl-group-*`，用它们的视口位置判断最上方可见组），
   * 刻意不引入常驻 scroll-spy——这条键按下时才读一次 DOM。只作用于卡片页；编辑态与主页不参与。
   */
  const selectAllCards = useCallback(() => {
    if (tab === 'home' || editing || groups.length === 0) return;
    const scroller = document.querySelector(`#tl-panel-${tab} .tl-scroll`);
    let currentName: string | null = null;
    if (scroller !== null) {
      const top = scroller.getBoundingClientRect().top;
      for (const el of scroller.querySelectorAll('[id^="tl-group-"]')) {
        // 只认"已经在视口顶之上"的分组头；DOM 序遍历 → 最后一个即最上方的可见组。
        if (el.getBoundingClientRect().top - top <= 1) currentName = el.id.slice('tl-group-'.length);
      }
      if (currentName !== null) currentName = decodeURIComponent(currentName);
    }
    const current =
      (currentName === null ? undefined : groups.find((g) => g.name === currentName)) ?? groups[0];
    const ids = new Set(selected.map((e) => e.id));
    const groupDone = current.entries.length > 0 && current.entries.every((e) => ids.has(e.id));
    if (!groupDone) {
      addSelected(current.entries);
      return;
    }
    const all = groups.flatMap((g) => g.entries);
    if (all.length > 0 && !all.every((e) => ids.has(e.id))) {
      addSelected(all);
      return;
    }
    clearSelected();
  }, [tab, editing, groups, selected, addSelected, clearSelected]);

  /**
   * 框选多选（2026-10-18 用户要求）：在卡片区空白处拖出选框，松手即选中框住的卡片。
   * 空白区=面板容器本身（卡片、按钮、输入框上起手都不算，见 useMarqueeSelect）。
   * 编辑态也开放：那里同样需要"一次框一批"（整块拖拽/批量删除都用得上）。
   */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const marquee = useMarqueeSelect({
    containerRef: panelRef,
    enabled: tab !== 'home' && groups.length > 0,
    onSelect: (ids, additive) => {
      const byId = new Map(groups.flatMap((g) => g.entries).map((e) => [e.id, e]));
      const list = ids.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => e !== undefined);
      if (list.length === 0) return;
      selectMany(list, additive);
    },
    /* 单击空白处 = 取消（2026-10-19 用户要求）：清单非空时清空并退出多选，
       让"框选出来的那一批"和"多选模式"一起收掉；没选中时单击是纯粹的空操作。 */
    onEmptyClick: () => {
      if (selected.length === 0) return;
      exitSelecting();
    },
  });

  /* 快捷面板的「加为入口」：主进程收起面板后把文本转到这里，
     走与 Ctrl+V 粘贴添加完全同一条流程（识别与预填在 workbenchStore）。 */
  useEffect(() => api.events.onQuickAdd((text) => void quickAddFromText(text)), [quickAddFromText]);
  /* ---------------- 全局键位（键位表见 useGlobalHotkeys） ---------------- */
  useGlobalHotkeys({
    onTabTeam: () => setTab('team'),
    onTabPersonal: () => setTab('personal'),
    onRefresh: () => void refresh(),
    onToggleMini: () => setMiniOpen((v) => !v),
    /* Ctrl+Tab：主窗口 → 快捷面板（2026-10-21）。托盘开启时主进程会把本窗口藏到托盘，
       面板的 Ctrl+Tab 再把本窗口换回来——两面互换。 */
    onSwitchToPalette: () => {
      void api.palette.show().then((ok) => {
        if (!ok) push({ title: '没能打开快捷窗口，请稍后再试', tone: 'warn' });
      });
    },
    onOpenSettings: () => openSettings(),
    onToggleEdit: toggleEdit,
    onPublish: () => openDialog('publish'),
    onNewEntry: newEntryForCurrentTab,
    onToggleSidebar: () => void patch({ sidebarCollapsed: !settings.sidebarCollapsed }),
    onSelectAll: selectAllCards,
    onShowShortcuts: () => openDialog('shortcuts'),
    canPublish: () => editing && dirtyCount > 0,
    appHotkeys,
  });

  const { doExport } = useToolbarMenus();

  /**
   * 导入两段式：预览 →（有冲突就逐项问）→ 提交。
   * 只有 applied 才算成功；error 一律走对话框，绝不报"导入成功"。
   */
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const outcome = await beginImport(await file.text());
    if (outcome?.kind === 'applied') {
      push({ title: `已导入 ${outcome.added + outcome.copied + outcome.overwritten} 个入口`, tone: 'success' });
      return;
    }
    setImportOutcome(outcome);
  };

  /** 容量前置说明：撞上限时「添加」按钮禁用并把原因挂到 hover / 读屏上。 */
  /* 容量门控**按动作分**（2026-10-17 用户反馈：8 个分组时"添加入口 / 批量添加 / 扫描程序"
     也被一起禁掉，而它们加的是入口、与分组数无关，属过度拦截）：
     分组数只拦「新建分组」，入口数只拦"加入口"三件套。
     个人页看落盘配置，团队编辑态看**草稿**（口径同一套，数值各自算）。 */
  const draftUsage = useMemo(() => measure(edit.draft), [edit.draft]);
  const groupAddReason =
    tab === 'personal'
      ? (usage.atGroupLimit ? groupLimitCopy(usage) : null)
      : editing && draftUsage.groups >= CAPACITY.MAX_GROUPS
        ? groupLimitCopy(draftUsage)
        : null;
  const entryAddReason =
    tab === 'personal'
      ? (usage.atEntryLimit ? entryLimitCopy(usage) : null)
      : editing && draftUsage.entries >= CAPACITY.MAX_ENTRIES
        ? entryLimitCopy(draftUsage)
        : null;

  /* 新建分组对话框（个人页 / 团队编辑态共用一个"名称输入确认框"）。 */
  const [newGroupScope, setNewGroupScope] = useState<'personal' | 'team' | null>(null);
  const newGroupGroups = (scope: 'personal' | 'team') => (scope === 'personal' ? personal.groups : edit.draft.groups);
  const newGroupDefault =
    newGroupScope === null ? '' : `新分组 ${newGroupGroups(newGroupScope).length + 1}`;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, [contenteditable="true"]')) return;
      if (dialog !== 'none' || entryEditor || gateBlocking) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      void quickAddFromText(text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [dialog, entryEditor, gateBlocking, quickAddFromText]);

  /* ---------------- 拖拽添加（2026-10-19 用户要求） ----------------
     把桌面图标 / 文件夹 / 浏览器里的链接拖进窗口 → 识别 → 加进「我的入口」。
     2026-10-19 追加（用户："希望能直接拖到对应组"）：指针停在哪个分组区域上，就落进哪一组；
     没停在任何分组上则落进默认的「我的入口」。
     三条纪律：
      1. 只在"拖的是文件/链接"时接管（拖卡片排序是应用内的 HTML5 拖拽，dataTransfer 里没有 Files，
         由 CardGrid 自己处理，互不干扰）；
      2. 有对话框/编辑态/隐私门时不受理（与粘贴添加同一道闸）；
      3. 结果如实汇报：加了几条、哪几条认不出来（原因来自 identify，不猜）。 */
  const [dropActive, setDropActive] = useState(false);
  const [dropGroupName, setDropGroupName] = useState<string | null>(null);
  const dragDepth = useRef(0);
  /** 当前被高亮的分组 section（dragover 每帧换目标时先摘旧的）。 */
  const dropGroupElRef = useRef<HTMLElement | null>(null);

  /** 按指针位置找落点分组；只认个人页的分组（团队页的组是只读的，加不进去）。 */
  const groupUnderPointer = useCallback(
    (x: number, y: number): { name: string; el: HTMLElement } | null => {
      if (tab !== 'personal') return null;
      const el = document.elementFromPoint(x, y);
      const section = el instanceof Element ? el.closest<HTMLElement>('[data-tl-group-name]') : null;
      const name = section?.getAttribute('data-tl-group-name');
      if (!section || !name) return null;
      return { name, el: section };
    },
    [tab],
  );

  const markDropGroup = useCallback((next: HTMLElement | null) => {
    const prev = dropGroupElRef.current;
    if (prev !== null && prev !== next) prev.removeAttribute('data-tl-drop-target');
    if (next !== null) next.setAttribute('data-tl-drop-target', 'true');
    dropGroupElRef.current = next;
  }, []);

  const clearDropUi = useCallback(() => {
    dragDepth.current = 0;
    setDropActive(false);
    setDropGroupName(null);
    markDropGroup(null);
  }, [markDropGroup]);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      if (dialog !== 'none' || entryEditor || gateBlocking) return;
      dragDepth.current += 1;
      setDropActive(true);
    },
    [dialog, entryEditor, gateBlocking],
  );
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) clearDropUi();
  }, [clearDropUi]);

  const onDragOverShell = useCallback(
    (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const hit = groupUnderPointer(e.clientX, e.clientY);
      setDropGroupName(hit?.name ?? null);
      markDropGroup(hit?.el ?? null);
    },
    [groupUnderPointer, markDropGroup],
  );

  const onDropFiles = useCallback(
    (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes('Files') && !types.includes('text/uri-list')) return;
      e.preventDefault();
      /* 落点必须在清 UI **之前**算：清掉高亮不影响 elementFromPoint，但 dropGroupName 会被清空。 */
      const targetGroup = groupUnderPointer(e.clientX, e.clientY)?.name ?? null;
      clearDropUi();
      if (dialog !== 'none' || entryEditor || gateBlocking) return;

      const paths = Array.from(e.dataTransfer.files)
        .map((f) => api.files.pathFor(f))
        .filter((p) => p.length > 0);
      /* 从浏览器拖链接过来：dataTransfer 里是 uri-list 而不是文件。 */
      const uris = (e.dataTransfer.getData('text/uri-list') || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//i.test(s));
      const candidates = [...paths, ...uris];
      if (candidates.length === 0) return;

      void (async () => {
        const inputs: Array<{ kind: 'app' | 'folder' | 'web'; name: string; target: string; groupName?: string }> = [];
        const rejected: string[] = [];
        for (const raw of candidates) {
          const hit = await api.entries.identify(raw);
          if (hit.kind === 'none') {
            rejected.push(raw);
            continue;
          }
          if (hit.kind === 'web') inputs.push({ kind: 'web', name: hit.name, target: hit.url, groupName: targetGroup ?? undefined });
          else inputs.push({ kind: hit.kind, name: hit.name, target: hit.target, groupName: targetGroup ?? undefined });
        }
        if (inputs.length === 0) {
          push({
            title: candidates.length === 1 ? '拖进来的这个认不出来' : '拖进来的这些都不认识',
            detail: rejected.length > 0 ? `认不出的：${rejected.slice(0, 3).join('、')}${rejected.length > 3 ? ' 等' : ''}` : undefined,
            tone: 'warn',
          });
          return;
        }
        const res = await addPersonalEntries(inputs);
        if (res.added > 0) {
          void api.usage.bump({ kind: 'feature', key: 'dragAdd' });
          push({
            title: `已添加 ${res.added} 个入口到「${targetGroup ?? '我的入口'}」`,
            detail: rejected.length > 0 ? `另有 ${rejected.length} 个认不出来，已跳过` : res.reason,
            tone: 'success',
          });
          if (tab !== 'personal') setTab('personal');
          return;
        }
        push({ title: res.reason ?? '没能添加', tone: 'warn' });
      })();
    },
    [addPersonalEntries, clearDropUi, dialog, entryEditor, gateBlocking, groupUnderPointer, push, setTab, tab],
  );
  const contentBackground = editing ? 'var(--surface-editing)' : 'var(--bg-canvas)';
  /**
   * 批量删除分组（侧栏多选）。空组整批直接删——没有连带删除的入口，
   * 再弹一次"确认删除"只会挡路（2026-10-21 用户要求）；只要有组非空就必须先确认。
   */
  const removeGroupList = (list: Group[]) => {
    const ids = list.map((g) => g.id);
    if (edit.editing) edit.removeGroups(ids);
    else void personalRemoveGroups(ids);
    void api.usage.bump({ kind: 'feature', key: 'groupMultiSelect' });
    push({ title: `已删除 ${list.length} 个分组`, tone: 'info' });
  };
  const requestDeleteGroups = (list: Group[]) => {
    if (list.every((g) => g.entries.length === 0)) {
      removeGroupList(list);
      return;
    }
    setDeleteGroups(list);
  };
  /** 侧栏与内容头共用：编辑态只属于团队页，个人页永远是 personal，主页无操作区。 */
  const mode: SidebarMode = tab === 'home' ? 'home' : tab === 'personal' ? 'personal' : editing ? 'editing' : 'team';

  /**
   * 工作栏 / 工作区弹窗共用的操作列表（1.3.0）。
   * 两处用同一份数据：侧栏收起时点工作栏，展开时点左下工作区，动作与顺序不会分叉。
   * 顺序按使用频率排；放不下的由 ContentHeader 自动收进「更多」。
   * 编辑态额外保留「退出编辑」——原侧栏那块可点的"编辑模式"徽标搬走后，
   * 这里补回同一个出口（底部「放弃改动」与 Ctrl+Shift+E 仍在）。
   */
  const contentActions = useMemo<ToolbarAction[]>(() => {
    if (tab === 'home') return [];
    if (tab === 'personal') {
      return [
        { id: 'newEntry', label: '新建入口', icon: Plus, disabledReason: entryAddReason, onSelect: () => openEntryEditor({ mode: 'create', groupId: null, scope: 'personal' }) },
        { id: 'newGroup', label: '新建分组', icon: FolderPlus, disabledReason: groupAddReason, onSelect: () => setNewGroupScope('personal') },
        { id: 'batchAdd', label: '批量添加', icon: Layers, disabledReason: entryAddReason, onSelect: () => openDialog('batchAdd') },
        { id: 'scan', label: '扫描程序', icon: ScanSearch, disabledReason: entryAddReason, onSelect: () => openDialog('scanPicker') },
        { id: 'bookmarks', label: '导入书签', icon: Bookmark, disabledReason: entryAddReason, onSelect: () => openDialog('bookmarks') },
        { id: 'import', label: '导入设置', icon: FileUp, onSelect: () => fileRef.current?.click() },
        { id: 'export', label: '导出设置', icon: FileDown, onSelect: () => void doExport() },
      ];
    }
    if (editing) {
      return [
        { id: 'undo', label: '撤销', icon: Undo2, onSelect: () => edit.undo() },
        { id: 'newEntry', label: '新建入口', icon: Plus, disabledReason: entryAddReason, onSelect: () => openEntryEditor({ mode: 'create', groupId: null, scope: 'team' }) },
        { id: 'newGroup', label: '新建分组', icon: FolderPlus, disabledReason: groupAddReason, onSelect: () => setNewGroupScope('team') },
        { id: 'batchAdd', label: '批量添加', icon: Layers, disabledReason: entryAddReason, onSelect: () => openDialog('batchAddTeam') },
        { id: 'exitEdit', label: '退出编辑', icon: LogOut, onSelect: toggleEdit },
      ];
    }
    if (settings.role === 'admin') {
      return [{ id: 'editMode', label: '编辑模式', icon: Pencil, onSelect: toggleEdit }];
    }
    return [];
  }, [tab, editing, settings.role, entryAddReason, groupAddReason, openEntryEditor, openDialog, edit, doExport, toggleEdit]);

  /** 侧栏分组对话框的换序边界：按真实索引算（此前硬编码 true，边界上点了不动）。 */
  const sidebarGroupIdx = sidebarGroup ? groups.findIndex((g) => g.id === sidebarGroup.id) : -1;

  return (
    <div
      className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      /* 拖拽添加（2026-10-19）：拖文件进来时显示投放提示；应用内卡片拖拽没有 Files 类型，不受影响。 */
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOverShell}
      onDrop={onDropFiles}
    >
      <TitleBar
        closeDisabled={gateBlocking}
        collapsed={settings.sidebarCollapsed}
        onToggleSidebar={() => void patch({ sidebarCollapsed: !settings.sidebarCollapsed })}
        onOpenAbout={() => openSettings('about')}
        onOpenHelp={() => openDialog('shortcuts')}
        teamRevision={snapshot.revision}
        update={appUpdate}
        onInstallUpdate={() => void installUpdate()}
        onCheckUpdate={() => void checkUpdate()}
        updateChecking={updateChecking}
      />

      {/* 侧栏化：顶栏只留 40px 拖拽条，导航与主操作进左侧栏，内容区独占剩余横向空间。 */}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          tab={tab}
          /* 模式跟随当前 Tab：编辑态的撤销/新建按钮只属于团队页。
             此前 editing 优先于 tab，切到"我的入口"也显示团队编辑按钮、动作也落在团队草稿上。 */
          mode={mode}
          groups={groups}
          snapshot={tab === 'personal' ? null : snapshot}
          onTabChange={setTab}
          onOpenSettings={() => openSettings()}
          onOpenDiagnostics={() => openDialog('diagnostics')}
          onRefresh={() => void refresh()}
          onGroupAction={(group, action) => {
            /* sortByName 只在个人页出现：全局粗排序，接替原「更多操作」菜单的职责。 */
            if (action === 'sortByName') {
              if (mode === 'personal') {
                void personalSortGroupsByName();
                push({ title: '分组已按名称排序', tone: 'info' });
              }
              return;
            }
            /* 只读团队页没有分组管理动作：菜单项已禁用，这里再兜一层（纵深防御，防脚本误触）。 */
            if (mode === 'team') return;
            /* 换序不再顺带打开分组对话框：此前 up/down 会一边弹出对话框一边移动，动作不可预期。 */
            if (action === 'up' || action === 'down') {
              const delta = action === 'up' ? (-1 as const) : (1 as const);
              if (mode === 'personal') void personalMoveGroup(group.id, delta);
              else edit.moveGroup(group.id, delta);
              return;
            }
            setSidebarGroup(group);
          }}
          actions={contentActions}
          collapsed={settings.sidebarCollapsed}
          editLocked={editing}
          update={appUpdate}
          updateSignal={updateSignal}
          onInstallUpdate={() => void installUpdate()}
          onCheckUpdate={() => void checkUpdate()}
          updateChecking={updateChecking}
          onOpenHelp={() => openDialog('shortcuts')}
          onOpenChangelog={() => openDialog('changelog')}
          /* 分组多选批量删除（2026-10-18）：空组直接删，非空组先弹一次确认（列名字 +
             说明会连带删多少入口），再按当前页面把这一批交给个人 store 或团队草稿。 */
          onDeleteGroups={requestDeleteGroups}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tab !== 'home' && (
            <ContentHeader
              tab={tab}
              mode={mode === 'home' ? 'team' : mode}
              query={query}
              onQueryChange={setQuery}
              snapshot={tab === 'personal' ? null : snapshot}
              onRefresh={() => void refresh()}
              typeFilter={typeFilter}
              onToggleTypeFilter={toggleTypeFilter}
              onClearTypeFilter={clearTypeFilter}
              selecting={selecting}
              onToggleSelecting={toggleSelecting}
              actions={contentActions}
              onSearchFocus={() => setSearchFocused(true)}
              onSearchBlur={() => setSearchFocused(false)}
              onSearchEscape={closeSearch}
              onSwitchTab={setTab}
            />
          )}

          {hotkeyConflicts.length > 0 && !gateBlocking && (
            <Banner
              tone="warn"
              title="全局热键没能注册"
              detail={`${hotkeyConflicts
                .map((c) => `${c.accelerator}（${c.kind === 'search' ? '本机程序搜索' : '快捷窗口唤出'}）`)
                .join('、')} 可能已被输入法或其他软件占用，建议到设置改键。`}
              action={{ label: '去设置修改', onSelect: () => openSettings('hotkeys') }}
              onDismiss={() => setHotkeyConflicts([])}
            />
          )}

          {OFFLINE_BANNER_STATES.has(snapshot.state) && tab === 'team' && (
            <Banner tone={p.tone === 'danger' ? 'danger' : 'warn'} title={p.line1} detail={p.line2 ?? undefined} />
          )}

          {updateBanner && <Banner tone="success" title={updateBanner} />}

          <div
            ref={panelRef}
            id={`tl-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tl-tab-${tab}`}
            tabIndex={-1}
            onPointerDown={marquee.onPointerDown}
            className="min-h-0 flex-1 px-[calc(var(--space-6)-var(--space-2))] pt-[var(--space-5)] pb-[var(--space-6)]"
            style={{
              background: contentBackground,
              transition: 'background-color var(--motion-base) var(--ease-standard)',
            }}
          >
            {showSearch ? (
              <div className="h-full">
                <WindowSearchView
                  query={debouncedQuery}
                  hits={hits}
                  debouncing={query !== debouncedQuery}
                  quickAccess={quickAccess}
                  tabLabel={tab === 'team' ? '团队入口' : '我的入口'}
                  icons={iconsForSearch}
                  runtime={runtime}
                  selectedIndex={searchIndex}
                  onSelectIndex={setSearchIndex}
                  onOpen={handleSearchOpen}
                  onAddToPersonal={handleSearchAdd}
                  onClear={() => setQuery('')}
                  programScanning={programs.scanning}
                  programError={programs.error}
                  teamUnavailable={!p.renderable && personal.groups.some((g) => g.entries.length > 0)}
                />
              </div>
            ) : (
              <ScrollArea
                className="h-full"
                ariaLabel="入口内容区"
                initialTop={scrollTop.current[tab]}
                onScrollTop={(top) => {
                  scrollTop.current[tab] = top;
                }}
              >
                {/* 边缘留白（2026-10-21 用户反馈）：多选描边 / 焦点环 / 拖拽落点虚线都画在卡片
                    **外侧**（outline-offset 2~4px），而卡片网格正好顶到滚动容器边缘，
                    这些线在左右两侧会被容器裁掉——"蓝色边缘被遮挡"的根因。
                    这里给内容让出 8px，网格按自身宽度重新算列数，不影响列宽口径。 */}
                <div className="flex h-full flex-col px-2 pb-2">
                  {tab === 'home' ? (
                    <HomePageView />
                  ) : tab === 'personal' ? (
                    <PersonalEntriesView />
                  ) : editing ? (
                    <AdminEditView />
                  ) : (
                    <TeamEntriesView />
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          {(selecting || selected.length > 0) && !editing && (
            <ChainLaunchBar
              count={selected.length}
              intervalMs={settings.chainIntervalMs}
              onLaunch={() => void launchChain(settings.chainIntervalMs)}
              /* 保存为连锁（2026-10-19）：弹名称输入框，确认后落 config/chains.json，
                 主页「连锁」区随即出现一键启动。 */
              onSave={() => setSaveChainOpen(true)}
              onClear={clearSelected}
              onExit={exitSelecting}
            />
          )}

          {/* 底栏只属于团队页（2026-10-17 修）：此前 tab==='home' 也会渲染"发布/放弃改动"，
              而侧栏在主页已切到 home 模式、内容头也隐藏——底栏成了无主语的动作。 */}
          {editing && tab === 'team' && (
        <EditActionBar
          dirtyCount={dirtyCount}
          revision={snapshot.revision ?? 0}
          publishedAt={snapshot.config?.publishedAt ?? null}
          publishing={phase === 'publishing'}
          /* 无改动时直接退出（用户反馈：空草稿不该再确认一次） */
          onDiscard={() => {
            if (dirtyCount > 0) setConfirmExit(true);
            else {
              edit.exit(true);
              push({ title: '已退出编辑模式', tone: 'info' });
            }
          }}
          onPublish={() => openDialog('publish')}
        />
          )}
        </div>
      </div>

      {locateId && (
        <span role="status" className="sr-only">
          已定位到 {locateId}
        </span>
      )}

      {/* 分组多选批量删除的确认（2026-10-18）：把名字与"会删掉多少入口"说全，
          不做一键删除；确认后按当前页交给个人 store 或团队草稿。 */}
      {deleteGroups && (
        <ConfirmDialog
          title={`删除 ${deleteGroups.length} 个分组？`}
          detail={`${deleteGroups.map((g) => g.name).join('、')}——组内共 ${deleteGroups.reduce((n, g) => n + g.entries.length, 0)} 个入口会一并删除，且不可恢复。`}
          confirmLabel="删除"
          destructive
          onConfirm={() => {
            const scope = deleteGroups;
            setDeleteGroups(null);
            removeGroupList(scope);
          }}
          onCancel={() => setDeleteGroups(null)}
        />
      )}

      {/* 拖拽投放提示（2026-10-19）：整窗虚线框 + 指出会落进哪一组；纯视觉、不吃指针事件。 */}
      {dropActive && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-2 z-[var(--z-dropdown)] grid place-items-center rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--accent)]"
          style={{ background: 'var(--accent-tint)', opacity: 0.92 }}
        >
          <span className="t-base w-emph text-center text-[var(--accent-text)]">
            松开鼠标，把拖进来的图标 / 文件夹加进「{dropGroupName ?? '我的入口'}」
            {dropGroupName === null && <span className="t-2xs block font-normal opacity-80">（拖到某个分组上可以直接落进那一组）</span>}
          </span>
        </div>
      )}

      {/* 框选多选的选框（2026-10-18）：fixed + pointer-events:none，纯视觉——
          命中高亮在卡片上（data-tl-marquee-hit），这里只画矩形。 */}
      {marquee.rect && (
        <div
          aria-hidden
          className="tl-marquee-rect"
          style={{
            left: marquee.rect.left,
            top: marquee.rect.top,
            width: marquee.rect.width,
            height: marquee.rect.height,
          }}
        />
      )}

      {/* 保存为连锁（2026-10-19）：名称输入确认框。同名的拦住——主页「连锁」区靠名字区分，
          两条同名会让人分不清点哪条。保存的是"当前多选清单的顺序 + 当前间隔"。 */}
      {saveChainOpen && (
        <RenameDialog
          title="保存为连锁"
          detail={`把当前选中的 ${selected.length} 个入口按这个顺序存成一条连锁；之后在主页点一下就能依次启动。`}
          fieldLabel="连锁名称"
          placeholder="例如：开工三件套"
          initial=""
          confirmLabel="保存"
          maxLength={40}
          validate={(next) => {
            if (next.trim().length === 0) return '名称不能为空';
            if (chains.some((c) => c.name === next.trim())) return '已有同名连锁，换个名字';
            return null;
          }}
          onConfirm={(name) => {
            setSaveChainOpen(false);
            void saveChain(name, selected, settings.chainIntervalMs).then((r) => {
              if (r.ok) {
                push({ title: `已保存连锁「${name.trim()}」，主页「连锁」里可一键启动`, tone: 'success' });
                return;
              }
              push({ title: r.reason ?? '没能保存这条连锁', tone: 'warn' });
            });
          }}
          onCancel={() => setSaveChainOpen(false)}
        />
      )}

      {/* 新建分组：名称输入确认框（个人页与团队编辑态共用）。同名会就地拦住——
          分组名是侧栏锚点 id 与批量添加落点的键，重名会出歧义。 */}
      {newGroupScope && (
        <RenameDialog
          title="新建分组"
          detail="分组名会显示在侧栏与卡片页；之后也能在分组上右键重命名。"
          fieldLabel="分组名称"
          placeholder="给这个分组起个名字"
          initial={newGroupDefault}
          confirmLabel="创建分组"
          maxLength={CAPACITY.MAX_NAME_LEN}
          validate={(next) =>
            newGroupGroups(newGroupScope).some((g) => g.name.trim() === next)
              ? '已有同名分组，换个名字或先重命名那一个'
              : null
          }
          onConfirm={(name) => {
            const scope = newGroupScope;
            setNewGroupScope(null);
            void (async () => {
              const r = scope === 'personal' ? await addPersonalGroup(name) : edit.addGroup(name);
              if (!r.ok && r.reason) push({ title: r.reason, tone: 'warn' });
              // 本机用量统计（仅落本机、不上报）：新建分组的次数（成功才算）。
              else void api.usage.bump({ kind: 'feature', key: 'newGroup' });
            })();
          }}
          onCancel={() => setNewGroupScope(null)}
        />
      )}

      {sidebarGroup && (
        <GroupActionsDialog
          groupName={sidebarGroup.name}
          canManage={mode !== 'team'}
          canMoveUp={sidebarGroupIdx > 0}
          canMoveDown={sidebarGroupIdx >= 0 && sidebarGroupIdx < groups.length - 1}
          entryCount={sidebarGroup.entries.length}
          scope={mode === 'personal' ? 'personal' : 'team'}
          onRename={(name) => {
            if (mode === 'personal') void personalRenameGroup(sidebarGroup.id, name);
            else edit.renameGroup(sidebarGroup.id, name);
          }}
          onMove={(delta) => {
            if (mode === 'personal') void personalMoveGroup(sidebarGroup.id, delta);
            else edit.moveGroup(sidebarGroup.id, delta);
          }}
          onRemove={() => {
            if (mode === 'personal') void personalRemoveGroup(sidebarGroup.id);
            else edit.removeGroup(sidebarGroup.id);
          }}
          onCancel={() => setSidebarGroup(null)}
        />
      )}

      {/* 导入文件选择：Electron 里走主进程文件对话框，浏览器预览里点隐藏 file input */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <DialogRouter
        dialog={dialog}
        hotkeyConflicts={hotkeyConflicts}
        feedbackTargetId={feedbackTargetId}
        closeDialog={closeDialog}
        dirtyCount={dirtyCount}
        revision={snapshot.revision ?? 0}
        gateBlocking={gateBlocking}
        miniOpen={miniOpen}
        onMiniClose={() => setMiniOpen(false)}
        onLocate={(id) => {
          closeDialog();
          setLocateId(id);
        }}
        confirmExit={confirmExit}
        onCancelExit={() => setConfirmExit(false)}
        onConfirmExit={() => {
          setConfirmExit(false);
          edit.exit(true);
          push({ title: '已退出编辑模式，未发布的改动已丢弃', tone: 'info' });
        }}
        importOutcome={importOutcome}
        onDismissImport={() => setImportOutcome(null)}
        onRetryImport={() => {
          setImportOutcome(null);
          fileRef.current?.click();
        }}
        onResolveAgain={(outcome) => setImportOutcome(outcome)}
        // 提交被容量闸拦下：切成 error 对话框，绝不能报"导入成功"
        onImportFailed={(reason) => setImportOutcome({ kind: 'error', error: reason, line: null })}
      />
    </div>
  );
}
