/**
 * V-02 我的入口页 —— 本机可编辑，**永不跨设备同步**。
 * 因此本页工具栏没有 SyncIndicator，也不得出现任何"同步中/已同步"字样。
 */
import { EllipsisVertical, FolderPlus, Layers, Plus, ScanSearch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../bridge/index.ts';
import { useEntryPicker } from '../hooks/useEntryPicker.ts';
import { Button } from '../components/atoms/Button.tsx';
import { GroupActionsDialog } from '../components/organisms/GroupActionsDialog.tsx';
import { CardStatsBar } from '../components/molecules/CardStatsBar.tsx';
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
import { useSettings } from '../store/settingsStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { entryLimitCopy } from '../../shared/capacity-copy.ts';
import type { Group } from '../../shared/schema/group.ts';
import type { Entry } from '../../shared/schema/entry.ts';

type Pending = { kind: 'delete'; entry: Entry } | null;
type MoveTarget = { entry: Entry; fromGroupId: string } | null;

export function PersonalEntriesView() {
  const { config, usage, removeEntry, removeEntries, addCopy, addCopies, moveEntry, renameGroup, moveGroup, removeGroup, sortEntriesInGroup, moveEntryToGroup, moveEntriesToGroup } = usePersonal();
  const { runtime, openEntry, copyTarget, copyManyTargets, openEntryEditor, relocateEntry, typeFilter, selecting, selected, toggleSelected, addSelected, clearSelected, launchChain, openDialog } = useWorkbench();
  const { pendingIds } = useFeedback();
  const { isFavorite, toggleFavorite, setFavoriteMany } = useFavorites();
  const { settings } = useSettings();
  const { push } = useToasts();
  const { addApp, addFolder } = useEntryPicker();
  const [pending, setPending] = useState<Pending>(null);
  /** 多选批量的删除确认与移动目标（与单条两个状态分开，语义不混）。 */
  const [pendingBatch, setPendingBatch] = useState<Entry[] | null>(null);
  const [movingBatch, setMovingBatch] = useState<Entry[] | null>(null);
  /** 待操作的分组（分组头 ⋯ 菜单用）。 */
  const [actingGroup, setActingGroup] = useState<Group | null>(null);
  /** 待移动的入口（移动到分组对话框用）。 */
  const [moving, setMoving] = useState<MoveTarget>(null);
  /**
   * 个人入口文件读不出来（R25，2026-10-17）：主进程会把配置回落成空，若不说明，
   * 界面就和"本来没有入口"完全一样——那是在把一次失败画成正常空状态。
   */
  const [corrupt, setCorrupt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.personal
      .corruption()
      .then((c) => {
        if (!cancelled) setCorrupt(c.corrupt ? (c.reason ?? '未知原因') : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const allGroups = config.groups;
  const filtering = typeFilter.length > 0;
  const groups = filtering
    ? allGroups.map((g) => ({ ...g, entries: g.entries.filter((e) => typeFilter.includes(e.type)) }))
    : allGroups;
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  /** 撞上限时「创建副本」同样会新增入口，必须一起前置禁用。口径只算入口数（与分组数无关）。 */
  const capacityReason = usage.atEntryLimit ? entryLimitCopy(usage) : null;

  /* 文件损坏提示（R25）：常驻、可关闭——它不是一次性事件，关掉只是不想再看到。
     两行文案必须给出下一步（Banner 的纪律）：原文件没被动过，修好重启即可恢复。 */
  const [corruptDismissed, setCorruptDismissed] = useState(false);
  const corruptNotice = corrupt !== null && !corruptDismissed && (
    <Banner
      tone="danger"
      title="个人入口文件读不出来，界面暂时按空列表显示"
      detail={`原因：${corrupt}。磁盘上的原文件没有被改动，修好后重启应用即可恢复（%APPDATA%\\TeamLaunch\\config\\personal.json）。`}
      className="mb-3 rounded-[var(--radius-md)] border"
      onDismiss={() => setCorruptDismissed(true)}
    />
  );

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

  /**
   * 多选批量菜单：右键落在"已选中的卡片"上、且清单里不止一条时启用。
   * 只有一条选中时仍走单条菜单——不能把「重编辑 / 在本机重新定位」这些单条动作藏起来。
   */
  const batchMenuFor = (entry: Entry): ContextMenuItem[] => {
    const items = selected;
    const n = items.length;
    const ids = items.map((e) => e.id);
    const allFav = items.every((e) => isFavorite(e.id));
    const group = groups.find((g) => g.entries.some((e) => e.id === entry.id));
    const list: ContextMenuItem[] = [
      {
        id: 'batch-open',
        label: `打开 ${n} 项`,
        /* 与连锁启动同一条链路：逐个打开、间隔 chainIntervalMs、失败汇总不中断。 */
        onSelect: () => void launchChain(settings.chainIntervalMs),
      },
      { id: 'batch-copy', label: `复制 ${n} 项链接/路径`, onSelect: () => void copyManyTargets(items) },
      {
        id: 'batch-favorite',
        label: `${allFav ? '取消收藏' : '收藏'} ${n} 项`,
        onSelect: () => {
          void setFavoriteMany(ids, !allFav);
          push({ title: allFav ? `已取消收藏 ${n} 项` : `已收藏 ${n} 项`, tone: 'info' });
        },
      },
      { id: 'batch-move', label: `移动到分组…（${n} 项）`, onSelect: () => setMovingBatch(items) },
      {
        id: 'batch-copy-entry',
        label: `创建 ${n} 个副本`,
        // 副本也是新增入口，撞上限时禁用并给出原因（与单条「创建副本」同规矩）。
        disabled: Boolean(capacityReason),
        onSelect: () => {
          void addCopies(ids).then((r) => {
            push(r.ok ? { title: `已创建 ${r.added} 个副本`, tone: 'success' } : { title: r.reason ?? '没能创建副本', tone: 'warn' });
          });
        },
      },
      { id: 'batch-delete', label: `删除 ${n} 项`, destructive: true, onSelect: () => setPendingBatch(items) },
      {
        id: 'batch-select-group',
        label: '全选本组',
        disabled: !group,
        onSelect: () => {
          if (group) addSelected(group.entries);
        },
      },
      { id: 'batch-clear', label: '清空清单', onSelect: () => clearSelected() },
    ];
    return list;
  };

  const menuFor = (entry: Entry): ContextMenuItem[] => {
    if (selected.length >= 2 && selected.some((e) => e.id === entry.id)) return batchMenuFor(entry);
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
      <>
        {corruptNotice}
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
                <Button tone="ghost" icon={ScanSearch} onClick={() => openDialog('scanPicker')}>
                  扫描本机程序
                </Button>
                <Button tone="ghost" icon={Layers} onClick={() => openDialog('batchAdd')}>
                  批量添加
                </Button>
              </>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {corruptNotice}
      {capacityReason && (
        // hover 说明只对鼠标用户存在；撞上限是持久状态，必须常驻可见。
        <Banner tone="warn" title={capacityReason} className="mb-3 rounded-[var(--radius-md)] border" />
      )}

      {/* 卡片统计（2026-10-17）：总数 + 按类型分列；筛选生效时显示筛选后的数量。 */}
      <CardStatsBar groups={groups} />

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
        /* 点组名直接改名（2026-10-18 用户要求）。同名/空名在 store 之上由这里拦住并说明——
           分组名同时是侧栏锚点 id 与批量添加的落点键，重名会让"去哪一组"变得不确定。 */
        onRenameGroup={(group, name) => {
          if (groups.some((g) => g.id !== group.id && g.name === name)) {
            push({ title: `已有名为「${name}」的分组了，换一个名字`, tone: 'warn' });
            return;
          }
          void renameGroup(group.id, name);
        }}
        selecting={selecting && !filtering}
        selectionOrderOf={(id) => {
          const i = selected.findIndex((e) => e.id === id);
          return i >= 0 ? i + 1 : null;
        }}
        onToggleSelect={toggleSelected}
        isFavoriteOf={isFavorite}
        onToggleFavorite={(entry) => void toggleFavorite(entry.id)}
        draggable={!filtering}
        onDropEntry={
          filtering
            ? undefined
            : (id, toGroupId, toIndex) => {
                /* 多选整块拖拽（2026-10-17 批 4）：被拖的卡在连锁清单里且不止一张 → 整块移动
                   （保持页面顺序）；连锁清单本身的顺序不因此改变。 */
                const ids = selected.some((e) => e.id === id) && selected.length > 1
                  ? selected.map((e) => e.id)
                  : [id];
                void moveEntriesToGroup(ids, toGroupId, toIndex);
              }
        }
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
          /* 「整理」：只重排本组入口（2026-10-18 用户要求加进分组菜单）。 */
          onSortEntriesByName={() => {
            const g = actingGroup;
            void sortEntriesInGroup(g.id).then(() => {
              push({ title: `「${g.name}」已按名称重排`, tone: 'info' });
            });
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

      {/* 多选批量删除：问一次、删一批（不逐条弹确认）。 */}
      {pendingBatch && (
        <ConfirmDialog
          title={`删除这 ${pendingBatch.length} 项？`}
          detail={`删除后这台电脑上就找不到它们了，团队入口不受影响。${
            pendingBatch.length <= 5 ? `\n（${pendingBatch.map((e) => e.name).join('、')}）` : ''
          }`}
          confirmLabel={`删除 ${pendingBatch.length} 项`}
          destructive
          onCancel={() => setPendingBatch(null)}
          onConfirm={() => {
            const list = pendingBatch;
            setPendingBatch(null);
            void removeEntries(list.map((e) => e.id));
            push({ title: `已删除 ${list.length} 项`, tone: 'info' });
          }}
        />
      )}

      {/* 多选批量移动到同一分组：目标组里确实已包含整批时也没关系，等于把它们挪到组尾。 */}
      {movingBatch && (
        <Dialog title={`把 ${movingBatch.length} 项移动到…`} width="normal" onClose={() => setMovingBatch(null)}>
          <div role="listbox" aria-label="目标分组" className="flex flex-col">
            {groups.map((g) => (
              <MenuItem
                key={g.id}
                role="menuitem"
                label={g.name}
                detail={`${g.entries.length} 项`}
                onSelect={() => {
                  const list = movingBatch;
                  setMovingBatch(null);
                  void moveEntriesToGroup(list.map((e) => e.id), g.id);
                  push({ title: `已把 ${list.length} 项移动到「${g.name}」`, tone: 'success' });
                }}
              />
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
