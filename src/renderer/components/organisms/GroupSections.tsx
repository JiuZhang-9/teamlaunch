/**
 * 分组 + 卡片网格的组合（V-01 / V-02 / V-05 共用）。
 *
 * 组间距 24（首组 0）；卡片尺寸恒定 152×132，列数由 CardGrid 按可用宽度推导。
 * 右键菜单的条目由调用方注入——只读页 / 我的入口 / 编辑态能对入口做的事不同，
 * 这个差异不能写死在这里。
 */
import { useState, type MouseEvent } from 'react';
import { useRef } from 'react';
import { CardGrid } from '../molecules/CardGrid.tsx';
import { ContextMenu, type ContextMenuItem } from '../molecules/ContextMenu.tsx';
import { EntryCard, type CardMode } from '../molecules/EntryCard.tsx';
import { GroupHeader } from '../molecules/GroupHeader.tsx';
import type { EntryRuntime } from '../../store/workbenchStore.tsx';
import type { Entry } from '../../../shared/schema/entry.ts';
import type { Group } from '../../../shared/schema/group.ts';
import type { ReactNode } from 'react';

export interface GroupSectionsProps {
  groups: Group[];
  source: 'team' | 'personal';
  mode: CardMode;
  runtime: Record<string, EntryRuntime>;
  onOpen(entry: Entry): void;
  onEdit?(entry: Entry): void;
  onDelete?(entry: Entry): void;
  menuFor(entry: Entry): ContextMenuItem[];
  headerExtra?(group: Group): ReactNode;
  /** Alt+↑/↓ 组内重排序（个人页与编辑态各接各的 store）。 */
  onReorder?(entry: Entry, delta: -1 | 1): void;
  /** HTML5 拖拽（个人页与编辑态）：落点 = 组 + 插入位置。只读团队页不启用。 */
  draggable?: boolean;
  /** 类型筛选生效中：空组显示"没有此类型的入口"而不是拖放占位。 */
  filtering?: boolean;
  /** 多选连锁启动（2026-10-05）：selecting 时不打开、点击=按顺序加入清单。 */
  selecting?: boolean;
  /** 返回 1 基启动顺序；未选中返回 null。 */
  selectionOrderOf?(entryId: string): number | null;
  onToggleSelect?(entry: Entry): void;
  /** 收藏星（2026-10-05）：常驻右上，空心/黄色实心。 */
  isFavoriteOf?(entryId: string): boolean;
  onToggleFavorite?(entry: Entry): void;
  onDropEntry?(entryId: string, toGroupId: string, toIndex: number): void;
  pendingFeedbackIds?: Set<string>;
}

export function GroupSections({
  groups, source, mode, runtime, onOpen, onEdit, onDelete, menuFor, headerExtra, onReorder, draggable = false, onDropEntry, filtering = false, pendingFeedbackIds, selecting = false, selectionOrderOf, onToggleSelect, isFavoriteOf, onToggleFavorite,
}: GroupSectionsProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null);
  // 跨网格共享的拖拽 id：getData() 在非受信任事件里拿不到，靠这条 ref 传递。
  const draggingIdRef = useRef<string | null>(null);

  return (
    <div className="flex flex-col">
      {groups.map((g, gi) => (
        <section key={g.id} style={{ marginTop: gi === 0 ? 0 : 'var(--space-6)' }}>
          <GroupHeader id={`tl-group-${encodeURIComponent(g.name)}`} name={g.name} count={g.entries.length} right={headerExtra?.(g)} />
          {filtering && g.entries.length === 0 && (
            <p className="t-xs py-3 text-[var(--meta)]">这个分组没有所选类型的入口</p>
          )}
          <div className="mt-2">
            <CardGrid
              items={g.entries}
              getKey={(e) => e.id}
              onReorder={onReorder}
              dragEnabled={draggable && !filtering && !selecting}
              onDropEntry={onDropEntry ? (id, idx) => onDropEntry(id, g.id, idx) : undefined}
              onDragStartEntry={(id) => {
                draggingIdRef.current = id;
              }}
              externalDraggingId={() => draggingIdRef.current}
              onDragEndEntry={() => {
                draggingIdRef.current = null;
              }}
              ariaLabel={`${g.name} 分组入口`}
              onActivate={onOpen}
              render={(entry, focus) => {
                const rt = runtime[entry.id];
                return (
                  <EntryCard
                    ref={focus.cardRef}
                    entry={entry}
                    source={source}
                    mode={mode}
                    tabIndex={focus.tabIndex}
                    phase={rt?.phase === 'opening' ? 'opening' : rt?.phase === 'failed' ? 'failed' : 'idle'}
                    failure={rt?.failure}
                    drag={focus.drag}
                    selecting={selecting}
                    selectionOrder={selecting && selectionOrderOf ? selectionOrderOf(entry.id) : null}
                    onToggleSelect={onToggleSelect ? () => onToggleSelect(entry) : undefined}
                    favorite={isFavoriteOf ? isFavoriteOf(entry.id) : false}
                    onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(entry) : undefined}
                    pendingFeedback={pendingFeedbackIds?.has(entry.id) ?? false}
                    onOpen={() => onOpen(entry)}
                    onEdit={onEdit ? () => onEdit(entry) : undefined}
                    onDelete={onDelete ? () => onDelete(entry) : undefined}
                    onKeyDown={focus.onKeyDown}
                    onContextMenu={(e: MouseEvent) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, entry });
                    }}
                  />
                );
              }}
            />
          </div>
        </section>
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.entry)} onClose={() => setMenu(null)} />}
    </div>
  );
}
