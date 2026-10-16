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

import { api } from '../../bridge/index.ts';
import { ScrollArea } from '../atoms/ScrollArea.tsx';
import { Banner } from '../molecules/Banner.tsx';
import { TitleBar } from './TitleBar.tsx';
import { ContentHeader } from './ContentHeader.tsx';
import { Sidebar, type SidebarMode } from './Sidebar.tsx';
import { GroupActionsDialog } from './GroupActionsDialog.tsx';
import { RenameDialog } from './SimpleDialog.tsx';
import { EditActionBar } from './EditActionBar.tsx';
import { ChainLaunchBar } from './ChainLaunchBar.tsx';
import { DialogRouter } from './DialogRouter.tsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys.ts';
import { readMemoryList, writeMemoryList } from '../../lib/localMemory.ts';
import { useToolbarMenus } from '../../hooks/useToolbarMenus.ts';
import { entryLimitCopy, groupLimitCopy } from '../../../shared/capacity-copy.ts';
import { measure } from '../../../shared/capacity-usage.ts';
import { CAPACITY } from '../../../shared/schema/common.ts';
import { DEFAULT_APP_HOTKEYS } from '../../../shared/app-hotkeys.ts';
import { useEntryIcons } from '../../hooks/useEntryIcons.ts';
import { useEntrySearch } from '../../hooks/useEntrySearch.ts';
import { syncPresentation } from '../../services/syncCopy.ts';
import { useEdit } from '../../store/editStore.tsx';
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

/** 本机记忆键：已提示过的公告 id（见 lib/localMemory.ts 的三条边界）。 */
const ANNOUNCEMENTS_SEEN_KEY = 'announcements-seen';

const OFFLINE_BANNER_STATES = new Set([
  'OFFLINE_CACHED',
  'OFFLINE_EMPTY',
  'SYNC_DATA_REJECTED',
  'SYNC_FAILED_UNKNOWN',
]);

