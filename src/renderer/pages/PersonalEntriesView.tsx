/**
 * V-02 我的入口页 —— 本机可编辑，**永不跨设备同步**。
 * 因此本页工具栏没有 SyncIndicator，也不得出现任何"同步中/已同步"字样。
 */
import { EllipsisVertical, FolderPlus, Plus, ScanSearch } from 'lucide-react';
import { useState } from 'react';
import { api } from '../bridge/index.ts';
import type { ScanCandidate } from '../bridge/types.ts';
import { useEntryPicker } from '../hooks/useEntryPicker.ts';
import { Button } from '../components/atoms/Button.tsx';
import { ScanPickerDialog } from '../components/organisms/ScanPickerDialog.tsx';
import { GroupActionsDialog } from '../components/organisms/GroupActionsDialog.tsx';
import { GroupSections } from '../components/organisms/GroupSections.tsx';
import { ConfirmDialog } from '../components/organisms/SimpleDialog.tsx';
import { Dialog } from '../components/organisms/Dialog.tsx';
import { MenuItem } from '../components/molecules/MenuItem.tsx';
import type { ContextMenuItem } from '../components/molecules/ContextMenu.tsx';
import { EmptyBlock } from '../components/molecules/EmptyBlock.tsx';
import { Banner } from '../components/molecules/Banner.tsx';
import { useFeedback } from '../store/feedbackStore.tsx';
import { useFavorites } from '../store/favoriteStore.tsx';
import { usePersonal } from '../store/personalStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { capacityExceededCopy } from '../../shared/capacity-copy.ts';
import type { Group } from '../../shared/schema/group.ts';
import type { Entry } from '../../shared/schema/entry.ts';

type Pending = { kind: 'delete'; entry: Entry } | null;
type MoveTarget = { entry: Entry; fromGroupId: string } | null;

