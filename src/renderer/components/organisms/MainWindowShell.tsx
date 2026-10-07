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
import { EditActionBar } from './EditActionBar.tsx';
import { ChainLaunchBar } from './ChainLaunchBar.tsx';
import { DialogRouter } from './DialogRouter.tsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { useGlobalHotkeys } from '../../hooks/useGlobalHotkeys.ts';
import { useToolbarMenus } from '../../hooks/useToolbarMenus.ts';
import { capacityExceededCopy } from '../../../shared/capacity-copy.ts';
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
import type { Entry } from '../../../shared/schema/entry.ts';

const OFFLINE_BANNER_STATES = new Set([
  'OFFLINE_CACHED',
  'OFFLINE_EMPTY',
  'SYNC_DATA_REJECTED',
  'SYNC_FAILED_UNKNOWN',
]);

export function MainWindowShell() {
  const { tab, setTab, query, setQuery, runtime, openEntry, dialog, openDialog, closeDialog, feedbackTargetId, openEntryEditor, entryEditor, typeFilter, toggleTypeFilter, clearTypeFilter, openSettings, selecting, selected, toggleSelecting, clearSelected, exitSelecting, launchChain } =
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

  /* 自动更新进展：available 一次轻提示；downloaded 常驻 toast + 一键安装。 */
  useEffect(() => {
    const off = api.events.onAppUpdate((event) => {
      if (event.type === 'available') {
        push({ title: `发现新版本 v${event.version}，正在后台下载`, tone: 'info' });
        return;
      }
      push({
        title: `新版本 v${event.version} 已就绪，重启后即更新`,
        tone: 'success',
        duration: 0,
        actions: [{ label: '立即更新并重启', onSelect: () => void api.updater.install() }],
      });
    });
    return off;
  }, [push]);

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
    edit.beginEdit();
  }, [unlocked, editing, edit, openDialog, push]);

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

  /** 粘贴快捷添加（方案 A）：复制了网址/路径后，在非输入焦点按 Ctrl+V，
      识别剪贴板内容并预填进与手动添加同款的编辑器——回车即成，取消不留痕。
      落点永远是「我的入口」（个人场景为主，行为可预期）；只在无对话框、
      非隐私门、焦点不在输入框时接管，输入框内的 Ctrl+V 仍是普通粘贴。 */
  const quickAddFromClipboard = useCallback(
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
      openEntryEditor({ mode: 'create', groupId: null, scope: 'personal', prefill });
    },
    [push, openEntryEditor, setTab],
  );


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
  const capacityReason = usage.atEntryLimit || usage.atGroupLimit ? capacityExceededCopy(usage) : null;

  const gateBlocking = settings.telemetryNoticeAckedAt === null;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, [contenteditable="true"]')) return;
      if (dialog !== 'none' || entryEditor || gateBlocking) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      void quickAddFromClipboard(text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [dialog, entryEditor, gateBlocking, quickAddFromClipboard]);
  const contentBackground = editing ? 'var(--surface-editing)' : 'var(--bg-canvas)';
  /** 侧栏与内容头共用：编辑态只属于团队页，个人页永远是 personal，主页无操作区。 */
  const mode: SidebarMode = tab === 'home' ? 'home' : tab === 'personal' ? 'personal' : editing ? 'editing' : 'team';

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
            setSidebarGroup(group);
            if (action === 'up') {
              if (mode === 'personal') void personalMoveGroup(group.id, -1);
              else edit.moveGroup(group.id, -1);
            }
            if (action === 'down') {
              if (mode === 'personal') void personalMoveGroup(group.id, 1);
              else edit.moveGroup(group.id, 1);
            }
          }}
          onAddPersonalGroup={() => void addPersonalGroup()}
          onAddPersonalEntry={() => openEntryEditor({ mode: 'create', groupId: null, scope: 'personal' })}
          addDisabledReason={tab === 'personal' ? capacityReason : null}
          onImport={() => fileRef.current?.click()}
          onExport={() => void doExport()}
          onUndo={edit.undo}
          onAddGroup={edit.addGroup}
          onAddEntry={() => openEntryEditor({ mode: 'create', groupId: null, scope: 'team' })}
          showEditEntry={settings.role === 'admin'}
          onToggleEdit={toggleEdit}
          collapsed={settings.sidebarCollapsed}
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

          {editing && tab !== 'personal' && (
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

      {sidebarGroup && (
        <GroupActionsDialog
          groupName={sidebarGroup.name}
          canMoveUp
          canMoveDown
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
          push({ title: '已退出编辑模式，未发布的改动仍保存在本机', tone: 'info' });
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
