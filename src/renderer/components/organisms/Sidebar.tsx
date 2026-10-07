/**
 * Sidebar —— 左侧 240px 导航与操作栏（2026-10-02 定稿：V2 工作区条形态）。
 *
 * 自上而下：导航（两入口页，选中态 = 左侧 3px 竖条 + accent tint 底）
 *   → 分组锚点（组名 + 计数，点击平滑滚动到对应组头）
 *   → 随模式切换的主操作（team=编辑模式入口；editing=pill+撤销/新建；personal=新建/添加/导入/导出）
 *   → 弹性空白（app-region: drag）
 *   → V2 工作区条：[工作区方块 + 双行文案] ｜ 设置齿轮（点击工作区条弹出窗口内同步弹层）。
 *
 * 折叠：collapsed 时整条 width→0 完全消失（非图标栏形态），内部固定 240 宽防挤压；
 * 弹性空白与底部区声明 app-region: drag，与顶部 TitleBar 一起构成"整条左侧都能拖窗口"。
 * 可拖区域内的交互元素必须逐个 no-drag。
 */
import { FileDown, FileUp, FolderPlus, Pencil, Plus, Settings, Undo2, type LucideIcon } from 'lucide-react';
import { ContextMenu } from '../molecules/ContextMenu.tsx';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';
import { syncPresentation } from '../../services/syncCopy.ts';
import type { Group } from '../../../shared/schema/group.ts';
import type { SyncSnapshot } from '../../bridge/types.ts';
import { Button } from '../atoms/Button.tsx';
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
  /** 当前页的分组（外壳已按 tab/editing 选好），用于锚点区。 */
  groups: Group[];
  snapshot: SyncSnapshot | null;
  onOpenSettings(): void;
  onOpenDiagnostics(): void;
  onRefresh(): void;
  /** 个人页：与团队编辑态同构的两个主按钮（统一性，用户明确要求）。 */
  onAddPersonalGroup(): void;
  onAddPersonalEntry(): void;
  /**
   * 非空 = 「添加」不可用的原因（容量撞上限）。
   * 用 softDisabled 而非原生 disabled：按钮留在 tab 序列里，键盘用户能聚焦到它
   * 并读到为什么按不动，否则他只会遇到一个"点了没反应"的按钮。
   */
  addDisabledReason?: string | null;
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
   * 分组锚点右键菜单的动作出口（personal/editing 可用）：open=打开分组操作对话框，
   * up/down=换序，sortByName=全部分组按名称排序（仅个人页）。只读团队页不传此 prop，
   * 右键菜单即不出现。
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
    onAddPersonalGroup, onAddPersonalEntry, addDisabledReason, onImport, onExport,
    onUndo, onAddGroup, onAddEntry, showEditEntry = false, onToggleEdit, collapsed = false,
  onGroupAction,
  } = props;
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
          <PageTabs orientation="vertical" value={tab} onChange={onTabChange} />
        </nav>

        <div
          className="mt-[var(--space-3)] border-t border-[var(--border-subtle)] px-[var(--sidebar-pad)] pt-[var(--space-2)]"
          style={mode === 'home' ? { display: 'none' } : undefined}
        >
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

        <div className="mt-[var(--space-3)] flex flex-col gap-1 border-t border-[var(--border-subtle)] px-[var(--sidebar-pad)] pt-[var(--space-2)]">
          {mode === 'editing' && (
            <>
              <SectionCap>编辑操作</SectionCap>
              <StatusPill tone="draft" icon={Pencil} iconSize={16}>
                编辑模式
              </StatusPill>
              <SidebarAction icon={Undo2} onClick={onUndo}>
                撤销
              </SidebarAction>
              <SidebarAction icon={FolderPlus} onClick={onAddGroup}>
                新建分组
              </SidebarAction>
              <SidebarAction icon={Plus} onClick={onAddEntry}>
                新建入口
              </SidebarAction>
              {/* 「更多编辑操作」菜单已移除：内容与上方行按钮完全重复，退出有 Ctrl+Shift+E（用户明确要求）。 */}
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
                softDisabled={Boolean(addDisabledReason)}
                title={addDisabledReason ?? undefined}
              >
                新建分组
              </SidebarAction>
              <SidebarAction
                icon={Plus}
                onClick={onAddPersonalEntry}
                softDisabled={Boolean(addDisabledReason)}
                title={addDisabledReason ?? undefined}
                aria-describedby={addDisabledReason ? 'tl-capacity-reason' : undefined}
              >
                添加入口
              </SidebarAction>
              {/* 禁用原因必须能被读屏读到：hover 只对鼠标用户存在。 */}
              {addDisabledReason && (
                <span id="tl-capacity-reason" className="sr-only" role="status">
                  {addDisabledReason}
                </span>
              )}
              <SidebarAction icon={FileUp} onClick={onImport}>
                导入
              </SidebarAction>
              <SidebarAction icon={FileDown} onClick={onExport}>
                导出
              </SidebarAction>
            </>
          )}
        </div>

        {/* 弹性空白：侧栏中段没有交互元素，整块都可以用来拖窗口。
            注意：收起时必须彻底撤掉 drag 声明：app-region 是几何叠加，overflow 裁剪
            不取消命中——留着的话左列卡片（收起后挪进这 240px）会整块变成拖拽区，
            悬停/点击全被系统吃掉（2026-10-05 用户实测）。 */}
        <div className="min-h-[var(--space-8)] flex-1" style={collapsed ? undefined : DRAG} />

        {/* V2 工作区条（定稿）：[工作区方块+双行文案] ｜ 设置齿轮 */}
        <div
          className="flex items-center gap-1 border-t border-[var(--border-subtle)] p-2"
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

      {groupMenu && onGroupAction && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          items={[
            { id: 'rename', label: '重命名分组…', onSelect: () => onGroupAction(groupMenu.group, 'open') },
            { id: 'up', label: '上移一位', onSelect: () => onGroupAction(groupMenu.group, 'up') },
            { id: 'down', label: '下移一位', onSelect: () => onGroupAction(groupMenu.group, 'down') },
            /* 排序接替原「更多操作」菜单（用户明确要求移除该菜单）：个人页的全局粗排序住在这。 */
            ...(mode === 'personal'
              ? [{ id: 'sortByName', label: '全部分组按名称排序', onSelect: () => onGroupAction(groupMenu.group, 'sortByName') }]
              : []),
            { id: 'delete', label: '删除分组…', destructive: true, onSelect: () => onGroupAction(groupMenu.group, 'open') },
          ]}
          onClose={() => setGroupMenu(null)}
        />
      )}
    </aside>
  );
}

