/**
 * Sidebar —— 左侧 240px 导航与操作栏（2026-10-02 定稿：V2 工作区条形态）。
 *
 * 自上而下：导航（两入口页，选中态 = 左侧 3px 竖条 + accent tint 底）
 *   → 分组锚点（组名 + 计数，点击平滑滚动到对应组头；**分组多了这一段自己滚**，不挤压下面）
 *   → 随模式切换的主操作（team=编辑模式入口；editing=pill+撤销/新建；personal=新建/添加/导入/导出）
 *   → 弹性空白（app-region: drag）
 *   → V2 工作区条：[工作区方块 + 双行文案] ｜ 设置齿轮（点击工作区条弹出窗口内同步弹层）
 *
 * 折叠：collapsed 时整条 width→0 完全消失（非图标栏形态），内部固定 240 宽防挤压；
 * 弹性空白与底部区声明 app-region: drag，与顶部 TitleBar 一起构成"整条左侧都能拖窗口"。
 * 可拖区域内的交互元素必须逐个 no-drag。
 *
 * 底部固定（2026-10-17）：工作区条/设置永远可见——**中段（分组 + 操作）整段用 ScrollArea 吸收
 * 高度**，两侧只留导航、32px 拖拽条与底部条为固定项（480 最小窗高下固定 ≈ 217px）。
 * 只让分组滚是不够的：固定项本身就会超过最小窗高（实测 474 > 440），底部仍会被推出可视区。
 */
import { Bookmark, FileDown, FileUp, FolderPlus, Layers, Pencil, Plus, ScanSearch, Settings, Undo2, type LucideIcon } from 'lucide-react';
import { ContextMenu } from '../molecules/ContextMenu.tsx';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import { syncPresentation } from '../../services/syncCopy.ts';
import type { Group } from '../../../shared/schema/group.ts';
import type { SyncSnapshot } from '../../bridge/types.ts';
import { Button } from '../atoms/Button.tsx';
import { ScrollArea } from '../atoms/ScrollArea.tsx';
import { useToasts } from '../../store/toastStore.tsx';
import { StatusPill } from '../molecules/StatusPill.tsx';
import { SyncIndicator } from '../molecules/SyncIndicator.tsx';
import { PageTabs } from './PageTabs.tsx';
import type { TabKey } from '../../store/workbenchStore.tsx';

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
  onOpenSettings(): void;
  onOpenDiagnostics(): void;
  onRefresh(): void;
  /** 个人页：与团队编辑态同构的两个主按钮（统一性，用户明确要求）。 */
  onAddPersonalGroup(): void;
  onAddPersonalEntry(): void;
  /** 个人页的两条批量入口：多行粘贴 / 扫描本机程序（入口点扫描）。 */
  onBatchAddPersonal(): void;
  onScanPersonal(): void;
  /** 团队编辑态的「批量添加」：同款对话框，落点进草稿（与个人页对称）。 */
  onBatchAddTeam(): void;
  /** 从浏览器书签导入（个人页，只读本机书签文件）。 */
  onImportBookmarks(): void;
  /**
   * 非空 = 该动作不可用的原因（容量撞上限）。**按动作分开**（2026-10-17 用户反馈）：
   * 「新建分组」只受分组上限约束；「添加入口 / 批量添加 / 扫描程序」只受入口上限约束——
   * 此前四件事共用一个 OR 门控，8 组时连还剩 181 个入口额度也用不了，属过度拦截。
   * 用 softDisabled 而非原生 disabled：按钮留在 tab 序列里，键盘用户能聚焦到它
   * 并读到为什么按不动，否则他只会遇到一个"点了没反应"的按钮。
   */
  addGroupDisabledReason?: string | null;
  addEntryDisabledReason?: string | null;
  onImport(): void;
  onExport(): void;
  /** 团队编辑态 */
  onUndo(): void;
  onAddGroup(): void;
  onAddEntry(): void;
  /** 本机是管理员角色时，团队页显示可见的编辑入口（此前只有隐藏热键能进编辑，无人知晓）。 */
  showEditEntry?: boolean;
  onToggleEdit(): void;
  collapsed?: boolean;
  /**
   * 分组锚点右键菜单的动作出口：open=打开分组操作对话框，up/down=换序，
   * sortByName=全部分组按名称排序（仅个人页）。只读团队页（mode==='team'）也传此 prop，
   * 但菜单项一律禁用并给出说明——"看得见能力在哪、也看得见为什么按不动"；
   * 菜单位置的禁用只是表象，真正的写入守卫在 editStore（非编辑态不写草稿）。
   */
  onGroupAction?(group: Group, action: 'open' | 'up' | 'down' | 'sortByName'): void;
}

