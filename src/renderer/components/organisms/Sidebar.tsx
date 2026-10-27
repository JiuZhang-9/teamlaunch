/**
 * Sidebar —— 左侧 240px 导航与分组锚点（2026-10-02 定稿：V2 工作区条形态）。
 *
 * 自上而下：导航（三入口页，选中态 = 左侧 3px 竖条 + accent tint 底）
 *   → 分组锚点（组名 + 计数，点击平滑滚动到对应组头；**分组多了这一段自己滚**，不挤压下面）
 *   → 弹性空白（app-region: drag）
 *   → V2 工作区条：[工作区方块 + 双行文案] ｜ 设置齿轮（点击工作区条弹出窗口内同步弹层）
 *
 * 1.3.0（2026-10-27 用户要求）：**中段不再放操作区，只留分组**。
 * 团队页「操作」与我的页「本机管理」语义统一叫「操作」，全部收进左下工作区弹窗；
 * 工作栏（搜索栏同行）另有一份同样的动作，侧栏收起时也能直接用。
 * 两处共用外壳构建的 `actions`，不各写一套——否则会出现"这边能点、那边点不动"。
 *
 * 折叠：collapsed 时整条 width→0 完全消失（非图标栏形态），内部固定 240 宽防挤压；
 * 弹性空白与底部区声明 app-region: drag，与顶部 TitleBar 一起构成"整条左侧都能拖窗口"。
 * 可拖区域内的交互元素必须逐个 no-drag。
 *
 * 底部固定（2026-10-17）：工作区条/设置永远可见——**中段（分组）整段用 ScrollArea 吸收高度**。
 */
import { CircleHelp, Download, RefreshCw, RotateCw, ScrollText, Settings, Stethoscope, SunMoon } from 'lucide-react';
import { ContextMenu } from '../molecules/ContextMenu.tsx';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import { syncPresentation } from '../../services/syncCopy.ts';
import type { Group } from '../../../shared/schema/group.ts';
import type { SyncSnapshot } from '../../bridge/types.ts';
import { Button } from '../atoms/Button.tsx';
import { ScrollArea } from '../atoms/ScrollArea.tsx';
import { MenuItem } from '../molecules/MenuItem.tsx';
import { ProgressRing } from '../molecules/ProgressRing.tsx';
import { ThemePicker } from '../molecules/ThemePicker.tsx';
import { useSettings } from '../../store/settingsStore.tsx';
import { SyncIndicator } from '../molecules/SyncIndicator.tsx';
import { PageTabs } from './PageTabs.tsx';
import type { TabKey } from '../../store/workbenchStore.tsx';
import type { ToolbarAction } from '../../lib/toolbar-actions.ts';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export type SidebarMode = 'home' | 'team' | 'editing' | 'personal';

