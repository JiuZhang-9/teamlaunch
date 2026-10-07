/**
 * V-05 管理员编辑态 —— 四重信号的"内容区"部分。
 *
 * 信号 1（内容底色 --surface-editing）与信号 4（卡片边框 + 常驻句柄/编辑/删除）
 * 落在这一层；信号 2（侧栏徽标）与信号 3（EditActionBar）由外壳渲染。
 * 四重缺一不可：管理员滚到页面中段、看不到侧栏和底栏时，也必须知道自己还在编辑态。
 */
import { EllipsisVertical, Megaphone, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../components/atoms/Button.tsx';
import { Banner } from '../components/molecules/Banner.tsx';
import { GroupSections } from '../components/organisms/GroupSections.tsx';
import { GroupActionsDialog } from '../components/organisms/GroupActionsDialog.tsx';
import type { ContextMenuItem } from '../components/molecules/ContextMenu.tsx';
import { useEdit } from '../store/editStore.tsx';
import { useFeedback } from '../store/feedbackStore.tsx';
import { useFavorites } from '../store/favoriteStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import type { Entry } from '../../shared/schema/entry.ts';
import type { Group } from '../../shared/schema/group.ts';

import { CAPACITY } from '../../shared/schema/common.ts';

export function AdminEditView() {
  const { draft, removeEntry, moveEntry, moveEntryToGroup, renameGroup, moveGroup, removeGroup } = useEdit();
  const { runtime, openEntry, copyTarget, openEntryEditor, relocateEntry, openDialog, selected, toggleSelected } = useWorkbench();
  const { pendingIds } = useFeedback();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { push } = useToasts();
  /** 待操作的分组（打开分组操作对话框用）。 */
  const [actingGroup, setActingGroup] = useState<Group | null>(null);
  const groups = draft?.groups ?? [];
  const ids = useMemo(() => groups.flatMap((g) => g.entries.map((e) => e.id)), [groups]);
  const total = ids.length;
  const nearLimit = groups.length >= CAPACITY.MAX_GROUPS - 1 || total >= CAPACITY.MAX_ENTRIES - 20;

  const menuFor = (entry: Entry): ContextMenuItem[] => [
    { id: 'open', label: '打开', onSelect: () => void openEntry(entry) },
    { id: 'copy', label: entry.type === 'web' ? '复制链接' : '复制路径', onSelect: () => void copyTarget(entry) },
    // 重编辑取代"重命名 + 编辑类型与目标"两项（用户要求）：与创建时同一套编辑器，
    // 名字/说明/类型/路径/网址一次改全。上下移动已由拖拽与 Alt+↑/↓ 承担。
    { id: 'edit', label: '重编辑', onSelect: () => openEntryEditor({ mode: 'edit', entry, scope: 'team' }) },
    { id: 'chain', label: selected.some((e) => e.id === entry.id) ? '从连锁清单移出' : '加入连锁清单', onSelect: () => toggleSelected(entry) },
    { id: 'favorite', label: isFavorite(entry.id) ? '取消收藏' : '收藏', onSelect: () => void toggleFavorite(entry.id) },
    // 应用类入口的本机解析可能找不到/找错：重新定位常驻右键，选一次即覆盖本机缓存（2026-10-05 用户拍板）。
    { id: 'relocate', label: '在本机重新定位…', onSelect: () => void relocateEntry(entry) },
    { id: 'remove', label: '删除', destructive: true, onSelect: () => removeEntry(entry.id) },
  ];

  const headerExtra = (group: Group) => (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        tone="ghost"
        icon={Plus}
        onClick={() => openEntryEditor({ mode: 'create', groupId: group.id, scope: 'team' })}
        aria-label={`在「${group.name}」中添加入口`}
      >
        在此组添加
      </Button>
      <Button
        size="sm"
        tone="ghost"
        icon={EllipsisVertical}
        aria-label={`「${group.name}」分组操作`}
        onClick={() => setActingGroup(group)}
      />
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-end">
        <Button tone="secondary" size="sm" icon={Megaphone} onClick={() => openDialog('announcements')}>
          公告管理
        </Button>
      </div>
      {nearLimit && (
        <Banner
          tone="warn"
          title={`团队页已接近整理上限（${CAPACITY.MAX_GROUPS} 组 / ${CAPACITY.MAX_ENTRIES} 项），建议先合并相似分组`}
          className="mb-2 rounded-[var(--radius-md)] border"
        />
      )}
      {groups.length === 0 && (
        <p className="t-sm py-8 text-center text-[var(--muted)]">
          这个团队配置还没有分组。用侧栏的「新建分组」开始整理。
        </p>
      )}
      <GroupSections
        groups={groups}
        source="team"
        mode="editing"
        runtime={runtime}
        onOpen={(entry) => void openEntry(entry)}
        onEdit={(entry) => openEntryEditor({ mode: 'edit', entry, scope: 'team' })}
        onDelete={(entry) => removeEntry(entry.id)}
        menuFor={menuFor}
        headerExtra={headerExtra}
        onReorder={(entry, delta) => moveEntry(entry.id, delta)}
        draggable
        isFavoriteOf={isFavorite}
        onToggleFavorite={(entry) => void toggleFavorite(entry.id)}
        onDropEntry={(id, toGroupId, toIndex) => moveEntryToGroup(id, toGroupId, toIndex)}
        pendingFeedbackIds={pendingIds}
      />

      {actingGroup && (
        <GroupActionsDialog
          groupName={actingGroup.name}
          canMoveUp={groups.findIndex((g) => g.id === actingGroup.id) > 0}
          canMoveDown={groups.findIndex((g) => g.id === actingGroup.id) < groups.length - 1}
          entryCount={actingGroup.entries.length}
          scope="team"
          onRename={(name) => renameGroup(actingGroup.id, name)}
          onMove={(delta) => {
            moveGroup(actingGroup.id, delta);
            setActingGroup(null);
          }}
          onRemove={() => {
            removeGroup(actingGroup.id);
            push({ title: `已删除分组「${actingGroup.name}」`, tone: 'info' });
          }}
          onCancel={() => setActingGroup(null)}
        />
      )}
    </div>
  );
}