/** 侧栏里的行式操作按钮：整行可点、左对齐、主文字色（用户反馈"太细不够亮"后的定稿）。 */
function SidebarAction({
  icon,
  children,
  ...rest
}: { icon: LucideIcon; children: ReactNode } & Omit<React.ComponentProps<typeof Button>, 'icon' | 'children'>) {
  return (
    <Button
      tone="ghost"
      size="sm"
      icon={icon}
      iconSize={16}
      fullWidth
      className="justify-start text-[var(--fg)]"
      style={{ height: 'var(--sidebar-action-h, 32px)' }}
      {...rest}
    >
      {children}
    </Button>
  );
}

function SectionCap({ children }: { children: ReactNode }) {
  return <div className="t-2xs px-3 pb-1 pt-0.5 text-[var(--meta)]">{children}</div>;
}

export function Sidebar(props: SidebarProps) {
  const {
    tab, mode, onTabChange, groups, snapshot, onOpenSettings, onOpenDiagnostics, onRefresh,
    onAddPersonalGroup, onAddPersonalEntry, onBatchAddPersonal, onScanPersonal, onBatchAddTeam, onImportBookmarks,
    addGroupDisabledReason = null, addEntryDisabledReason = null, onImport, onExport,
    onUndo, onAddGroup, onAddEntry, showEditEntry = false, onToggleEdit, collapsed = false, editLocked = false,
  onGroupAction,
  } = props;
  const { push } = useToasts();
  /** 撞上限的按钮点下去要说话：点击被 softDisabled 挡下是设计，但静默就是"点了没反应"。 */
  const blockReason = (reason?: string | null): void => {
    if (reason) push({ title: reason, tone: 'warn' });
  };
  const reduced = useReducedMotion();
  const [syncPop, setSyncPop] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  /** 分组锚点的右键菜单（重命名/删除，动作经 onGroupAction 交给外壳分发）。 */
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: Group } | null>(null);

  useEffect(() => {
    if (collapsed) setSyncPop(false);
  }, [collapsed]);

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

        {/* 中段（分组锚点 + 随模式切换的操作）**整段可滚**：窗口小或分组多时由它让出空间，
            底部工作区条/设置永远钉在可视区里（2026-10-17 用户反馈：分组一多底部就被挤下去）。
            只让分组滚不够——480 最小窗高下"分组 + 操作区"的固定高度本身就超（474 > 440），
            所以两段一起滚才是完备解。 */}
        <ScrollArea
          className="mt-[var(--space-3)] min-h-0 flex-1"
          ariaLabel="侧栏中段"
        >
          {mode !== 'home' && (
            <div className="border-t border-[var(--border-subtle)] px-[var(--sidebar-pad)] pt-[var(--space-2)]">
              <SectionCap>分组</SectionCap>
              {groups.length === 0 ? (
                <div className="px-3 pb-1 text-[13px] text-[var(--meta)]">暂无分组</div>
              ) : (
                groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => goGroup(g.name)}
                    onContextMenu={(e) => {
                      if (!onGroupAction) return;
                      e.preventDefault();
                      setGroupMenu({ x: e.clientX, y: e.clientY, group: g });
                    }}
                    className="flex h-7 w-full items-center gap-2 truncate rounded-[var(--radius-sm)] px-3 text-[13px] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
                    title={`定位到分组「${g.name}」`}
                  >
                    <span className="truncate-1">{g.name}</span>
                    <span className="ml-auto text-xs text-[var(--meta)]">{g.entries.length}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="mt-[var(--space-3)] flex flex-col gap-1 border-t border-[var(--border-subtle)] px-[var(--sidebar-pad)] pt-[var(--space-2)]">
          {mode === 'editing' && (
            <>
              <SectionCap>编辑操作</SectionCap>
              {/* 「编辑模式」是开关而不是纯徽标：再点一次即退出编辑（外观保持徽标形态）。
                  此前它不可点，鼠标用户只能滑到底部「放弃改动」，既费事又容易误点；
                  快捷键 Ctrl+Shift+E 与「放弃改动」都保留，三条路都走同一个 toggleEdit
                  （退出前照旧过"放弃未发布的改动？"确认）。 */}
              <button
                type="button"
                aria-pressed
                aria-label="退出编辑模式"
                title="退出编辑模式"
                onClick={onToggleEdit}
                className="block w-full rounded-[var(--radius-pill)] text-left transition-opacity duration-[var(--motion-fast)] hover:opacity-90 focus-visible:shadow-[var(--ring-focus)]"
              >
                <StatusPill tone="draft" icon={Pencil} iconSize={16} className="w-full justify-start">
                  编辑模式
                </StatusPill>
              </button>
              <SidebarAction icon={Undo2} onClick={onUndo}>
                撤销
              </SidebarAction>
              {/* 团队草稿同样有容量前置门控（2026-10-17）：此前没有守卫，草稿能超到发布才被 413 拦。 */}
              <SidebarAction
                icon={FolderPlus}
                onClick={onAddGroup}
                softDisabled={Boolean(addGroupDisabledReason)}
                title={addGroupDisabledReason ?? undefined}
                aria-describedby={addGroupDisabledReason ? 'tl-capacity-reason-group' : undefined}
                onDisabledClick={() => blockReason(addGroupDisabledReason)}
              >
                新建分组
              </SidebarAction>
              <SidebarAction
                icon={Plus}
                onClick={onAddEntry}
                softDisabled={Boolean(addEntryDisabledReason)}
                title={addEntryDisabledReason ?? undefined}
                aria-describedby={addEntryDisabledReason ? 'tl-capacity-reason-entry' : undefined}
                onDisabledClick={() => blockReason(addEntryDisabledReason)}
              >
                新建入口
              </SidebarAction>
              <SidebarAction
                icon={Layers}
                onClick={onBatchAddTeam}
                softDisabled={Boolean(addEntryDisabledReason)}
                title={addEntryDisabledReason ?? undefined}
                aria-describedby={addEntryDisabledReason ? 'tl-capacity-reason-entry' : undefined}
                onDisabledClick={() => blockReason(addEntryDisabledReason)}
              >
                批量添加
              </SidebarAction>
              {/* 「更多编辑操作」菜单已移除：内容与上方行按钮完全重复。
                  退出编辑有三个入口：上方「编辑模式」开关（再点一次）、Ctrl+Shift+E、底部「放弃改动」。 */}
            </>
          )}

          {mode === 'team' && showEditEntry && (
            <>
              <SectionCap>操作</SectionCap>
              <SidebarAction icon={Pencil} onClick={onToggleEdit}>
                编辑模式
              </SidebarAction>
            </>
          )}

          {mode === 'personal' && (
            <>
              <SectionCap>本机管理</SectionCap>
              <SidebarAction
                icon={FolderPlus}
                onClick={onAddPersonalGroup}
                softDisabled={Boolean(addGroupDisabledReason)}
                title={addGroupDisabledReason ?? undefined}
                aria-describedby={addGroupDisabledReason ? 'tl-capacity-reason-group' : undefined}
                onDisabledClick={() => blockReason(addGroupDisabledReason)}
              >
                新建分组
              </SidebarAction>
              <SidebarAction
                icon={Plus}
                onClick={onAddPersonalEntry}
                softDisabled={Boolean(addEntryDisabledReason)}
                title={addEntryDisabledReason ?? undefined}
                aria-describedby={addEntryDisabledReason ? 'tl-capacity-reason-entry' : undefined}
                onDisabledClick={() => blockReason(addEntryDisabledReason)}
              >
                添加入口
              </SidebarAction>
              {/* 两条"批量"入口：贴多行 / 扫本机。只受入口上限约束（与分组数无关）。 */}
              <SidebarAction
                icon={Layers}
                onClick={onBatchAddPersonal}
                softDisabled={Boolean(addEntryDisabledReason)}
                title={addEntryDisabledReason ?? undefined}
                onDisabledClick={() => blockReason(addEntryDisabledReason)}
              >
                批量添加
              </SidebarAction>
              <SidebarAction
                icon={ScanSearch}
                onClick={onScanPersonal}
                softDisabled={Boolean(addEntryDisabledReason)}
                title={addEntryDisabledReason ?? undefined}
                onDisabledClick={() => blockReason(addEntryDisabledReason)}
              >
                扫描程序
              </SidebarAction>
              {/* 从浏览器书签导入（2026-10-17）：同样只受入口上限约束。 */}
              <SidebarAction
                icon={Bookmark}
                onClick={onImportBookmarks}
                softDisabled={Boolean(addEntryDisabledReason)}
                title={addEntryDisabledReason ?? undefined}
                onDisabledClick={() => blockReason(addEntryDisabledReason)}
              >
                导入书签
              </SidebarAction>
              <SidebarAction icon={FileUp} onClick={onImport}>
                导入设置
              </SidebarAction>
              <SidebarAction icon={FileDown} onClick={onExport}>
                导出设置
              </SidebarAction>
            </>
          )}
          {/* 禁用原因必须能被读屏读到：hover 只对鼠标用户存在。
              放在两个模式块之外：个人页与团队编辑态共用同一条容量口径（原因只在对应该模式时非空）。 */}
          {addGroupDisabledReason && (
            <span id="tl-capacity-reason-group" className="sr-only" role="status">
              {addGroupDisabledReason}
            </span>
          )}
          {addEntryDisabledReason && (
            <span id="tl-capacity-reason-entry" className="sr-only" role="status">
              {addEntryDisabledReason}
            </span>
          )}
          </div>
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
            onClick={() => setSyncPop((v) => !v)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-left transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
            style={NO_DRAG}
          >
            <span
              className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] text-[11px] font-[var(--weight-emphasize)]"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}
              aria-hidden
            >
              工
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

      {/* 同步弹层：挂在侧栏内部（absolute），物理上不可能跑出窗口框。
          内容 = 同步状态 + 刷新 + 分隔 + 诊断（关于只在 设置·关于 与标题栏版本号，
          三处入口是重复，用户定稿 2026-10-05 只保留前两处）。
          两条硬规则：①收起时不渲染——aside 宽 0 会把它裁成"看不见但仍在命中"
          的隐形盲区，正好盖住首列卡片（2026-10-05 用户实测）；②自身必须 no-drag——
          它垫在弹性空白的拖拽区上面，不声明 no-drag 整个弹层的行都点不动。 */}
      {/* 弹层经 portal 挂到 body（fixed 定位）：aside 宽 240 装不下这个宽度的弹层，
          留在侧栏里右缘必被 overflow 裁掉（2026-10-05 用户发现右缘缺一块）；portal 后永不被裁。 */}
      {syncPop && !collapsed &&
        createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="工作区与同步"
          className="fixed bottom-[64px] left-2 z-[var(--z-dropdown)] w-[236px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2.5"
          style={{
            background: 'var(--menu-bg)',
            boxShadow: 'var(--menu-elev)',
            transformOrigin: 'bottom left',
            WebkitAppRegion: 'no-drag',
          } as CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="t-2xs mb-1.5 px-1 text-[var(--meta)]">同步状态</div>
          {mode !== 'personal' && snapshot ? (
            <>
              <SyncIndicator snapshot={snapshot} />
              <div className="px-2 pb-2 pt-1 text-xs text-[var(--muted)]">{syncPresentation(snapshot).line2 ?? '本机已缓存'}</div>
              <button
                type="button"
                onClick={() => {
                  setSyncPop(false);
                  onRefresh();
                }}
                className="flex h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-[13px] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
              >
                ↻ 刷新团队入口
              </button>
            </>
          ) : (
            <div className="px-2 py-1 text-[13px] text-[var(--fg)]">
              {mode === 'personal' ? '本机入口保存在这台电脑上，不参与团队同步。' : '尚未连接同步服务。'}
            </div>
          )}
          <div className="mx-1 my-1.5 h-px bg-[var(--border-subtle)]" />
          <button
            type="button"
            onClick={() => {
              setSyncPop(false);
              onOpenDiagnostics();
            }}
            className="flex h-8 w-full items-center rounded-[var(--radius-sm)] px-2 text-[13px] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
          >
            查看诊断
          </button>

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