export function PersonalEntriesView() {
  const { config, usage, removeEntry, addCopy, moveEntry, renameGroup, moveGroup, removeGroup, moveEntryToGroup } = usePersonal();
  const { runtime, openEntry, copyTarget, openEntryEditor, relocateEntry, typeFilter, selecting, selected, toggleSelected } = useWorkbench();
  const { pendingIds } = useFeedback();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { push } = useToasts();
  const { addApp, addFolder, scan, commitScan } = useEntryPicker();
  const [pending, setPending] = useState<Pending>(null);
  /** 待操作的分组（分组头 ⋯ 菜单用）。 */
  const [actingGroup, setActingGroup] = useState<Group | null>(null);
  /** 待移动的入口（移动到分组对话框用）。 */
  const [moving, setMoving] = useState<MoveTarget>(null);
  /** 开始菜单扫描的候选列表；非空时展示勾选对话框。 */
  const [scanItems, setScanItems] = useState<ScanCandidate[] | null>(null);

  const allGroups = config.groups;
  const filtering = typeFilter.length > 0;
  const groups = filtering
    ? allGroups.map((g) => ({ ...g, entries: g.entries.filter((e) => typeFilter.includes(e.type)) }))
    : allGroups;
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  /** 撞上限时「创建副本」同样会新增入口，必须一起前置禁用。 */
  const capacityReason = usage.atEntryLimit ? capacityExceededCopy(usage) : null;

  /** 与团队编辑态同构：组头 = 「在此组添加」+ ⋯（重命名/换序/删除）。 */
  const headerExtra = (group: Group) => (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        tone="ghost"
        icon={Plus}
        onClick={() => openEntryEditor({ mode: 'create', groupId: group.id, scope: 'personal' })}
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

  const menuFor = (entry: Entry): ContextMenuItem[] => {
    const fromGroup = groups.find((g) => g.entries.some((e) => e.id === entry.id));
    const items: ContextMenuItem[] = [
      { id: 'open', label: '打开', onSelect: () => void openEntry(entry) },
      { id: 'copy', label: entry.type === 'web' ? '复制链接' : '复制路径', onSelect: () => void copyTarget(entry) },
      /* 重编辑取代单纯重命名（用户要求）：与创建时同一套编辑器，路径/网址/说明/名字都能改。 */
      { id: 'edit', label: '重编辑', onSelect: () => openEntryEditor({ mode: 'edit', entry, scope: 'personal' }) },
      { id: 'chain', label: selected.some((e) => e.id === entry.id) ? '从连锁清单移出' : '加入连锁清单', onSelect: () => toggleSelected(entry) },
      { id: 'favorite', label: isFavorite(entry.id) ? '取消收藏' : '收藏', onSelect: () => void toggleFavorite(entry.id) },
    ];
    if (entry.type === 'web') {
      items.push({
        id: 'browser',
        label: '在浏览器中打开',
        onSelect: () => void api.entries.openExternal(entry.url),
      });
    }
    // 应用类入口的本机解析可能找不到/找错：重新定位常驻右键，选一次即覆盖本机缓存（2026-10-05 用户拍板）。
    if (entry.type === 'app') {
      items.push({ id: 'relocate', label: '在本机重新定位…', onSelect: () => void relocateEntry(entry) });
    }

    // 移动到分组：此前入口只能留在创建时的分组里，没有任何迁移手段。
    if (groups.length > 1 && fromGroup) {
      items.push({ id: 'move', label: '移动到分组…', onSelect: () => setMoving({ entry, fromGroupId: fromGroup.id }) });
    }
    items.push(
      {
        id: 'duplicate',
        label: '创建副本',
        // 副本也是新增入口，撞上限时禁用并给出原因，不做"点了没反应"
        disabled: Boolean(capacityReason),
        onSelect: () => {
          if (capacityReason) {
            push({ title: capacityReason, tone: 'warn' });
            return;
          }
          void addCopy(entry.id);
        },
      },
      { id: 'delete', label: '删除', destructive: true, onSelect: () => setPending({ kind: 'delete', entry }) },
    );
    return items;
  };

  if (total === 0) {
    return (
      <div className="flex h-full items-center">
        <EmptyBlock
          icon={FolderPlus}
          title="我的入口还没有内容"
          detail="把常用的软件、文件夹和网页加进来，只有你能看到。"
          actions={
            <>
              <Button tone="primary" onClick={() => void addApp()}>
                从本机添加软件
              </Button>
              <Button tone="secondary" onClick={() => void addFolder()}>
                添加文件夹
              </Button>
              <Button
                tone="ghost"
                icon={ScanSearch}
                onClick={() => void scan().then((items) => items && setScanItems(items))}
              >
                扫描开始菜单程序
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return (
    <>
      {capacityReason && (
        // hover 说明只对鼠标用户存在；撞上限是持久状态，必须常驻可见。
        <Banner tone="warn" title={capacityReason} className="mb-3 rounded-[var(--radius-md)] border" />
      )}

      <GroupSections
        groups={groups}
        source="personal"
        mode="personal"
        runtime={runtime}
        onOpen={(entry) => void openEntry(entry)}
        onEdit={(entry) => openEntryEditor({ mode: 'edit', entry, scope: 'personal' })}
        onDelete={(entry) => setPending({ kind: 'delete', entry })}
        menuFor={menuFor}
        headerExtra={headerExtra}
        onReorder={(entry, delta) => void moveEntry(entry.id, delta)}
        selecting={selecting && !filtering}
        selectionOrderOf={(id) => {
          const i = selected.findIndex((e) => e.id === id);
          return i >= 0 ? i + 1 : null;
        }}
        onToggleSelect={toggleSelected}
        isFavoriteOf={isFavorite}
        onToggleFavorite={(entry) => void toggleFavorite(entry.id)}
        draggable={!filtering}
        onDropEntry={filtering ? undefined : (id, toGroupId, toIndex) => void moveEntryToGroup(id, toGroupId, toIndex)}
        filtering={filtering}
        pendingFeedbackIds={pendingIds}
      />

      {actingGroup && (
        <GroupActionsDialog
          groupName={actingGroup.name}
          canMoveUp={groups.findIndex((g) => g.id === actingGroup.id) > 0}
          canMoveDown={groups.findIndex((g) => g.id === actingGroup.id) < groups.length - 1}
          entryCount={actingGroup.entries.length}
          scope="personal"
          onRename={(name) => renameGroup(actingGroup.id, name)}
          onMove={(delta) => {
            void moveGroup(actingGroup.id, delta);
            setActingGroup(null);
          }}
          onRemove={() => {
            void removeGroup(actingGroup.id);
            setActingGroup(null);
            push({ title: `已删除分组「${actingGroup.name}」`, tone: 'info' });
          }}
          onCancel={() => setActingGroup(null)}
        />
      )}

      {moving && (
        <Dialog title={`把「${moving.entry.name}」移动到…`} width="normal" onClose={() => setMoving(null)}>
          <div role="listbox" aria-label="目标分组" className="flex flex-col">
            {groups
              .filter((g) => g.id !== moving.fromGroupId)
              .map((g) => (
                <MenuItem
                  key={g.id}
                  role="menuitem"
                  label={g.name}
                  detail={`${g.entries.length} 项`}
                  onSelect={() => {
                    void moveEntryToGroup(moving.entry.id, g.id);
                    setMoving(null);
                    push({ title: `已移动到「${g.name}」`, tone: 'success' });
                  }}
                />
              ))}
          </div>
        </Dialog>
      )}

      {scanItems && (
        <ScanPickerDialog
          items={scanItems}
          onCancel={() => setScanItems(null)}
          onConfirm={(picked) => {
            void commitScan(picked);
            setScanItems(null);
          }}
        />
      )}

      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title={`删除「${pending.entry.name}」？`}
          detail="删除后这台电脑上就找不到它了，团队入口不受影响。"
          confirmLabel="删除"
          destructive
          onCancel={() => setPending(null)}
          onConfirm={() => {
            void removeEntry(pending.entry.id);
            setPending(null);
            push({ title: `已删除「${pending.entry.name}」`, tone: 'info' });
          }}
        />
      )}
    </>
  );
}
