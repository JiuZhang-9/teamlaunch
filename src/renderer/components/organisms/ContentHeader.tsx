/**
 * ContentHeader —— 内容区顶部 48px 一行：搜索 · 工作栏动作 · 类型筛选 · 刷新。
 *
 * 1.3.0（2026-10-27 用户要求）：侧栏收起时也要能直接操作，不必先展开侧栏再点。
 * 动作列表由外壳统一构建（与左下工作区弹窗同一份数据）；这里只负责"能放几个"：
 *  - 放得下的渲染成按钮；
 *  - 放不下的进最后一位「更多」下拉；
 *  - 宽度用 ResizeObserver + 隐藏测量行实测，不猜文字宽度。
 *
 * 侧栏化定稿（2026-10-02）：同步状态移入左下角工作区弹层；这一行只留"作用于当前页内容"的东西。
 * Ctrl+F 由外壳派发 `tl:focus-search`，这里负责聚焦并全选。
 */
import { EllipsisVertical, ListChecks, RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { SearchInput } from '../atoms/SearchInput.tsx';
import { MenuButton } from './MenuButton.tsx';
import { TypeFilterButton } from './TypeFilterButton.tsx';
import { syncPresentation } from '../../services/syncCopy.ts';
import { useToasts } from '../../store/toastStore.tsx';
import { fitItems } from '../../../shared/toolbar-overflow.ts';
import type { ToolbarAction } from '../../lib/toolbar-actions.ts';
import type { SyncSnapshot } from '../../bridge/types.ts';
import type { EntryType } from '../../../shared/schema/entry.ts';
import type { TabKey } from '../../store/workbenchStore.tsx';

const GAP = 4;

export interface ContentHeaderProps {
  tab: TabKey;
  /** editing 时隐藏类型筛选（编辑态拖拽排序期间改可见性会让落点错位）。 */
  mode: 'team' | 'editing' | 'personal';
  query: string;
  onQueryChange(v: string): void;
  snapshot: SyncSnapshot | null;
  onRefresh(): void;
  typeFilter: EntryType[];
  onToggleTypeFilter(t: EntryType): void;
  onClearTypeFilter(): void;
  /** 多选连锁启动（2026-10-05）：仅团队只读/个人页提供；编辑态有自己的操作体系。 */
  selecting?: boolean;
  onToggleSelecting?(): void;
  /** 工作栏动作（2026-10-27，1.3.0）：与工作区弹窗共用同一份数据。 */
  actions?: ToolbarAction[];
  /** 搜索框聚焦/失焦（1.4.0）：聚焦且未输入时，内容区显示固定 + 最近打开的快速打开面板。 */
  onSearchFocus?(): void;
  onSearchBlur?(): void;
}

export function ContentHeader(props: ContentHeaderProps) {
  const {
    tab, mode, query, onQueryChange, snapshot, onRefresh, typeFilter, onToggleTypeFilter, onClearTypeFilter,
    selecting, onToggleSelecting, actions = [], onSearchFocus, onSearchBlur,
  } = props;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);
  const [widths, setWidths] = useState<number[]>([]);
  const [moreWidth, setMoreWidth] = useState(72);
  const { push } = useToasts();

  useEffect(() => {
    const onFocusSearch = () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('tl:focus-search', onFocusSearch);
    return () => window.removeEventListener('tl:focus-search', onFocusSearch);
  }, []);

  /* 可用宽度：动作容器是 flex-1 min-w-0，宽度由布局分配、与内容无关——量它最准。 */
  useLayoutEffect(() => {
    const el = actionsRef.current;
    if (!el) return;
    const update = () => setAvailable(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 实测每个动作按钮与「更多」按钮的宽度（隐藏测量行，不影响布局）。
     比较后再 setState：动作数组即使每次渲染换身份，也不会因为同宽反复触发重渲染。 */
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const children = Array.from(el.children) as HTMLElement[];
    const nextWidths = children.slice(0, actions.length).map((c) => c.getBoundingClientRect().width);
    const nextMore = children[actions.length]?.getBoundingClientRect().width ?? 72;
    setWidths((prev) =>
      prev.length === nextWidths.length && prev.every((w, i) => Math.abs(w - nextWidths[i]) < 0.5) ? prev : nextWidths,
    );
    setMoreWidth((prev) => (Math.abs(prev - nextMore) < 0.5 ? prev : nextMore));
  }, [actions]);

  const fit = useMemo(() => fitItems(widths, available, GAP, moreWidth), [widths, available, moreWidth]);
  /* 测量完成前先全部显示（布局效果在首帧绘制前就会纠正）：
     否则首帧会只剩一个「更多」，看起来像所有按钮都消失了。 */
  const measured = widths.length === actions.length && available > 0;
  const visible = measured ? actions.slice(0, fit.visibleCount) : actions;
  const hidden = measured ? actions.slice(fit.visibleCount) : [];

  /** 容量撞上限的动作点了要说话：静默挡下就是"点了没反应"。 */
  const blockReason = (reason?: string | null) => {
    if (reason) push({ title: reason, tone: 'warn' });
  };

  const actionButton = (action: ToolbarAction, measuring = false) => (
    <Button
      key={action.id}
      tone="ghost"
      size="sm"
      icon={action.icon}
      iconSize={16}
      softDisabled={Boolean(action.disabledReason)}
      title={action.disabledReason ?? undefined}
      onDisabledClick={() => blockReason(action.disabledReason)}
      onClick={action.onSelect}
      tabIndex={measuring ? -1 : undefined}
      className="shrink-0"
    >
      {action.label}
    </Button>
  );

  const canRefresh = snapshot ? syncPresentation(snapshot).refreshEnabled : true;

  return (
    <div
      className="relative flex h-[var(--content-header-h)] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-[var(--space-6)]"
      style={{ background: 'var(--bg-surface)' }}
    >
      <SearchInput
        ref={searchRef}
        variant="toolbar"
        /* 上限 420（原工具栏只有 280）：侧栏化后横向空间由内容区独占，搜索是最大的受益者。 */
        className="min-w-[160px] max-w-[420px] flex-1"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={onSearchFocus}
        onBlur={onSearchBlur}
        aria-label="搜索入口"
        placeholder={tab === 'team' ? '搜索团队入口' : '搜索我的入口'}
      />

      {/* 工作栏动作：能放下的直接显示，其余进「更多」。
          只裁剪按钮行本身（overflow-hidden 兜住亚像素误差）；「更多」按钮放在裁剪区外，
          否则它弹出的下拉菜单会被一起裁掉（实测过一版就是这样）。 */}
      <div ref={actionsRef} className="flex min-w-0 flex-1 items-center gap-1" aria-label="页面操作">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {visible.map((a) => actionButton(a))}
        </div>
        {hidden.length > 0 && (
          <MenuButton
            ariaLabel="更多操作"
            label="更多"
            icon={EllipsisVertical}
            align="right"
            items={hidden.map((a) => ({
              id: a.id,
              label: a.label,
              disabledReason: a.disabledReason,
              onSelect: a.onSelect,
            }))}
          />
        )}
      </div>

      {/* 隐藏测量行：与可见按钮完全同款；invisible + 绝对定位，不参与布局也不吃点击。 */}
      {actions.length > 0 && (
        <div
          ref={measureRef}
          aria-hidden
          className="pointer-events-none invisible absolute left-0 top-0 flex items-center"
          style={{ gap: GAP }}
        >
          {actions.map((a) => actionButton(a, true))}
          <Button tone="ghost" size="sm" icon={EllipsisVertical} iconSize={20} tabIndex={-1}>
            更多
          </Button>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {mode !== 'editing' && (
          <>
            <TypeFilterButton value={typeFilter} onToggle={onToggleTypeFilter} onClear={onClearTypeFilter} />
            <Button
              tone="ghost"
              icon={ListChecks}
              selected={selecting}
              aria-label="多选连锁启动"
              onClick={onToggleSelecting}
            >
              多选
            </Button>
          </>
        )}

        {mode !== 'personal' && (
          <Button
            tone="ghost"
            icon={RefreshCw}
            iconSize={20}
            aria-label="刷新团队入口"
            softDisabled={!canRefresh}
            onClick={onRefresh}
          />
        )}
      </div>
    </div>
  );
}