export interface SidebarProps {
  tab: TabKey;
  mode: SidebarMode;
  onTabChange(t: TabKey): void;
  /**
   * 编辑态锁（2026-10-17 用户要求）：编辑中「我的入口」页签置灰、点不动。
   * 逻辑拦截的唯一真源在 workbenchStore.setTab（连 Ctrl+E 与粘贴跳转一起管住），
   * 这里只是同一条规则的视觉面。
   */
  editLocked?: boolean;
  /** 当前页的分组（外壳已按 tab/editing 选好），用于锚点区。 */
  groups: Group[];
  snapshot: SyncSnapshot | null;
  /** 当前页可执行的操作（与工作栏同一份数据，保证两处不漂移）。 */
  actions: ToolbarAction[];
  onOpenSettings(): void;
  onOpenDiagnostics(): void;
  onRefresh(): void;
  collapsed?: boolean;
  /**
   * 分组锚点右键菜单的动作出口：open=打开分组操作对话框，up/down=换序，
   * sortByName=全部分组按名称排序（仅个人页）。只读团队页（mode==='team'）也传此 prop，
   * 但菜单项一律禁用并给出说明——"看得见能力在哪、也看得见为什么按不动"；
   * 菜单位置的禁用只是表象，真正的写入守卫在 editStore（非编辑态不写草稿）。
   */
  onGroupAction?(group: Group, action: 'open' | 'up' | 'down' | 'sortByName'): void;
  /**
   * 应用更新（2026-10-18 用户要求）：有新版时在工作区条上方的小窗里提示 + 圆形下载进度。
   * null = 没有可用更新。`updateSignal` 每次"该提醒一次"时自增，小窗据此自动弹出。
   * 1.3.0：顶栏也有一份同样的提示（TitleBar），这里保留原样。
   */
  update?: { version: string; percent: number | null; ready: boolean } | null;
  updateSignal?: number;
  onInstallUpdate?(): void;
  onCheckUpdate?(): void;
  /** 正在跑一轮手动检查（小窗里那一行改成"正在检测…"）。 */
  updateChecking?: boolean;
  /** 小窗里的「查看帮助」与「查看更新日志」（2026-10-18 用户要求补的功能入口）。 */
  onOpenHelp?(): void;
  onOpenChangelog?(): void;
  /**
   * 分组多选批量删除（2026-10-18 用户要求）：非空时侧栏锚点区可 Ctrl/Shift 多选分组，
   * 选中后那块位置出现「删除选中 / 清空」。删除的二次确认由外层负责（列表 + 入口数要说清）。
   */
  onDeleteGroups?(groups: Group[]): void;
}

function SectionCap({ children }: { children: ReactNode }) {
  return <div className="t-2xs px-3 pb-1 pt-0.5 text-[var(--meta)]">{children}</div>;
}