export function MainWindowShell() {
  const { tab, setTab, setEditingLock, query, setQuery, runtime, openEntry, dialog, openDialog, closeDialog, feedbackTargetId, openEntryEditor, entryEditor, typeFilter, toggleTypeFilter, clearTypeFilter, openSettings, selecting, selected, toggleSelecting, clearSelected, exitSelecting, launchChain, quickAddFromText } =
    useWorkbench();
  const { snapshot, refresh } = useSync();
  const { settings, patch } = useSettings();
  const edit = useEdit();
  const { config: personal, usage, beginImport, addGroup: addPersonalGroup, renameGroup: personalRenameGroup, moveGroup: personalMoveGroup, removeGroup: personalRemoveGroup, sortGroupsByName: personalSortGroupsByName } = usePersonal();
  const { push } = useToasts();

  const [miniOpen, setMiniOpen] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const [importOutcome, setImportOutcome] = useState<ImportOutcome>(null);
  const [updateBanner, setUpdateBanner] = useState<string | null>(null);
  /** 应用自更新：已下载待安装的版本号（常驻横幅，关掉不装也行——下次启动会再提示）。 */
  const [appUpdate, setAppUpdate] = useState<string | null>(null);
  /** 热键注册状态只信主进程推送：此前这里写死 true + 按默认键名猜测，横幅常年说谎。 */
  const [hotkeyConflict, setHotkeyConflict] = useState(false);
  const [locateId, setLocateId] = useState<string | null>(null);
  /** 侧栏分组右键触发的分组操作对话框（重命名/删除按当前页分发到对应 store）。 */
  const [sidebarGroup, setSidebarGroup] = useState<Group | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastRevision = useRef(snapshot.revision);
  const scrollTop = useRef<Record<string, number>>({ team: 0, personal: 0 });

  const p = syncPresentation(snapshot);
  const debouncedQuery = useDebouncedValue(query, 120);
  const searching = debouncedQuery.trim().length > 0;
  const { editing, dirtyCount, unlocked, phase } = edit;

  /* 热键注册结果由主进程推送（注册失败每次会话只报一次，见 hotkey.ts）。 */
  useEffect(() => {
    const offConflict = api.events.onHotkeyConflict(() => setHotkeyConflict(true));
    const offStatus = api.events.onHotkeyStatus((r) => setHotkeyConflict(!r.registered));
    return () => {
      offConflict();
      offStatus();
    };
  }, []);

  /* 自动更新：available 一次轻提示（几秒自散）；downloaded 常驻横幅 + 一键安装。
     装与重启刻意不自动做（主进程 autoInstallOnAppQuit=false）——用户不确认就不动他的机器。 */
  useEffect(() => {
    const off = api.events.onAppUpdate((event) => {
      if (event.type === 'available') {
        push({ title: `发现新版本 v${event.version}，正在后台下载`, tone: 'info' });
        return;
      }
      setAppUpdate(event.version);
    });
    return off;
  }, [push]);

  /* 启动时先捞一次状态：上次会话已下载好的更新不必等 30 秒后的周期检查才亮横幅。 */
  useEffect(() => {
    void api.updater
      .status()
      .then((s) => {
        if (s.readyToInstall && s.availableVersion) setAppUpdate(s.availableVersion);
      })
      .catch(() => undefined);
  }, []);

  const groups: Group[] = useMemo(() => {
    if (tab === 'home') return [];
    if (tab === 'personal') return personal.groups;
    if (editing) return edit.draft?.groups ?? [];
    return snapshot.config?.groups ?? [];
  }, [tab, personal.groups, editing, edit.draft, snapshot.config]);

  const entriesFlat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const icons = useEntryIcons(entriesFlat);

  const hits = useEntrySearch(groups, debouncedQuery);

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

  /* 主页公告广播（2026-10-17 用户要求"让所有人知晓"）：挑出"没提示过的公告"，右下角提示一次。
     每篇只提示一次（本机记 id、最多留 100 条）；关掉提示不影响公告本身——主页上一直看得到。
     首次装机的存量公告也会提示一次：这正是"让所有人知晓"的意图。 */
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
    push({
      title: `新公告：${latest.title}`,
      detail: latest.body.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
      tone: 'info',
      duration: 8000,
      actions: [{ label: '去主页看', onSelect: () => setTab('home') }],
    });
  }, [snapshot.config, settings.announcementNotify, gateBlocking, push, setTab]);

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

  /** 应用内快捷键：内置默认 + 用户覆盖（settings.appHotkeys 只存改过的动作）。 */
  const appHotkeys = useMemo(() => ({ ...DEFAULT_APP_HOTKEYS, ...settings.appHotkeys }), [settings.appHotkeys]);

  /* 快捷面板的「加为入口」：主进程收起面板后把文本转到这里，
     走与 Ctrl+V 粘贴添加完全同一条流程（识别与预填在 workbenchStore）。 */
  useEffect(() => api.events.onQuickAdd((text) => void quickAddFromText(text)), [quickAddFromText]);
  /* ---------------- 全局键位（键位表见 useGlobalHotkeys） ---------------- */
  useGlobalHotkeys({
    onTabTeam: () => setTab('team'),
    onTabPersonal: () => setTab('personal'),
    onRefresh: () => void refresh(),
    onToggleMini: () => setMiniOpen((v) => !v),
    onOpenSettings: () => openSettings(),
    onToggleEdit: toggleEdit,
    onPublish: () => openDialog('publish'),
    onNewEntry: newEntryForCurrentTab,
    onToggleSidebar: () => void patch({ sidebarCollapsed: !settings.sidebarCollapsed }),
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
  const contentBackground = editing ? 'var(--surface-editing)' : 'var(--bg-canvas)';
  /** 侧栏与内容头共用：编辑态只属于团队页，个人页永远是 personal，主页无操作区。 */
  const mode: SidebarMode = tab === 'home' ? 'home' : tab === 'personal' ? 'personal' : editing ? 'editing' : 'team';
  /** 侧栏分组对话框的换序边界：按真实索引算（此前硬编码 true，边界上点了不动）。 */
  const sidebarGroupIdx = sidebarGroup ? groups.findIndex((g) => g.id === sidebarGroup.id) : -1;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <TitleBar
        closeDisabled={gateBlocking}
        collapsed={settings.sidebarCollapsed}
        onToggleSidebar={() => void patch({ sidebarCollapsed: !settings.sidebarCollapsed })}
        onOpenAbout={() => openSettings('about')}
        onOpenHelp={() => openDialog('shortcuts')}
        teamRevision={snapshot.revision}
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
          onAddPersonalGroup={() => setNewGroupScope('personal')}
          onAddPersonalEntry={() => openEntryEditor({ mode: 'create', groupId: null, scope: 'personal' })}
          onBatchAddPersonal={() => openDialog('batchAdd')}
          onScanPersonal={() => openDialog('scanPicker')}
          onBatchAddTeam={() => openDialog('batchAddTeam')}
          addGroupDisabledReason={groupAddReason}
          addEntryDisabledReason={entryAddReason}
          onImport={() => fileRef.current?.click()}
          onExport={() => void doExport()}
          onUndo={edit.undo}
          onAddGroup={() => setNewGroupScope('team')}
          onAddEntry={() => openEntryEditor({ mode: 'create', groupId: null, scope: 'team' })}
          showEditEntry={settings.role === 'admin'}
          onToggleEdit={toggleEdit}
          collapsed={settings.sidebarCollapsed}
          editLocked={editing}
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
            />
          )}

          {hotkeyConflict && !gateBlocking && (
            <Banner
              tone="warn"
              title="全局热键没能注册"
              detail="此热键可能已被输入法或其他软件占用，建议到设置改为 Ctrl+Alt+Space。"
              action={{ label: '去设置修改', onSelect: () => openSettings('hotkeys') }}
              onDismiss={() => setHotkeyConflict(false)}
            />
          )}

          {OFFLINE_BANNER_STATES.has(snapshot.state) && tab === 'team' && (
            <Banner tone={p.tone === 'danger' ? 'danger' : 'warn'} title={p.line1} detail={p.line2 ?? undefined} />
          )}

          {updateBanner && <Banner tone="success" title={updateBanner} />}

          {appUpdate && (
            <Banner
              tone="success"
              title={`新版本 v${appUpdate} 已就绪`}
              detail="安装会关闭并重启应用：仅为当前用户安装的机器直接装好；为所有用户安装的机器会要一次管理员确认。"
              action={{ label: '立即更新并重启', onSelect: () => void api.updater.install() }}
              onDismiss={() => setAppUpdate(null)}
            />
          )}

          <div
            id={`tl-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tl-tab-${tab}`}
            tabIndex={-1}
            className="min-h-0 flex-1 px-[var(--space-6)] pt-[var(--space-5)] pb-[var(--space-6)]"
            style={{
              background: contentBackground,
              transition: 'background-color var(--motion-base) var(--ease-standard)',
            }}
          >
            {searching && !editing ? (
              <div className="h-full">
                <WindowSearchView
                  query={debouncedQuery}
                  hits={hits}
                  debouncing={query !== debouncedQuery}
                  tabLabel={tab === 'team' ? '团队入口' : '我的入口'}
                  icons={icons}
                  runtime={runtime}
                  selectedIndex={searchIndex}
                  onSelectIndex={setSearchIndex}
                  onOpen={(hit) => void openEntry(hit.entry)}
                  onClear={() => setQuery('')}
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
                {tab === 'home' ? (
                  <HomePageView />
                ) : tab === 'personal' ? (
                  <PersonalEntriesView />
                ) : editing ? (
                  <AdminEditView />
                ) : (
                  <TeamEntriesView />
                )}
              </ScrollArea>
            )}
          </div>

          {(selecting || selected.length > 0) && !editing && (
            <ChainLaunchBar
              count={selected.length}
              intervalMs={settings.chainIntervalMs}
              onLaunch={() => void launchChain(settings.chainIntervalMs)}
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
        hotkeyConflict={hotkeyConflict}
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