export function Sidebar(props: SidebarProps) {
  const {
    tab, mode, onTabChange, groups, snapshot, actions, onOpenSettings, onOpenDiagnostics, onRefresh,
    collapsed = false, editLocked = false, onGroupAction,
    update = null, updateSignal = 0, onInstallUpdate, onCheckUpdate, updateChecking = false,
    onOpenHelp, onOpenChangelog, onDeleteGroups,
  } = props;
  const { settings, patch } = useSettings();
  const reduced = useReducedMotion();
  const [syncPop, setSyncPop] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  /** 分组锚点右键菜单（重命名/删除，动作经 onGroupAction 交给外壳分发）。 */
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: Group } | null>(null);
  /** 分组多选（2026-10-18）：选中的分组 id；anchorRef 记 Shift 连选的锚点。 */
  const [groupSel, setGroupSel] = useState<string[]>([]);
  const anchorRef = useRef<string | null>(null);
  /** 只有能改分组的页面才给多选（个人页 / 团队编辑态）；只读团队页连选都不该选得起来。 */
  const canManageGroups = mode === 'personal' || mode === 'editing';
  /* 分组被删/改名后把选择集收敛到仍存在的 id：否则计数会虚高、批量删除会带上幽灵。 */
  useEffect(() => {
    setGroupSel((cur) => {
      const alive = new Set(groups.map((g) => g.id));
      const next = cur.filter((id) => alive.has(id));
      return next.length === cur.length ? cur : next;
    });
  }, [groups]);
  useEffect(() => {
    if (!canManageGroups) setGroupSel([]);
  }, [canManageGroups]);
  useEffect(() => {
    if (collapsed) setGroupSel([]);
  }, [collapsed]);

  useEffect(() => {
    if (collapsed) setSyncPop(false);
  }, [collapsed]);

  /* 更新提示（2026-10-18）：外壳每次"该说一声"就自增 updateSignal，小窗自动弹出来一次。
     收起侧栏时不弹（小窗与工作区条一起消失，弹了也看不见），指示点仍留在展开后的条上。 */
  const lastUpdateSignal = useRef(0);
  useEffect(() => {
    if (updateSignal === lastUpdateSignal.current) return;
    lastUpdateSignal.current = updateSignal;
    if (!collapsed) setSyncPop(true);
  }, [updateSignal, collapsed]);

  useEffect(() => {
    if (!syncPop) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('#tl-wbar')) setSyncPop(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSyncPop(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [syncPop]);

  /** 锚点点击：平滑滚动到对应组头（组头带 tl-group-{name} id，见 GroupSections）。 */
  const goGroup = (name: string) => {
    const target = document.getElementById(`tl-group-${encodeURIComponent(name)}`);
    target?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  /**
   * 分组右键菜单的四项动作：只在能改分组的页面可用（个人页 / 团队编辑态）。
   * 只读团队页显示为禁用 + 顶部说明，不再"可点但无效果"；
   * 换序在边界处同样禁用（此前可点却不动，也是"点了没反应"）。
   */
  const groupMenuState = groupMenu
    ? (() => {
        const idx = groups.findIndex((g) => g.id === groupMenu.group.id);
        const canManage = mode === 'personal' || mode === 'editing';
        return {
          canManage,
          canMoveUp: canManage && idx > 0,
          canMoveDown: canManage && idx >= 0 && idx < groups.length - 1,
          note: canManage ? undefined : '进入编辑模式后可管理分组',
        };
      })()
    : null;

  const syncLine =
    mode === 'personal'
      ? '本机数据'
      : mode === 'editing'
        ? '编辑中 · 未发布'
        : snapshot
          ? syncPresentation(snapshot).line1
          : '等待同步';

  return (
    <aside
      className="relative h-full shrink-0 overflow-hidden border-r border-[var(--border-subtle)] transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-emphasis)]"
      style={{
        width: collapsed ? 0 : 'var(--sidebar-w)',
        background: 'var(--bg-chrome)',
        /* 子树悬浮亮度整体抬一档：chrome 比卡片亮一级，hover 必须比 chrome 再亮一级 */
        '--bg-surface-hover': 'var(--bg-chrome-hover)',
      } as CSSProperties}
      aria-hidden={collapsed || undefined}
    >
      <div
        className="flex h-full w-[var(--sidebar-w)] flex-col"
        style={{ background: 'var(--bg-chrome)' }}
      >
        <nav className="px-[var(--sidebar-pad)] pt-[var(--sidebar-pad)]">
          <PageTabs
            orientation="vertical"
            value={tab}
            onChange={onTabChange}
            disabledKeys={editLocked ? ['personal'] : undefined}
            disabledTitle="编辑中：先退出编辑模式再切换页面"
          />
        </nav>

        {/* 中段只剩分组锚点（1.3.0）：窗口小或分组多时由它让出空间，
            底部工作区条/设置永远钉在可视区里（2026-10-17 用户反馈：分组一多底部就被挤下去）。 */}
        <ScrollArea className="mt-[var(--space-3)] min-h-0 flex-1" ariaLabel="侧栏中段">
          {mode !== 'home' && (
            <div className="border-t border-[var(--border-subtle)] px-[var(--sidebar-pad)] pt-[var(--space-2)]">
              <SectionCap>分组</SectionCap>
              {/* 分组多选（2026-10-18 用户要求"分组侧边栏的操作逻辑希望能支持多选，以便批量删除等"）：
                  Ctrl/Cmd 点加选、Shift 点选一段；选起来之后这块位置显示批量动作，其他情况不占地方。 */}
              {canManageGroups && groupSel.length > 0 ? (
                <div className="mb-1 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="t-xs min-w-0 flex-1 truncate-1 text-[var(--fg)]">
                      已选 {groupSel.length} 个分组
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteGroups?.(groups.filter((g) => groupSel.includes(g.id)))}
                      className="t-xs shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--danger-fg)] hover:bg-[var(--danger-bg)]"
                    >
                      删除选中
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupSel([])}
                      className="t-xs shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[var(--fg-2)] hover:bg-[var(--bg-surface-hover)]"
                    >
                      清空
                    </button>
                  </div>
                  <p className="t-2xs mt-0.5 text-[var(--meta)]">Ctrl 点加选 · Shift 点选一段</p>
                </div>
              ) : null}
              {groups.length === 0 ? (
                <div className="px-3 pb-1 text-[13px] text-[var(--meta)]">暂无分组</div>
              ) : (
                groups.map((g) => {
                  const picked = groupSel.includes(g.id);
                  return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={canManageGroups && groupSel.length > 0 ? picked : undefined}
                    onClick={(e) => {
                      /* 多选只在能改分组的页面成立（个人页 / 编辑态）：只读团队页的 Ctrl 点击
                         仍走原来的定位行为，不给一个点了没用的选择态。 */
                      if (canManageGroups && (e.ctrlKey || e.metaKey)) {
                        setGroupSel((cur) => (cur.includes(g.id) ? cur.filter((id) => id !== g.id) : [...cur, g.id]));
                        anchorRef.current = g.id;
                        return;
                      }
                      if (canManageGroups && e.shiftKey && anchorRef.current !== null) {
                        const from = groups.findIndex((x) => x.id === anchorRef.current);
                        const to = groups.findIndex((x) => x.id === g.id);
                        if (from >= 0 && to >= 0) {
                          const [lo, hi] = from <= to ? [from, to] : [to, from];
                          setGroupSel(groups.slice(lo, hi + 1).map((x) => x.id));
                          return;
                        }
                      }
                      /* 普通点击＝定位；顺手清掉分组多选（避免"选着选着忘了还选着"）。 */
                      if (groupSel.length > 0) setGroupSel([]);
                      goGroup(g.name);
                    }}
                    onContextMenu={(e) => {
                      if (!onGroupAction) return;
                      e.preventDefault();
                      setGroupMenu({ x: e.clientX, y: e.clientY, group: g });
                    }}
                    className={[
                      'flex h-7 w-full items-center gap-2 truncate rounded-[var(--radius-sm)] px-3 text-[13px] transition-colors duration-[var(--motion-fast)]',
                      picked ? 'text-[var(--fg)]' : 'text-[var(--fg)] hover:bg-[var(--bg-surface-hover)]',
                    ].join(' ')}
                    style={picked ? { background: 'var(--row-bg-selected)' } : undefined}
                    title={`定位到分组「${g.name}」${canManageGroups ? '（Ctrl 点加选、Shift 选一段）' : ''}`}
                  >
                    <span className="truncate-1">{g.name}</span>
                    <span className="ml-auto text-xs text-[var(--meta)]">{g.entries.length}</span>
                  </button>
                  );
                })
              )}
            </div>
          )}
        </ScrollArea>

        {/* 弹性拖拽条：中段已整段可滚，这里留一条固定高度的空白用来拖窗口。
            注意：收起时必须彻底撤掉 drag 声明：app-region 是几何叠加，overflow 裁剪
            不取消命中——留着的话左列卡片（收起后挪进这 240px）会整块变成拖拽区，
            悬停/点击全被系统吃掉（2026-10-05 用户实测）。 */}
        <div className="h-[var(--space-8)] shrink-0" style={collapsed ? undefined : DRAG} />

        {/* V2 工作区条（定稿）：[工作区方块+双行文案] ｜ 设置齿轮
            shrink-0：这一条与设置永远不能参与收缩——分组多时该让分组区去滚（2026-10-17）。 */}
        <div
          className="flex shrink-0 items-center gap-1 border-t border-[var(--border-subtle)] p-2"
          style={collapsed ? undefined : DRAG}
        >
          <button
            type="button"
            id="tl-wbar"
            aria-expanded={syncPop}
            aria-haspopup="dialog"
            aria-label={update ? `工作区（有新版本 v${update.version}${update.ready ? '，可安装' : '，正在下载'}）` : undefined}
            title={update ? `新版本 v${update.version}${update.ready ? '已就绪' : '正在后台下载'}` : undefined}
            onClick={() => setSyncPop((v) => !v)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-left transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
            style={NO_DRAG}
          >
            <span className="relative">
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] text-[11px] font-[var(--weight-emphasize)]"
                style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}
                aria-hidden
              >
                工
              </span>
              {/* 有更新时的常驻指示点（不靠颜色区分状态：形状与文案在 title / 小窗里给全）。 */}
              {update && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-[var(--radius-pill)]"
                  style={{
                    background: update.ready ? 'var(--success-fg)' : 'var(--accent)',
                    boxShadow: '0 0 0 1.5px var(--bg-chrome)',
                  }}
                />
              )}
            </span>
            <span className="flex min-w-0 flex-col items-start">
              <span className="text-[13px] font-[var(--weight-emphasize)] leading-tight text-[var(--fg)]">工作区</span>
              {/* 单行截断（参考内容区「已同步」的小字样式）：长文案省略号，不再撑成两行。 */}
              <span className="t-2xs w-full truncate-1 text-left leading-tight text-[var(--muted)]">{syncLine}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label="设置"
            title="设置"
            onClick={onOpenSettings}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent-text)]"
            style={NO_DRAG}
          >
            <Settings size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {/* 工作区弹层：挂在 body（fixed 定位），物理上不可能跑出窗口框。
          1.3.0：页面操作也收进来了——更新区 → 操作 → 同步状态 → 主题 → 帮助/更新日志/诊断。
          内容变长时内部滚动，480px 最小窗高下也不会顶出屏幕。
          两条硬规则：①收起时不渲染——aside 宽 0 会把它裁成"看不见但仍在命中"
          的隐形盲区，正好盖住首列卡片（2026-10-05 用户实测）；②自身必须 no-drag。 */}
      {syncPop && !collapsed &&
        createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="工作区"
          className="tl-scroll fixed bottom-[64px] left-2 z-[var(--z-dropdown)] max-h-[calc(100vh-104px)] w-[236px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2.5"
          style={{
            background: 'var(--menu-bg)',
            boxShadow: 'var(--menu-elev)',
            transformOrigin: 'bottom left',
            WebkitAppRegion: 'no-drag',
          } as CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 更新区（2026-10-18）：有新版就排在最上面——这是唯一"要用户做点什么"的事。
              进度环 + 一句话，下载完再长出「立即更新并重启」。 */}
          {update && (
            <>
              <div className="flex items-center gap-3 px-2 pb-2 pt-1">
                <ProgressRing
                  percent={update.ready ? 100 : (update.percent ?? 0)}
                  label={`新版本 v${update.version} 下载进度`}
                />
                <div className="min-w-0 flex-1">
                  <p className="t-sm w-emph m-0 truncate-1 text-[var(--fg)]">新版本 v{update.version}</p>
                  <p className="t-2xs m-0 text-[var(--fg-2)]">
                    {update.ready ? '已下载完成，可以立即安装' : '正在后台下载，你可以继续用'}
                  </p>
                </div>
              </div>
              {update.ready && (
                <Button
                  tone="primary"
                  size="sm"
                  fullWidth
                  icon={Download}
                  className="mb-1"
                  onClick={onInstallUpdate}
                >
                  立即更新并重启
                </Button>
              )}
              <div className="mx-1 my-1.5 h-px bg-[var(--border-subtle)]" />
            </>
          )}

          {/* 操作（1.3.0）：与工作栏同一份动作列表；不可用时把原因写在第二行。 */}
          {mode !== 'home' && actions.length > 0 && (
            <>
              <div className="t-2xs mb-1.5 px-1 text-[var(--meta)]">操作</div>
              {actions.map((a) => (
                <MenuItem
                  key={a.id}
                  icon={a.icon}
                  label={a.label}
                  detail={a.disabledReason ?? undefined}
                  disabled={Boolean(a.disabledReason)}
                  onSelect={() => {
                    setSyncPop(false);
                    a.onSelect();
                  }}
                />
              ))}
              <div className="mx-1 my-1.5 h-px bg-[var(--border-subtle)]" />
            </>
          )}

          <div className="t-2xs mb-1.5 px-1 text-[var(--meta)]">同步状态</div>
          {mode !== 'personal' && snapshot ? (
            <>
              <SyncIndicator snapshot={snapshot} />
              <div className="px-2 pb-2 pt-1 text-xs text-[var(--muted)]">{syncPresentation(snapshot).line2 ?? '本机已缓存'}</div>
              <MenuItem
                icon={RotateCw}
                label="刷新团队入口"
                onSelect={() => {
                  setSyncPop(false);
                  onRefresh();
                }}
              />
            </>
          ) : (
            /* 2026-10-18 用户要求：这句话太长、占地，降级成小字低亮（信息保留，不再抢视线）。
               它仍是"我的入口不上云"的唯一说明，所以只改样式不删。 */
            <div className="px-2 py-1 t-2xs text-[var(--meta)]">
              {mode === 'personal' ? '本机入口只存在这台电脑上，不参与团队同步' : '尚未连接同步服务。'}
            </div>
          )}
          <div className="mx-1 my-1.5 h-px bg-[var(--border-subtle)]" />

          {/* 明暗主题（2026-10-18 用户要求）：与 设置·通用 用同一个控件（ThemePicker），
              窄容器里走图标态，文字进 aria-label / title。 */}
          <div className="flex h-8 w-full items-center gap-2 px-3 text-[var(--fg)]">
            <SunMoon size={16} strokeWidth={2} aria-hidden className="shrink-0" />
            <span className="t-sm min-w-0 flex-1">明暗主题</span>
            <ThemePicker value={settings.theme} onChange={(v) => void patch({ theme: v })} compact />
          </div>
          <MenuItem
            icon={RefreshCw}
            label={updateChecking ? '正在检测…' : '检测版本更新'}
            disabled={updateChecking}
            ariaLabel={updateChecking ? '正在检测版本更新' : '检测版本更新'}
            onSelect={() => {
              setSyncPop(false);
              onCheckUpdate?.();
            }}
          />
          {/* 2026-10-18：按用户要求补两个入口——帮助（快捷键速查 + 使用说明）与更新日志。 */}
          <MenuItem
            icon={CircleHelp}
            label="查看帮助"
            onSelect={() => {
              setSyncPop(false);
              onOpenHelp?.();
            }}
          />
          <MenuItem
            icon={ScrollText}
            label="查看更新日志"
            onSelect={() => {
              setSyncPop(false);
              onOpenChangelog?.();
            }}
          />
          <MenuItem
            icon={Stethoscope}
            label="查看诊断"
            onSelect={() => {
              setSyncPop(false);
              onOpenDiagnostics();
            }}
          />

        </div>,
        document.body
      )}

      {groupMenu && onGroupAction && groupMenuState && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          note={groupMenuState.note}
          items={[
            { id: 'rename', label: '重命名分组…', disabled: !groupMenuState.canManage, onSelect: () => onGroupAction(groupMenu.group, 'open') },
            { id: 'up', label: '上移一位', disabled: !groupMenuState.canMoveUp, onSelect: () => onGroupAction(groupMenu.group, 'up') },
            { id: 'down', label: '下移一位', disabled: !groupMenuState.canMoveDown, onSelect: () => onGroupAction(groupMenu.group, 'down') },
            /* 排序接替原「更多操作」菜单（用户明确要求移除该菜单）：个人页的全局粗排序住在这。 */
            ...(mode === 'personal'
              ? [{ id: 'sortByName', label: '全部分组按名称排序', onSelect: () => onGroupAction(groupMenu.group, 'sortByName') }]
              : []),
            { id: 'delete', label: '删除分组…', destructive: true, disabled: !groupMenuState.canManage, onSelect: () => onGroupAction(groupMenu.group, 'open') },
          ]}
          onClose={() => setGroupMenu(null)}
        />
      )}
    </aside>
  );
}
