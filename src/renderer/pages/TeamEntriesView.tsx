/**
 * V-01 团队入口页 —— 只读。
 *
 * 本页**绝不出现** plus / pencil / trash / grip-vertical 中的任何一个（AC-01 / AC-16）。
 * 隐藏编辑入口只是易用性，不是安全边界——真正的校验在服务端。
 *
 * 两个最容易误报的点：
 *  - 有缓存但配置里 0 个入口 → 正常空状态，不是故障；
 *  - 没有缓存（OFFLINE_EMPTY / NEVER_SYNCED）→ 「暂时无法获取团队入口」+ 手动刷新 + 我的入口。
 */
import { CloudOff, LayoutGrid } from 'lucide-react';
import { api } from '../bridge/index.ts';
import { Button } from '../components/atoms/Button.tsx';
import { GroupSections } from '../components/organisms/GroupSections.tsx';
import type { ContextMenuItem } from '../components/molecules/ContextMenu.tsx';
import { EmptyBlock } from '../components/molecules/EmptyBlock.tsx';
import { syncPresentation } from '../services/syncCopy.ts';
import { useEdit } from '../store/editStore.tsx';
import { useFeedback } from '../store/feedbackStore.tsx';
import { useSettings } from '../store/settingsStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useFavorites } from '../store/favoriteStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import type { Entry } from '../../shared/schema/entry.ts';

export function TeamEntriesView() {
  const { snapshot, refresh } = useSync();
  const { runtime, openEntry, copyTarget, openFeedback, relocateEntry, selecting, selected, toggleSelected, setTab, openDialog, openEntryEditor, typeFilter } = useWorkbench();
  const edit = useEdit();
  const { settings } = useSettings();
  const { pendingIds } = useFeedback();
  const { isFavorite, toggleFavorite } = useFavorites();
  const p = syncPresentation(snapshot);
  const allGroups = snapshot.config?.groups ?? [];
  const filtering = typeFilter.length > 0;
  // 筛选只影响可见性：组永远保留，未选中类型的入口被隐藏。
  const groups = filtering
    ? allGroups.map((g) => ({ ...g, entries: g.entries.filter((e) => typeFilter.includes(e.type)) }))
    : allGroups;
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  const isAdmin = settings.role === 'admin';

  /** 空状态的管理员动作：解锁后直接进编辑态并打开新建对话框（PRD §13「添加第一个入口」）。 */
  const addFirstEntry = () => {
    if (!edit.unlocked) {
      openDialog('adminUnlock');
      return;
    }
    edit.beginEdit();
    openEntryEditor({ mode: 'create', groupId: null, scope: 'team' });
  };

  const menuFor = (entry: Entry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      { id: 'open', label: '打开', onSelect: () => void openEntry(entry) },
      { id: 'copy', label: entry.type === 'web' ? '复制链接' : '复制路径', onSelect: () => void copyTarget(entry) },
    ];
    if (entry.type === 'web') {
      items.push({
        id: 'browser',
        label: '在浏览器中打开',
        onSelect: () => void api.entries.openExternal(entry.url),
      });
    }
    if (entry.type === 'app') {
      // 员工机上团队应用入口的安装位置常与管理员不同：重新定位是本机自愈的主通道。
      items.push({ id: 'relocate', label: '在本机重新定位…', onSelect: () => void relocateEntry(entry) });
    }
    items.push({
      id: 'chain',
      label: selected.some((e) => e.id === entry.id) ? '从连锁清单移出' : '加入连锁清单',
      onSelect: () => toggleSelected(entry),
    });
    items.push({
      id: 'favorite',
      label: isFavorite(entry.id) ? '取消收藏' : '收藏',
      onSelect: () => void toggleFavorite(entry.id),
    });
    items.push({ id: 'feedback', label: '反馈给管理员', onSelect: () => openFeedback(entry.id) });
    return items;
  };

  if (!p.renderable) {
    const neverSynced = snapshot.state === 'NEVER_SYNCED';
    return (
      <div className="flex h-full items-center">
        <EmptyBlock
          icon={CloudOff}
          title={neverSynced ? '尚未获取团队入口' : '暂时无法获取团队入口'}
          detail={
            neverSynced
              ? '还没有成功获取过团队入口。稍后会自动重试，你也可以手动刷新。'
              : '可以先用我的入口，或稍后手动刷新。（顶部已说明连不上的原因）'
          }
          actions={
            <>
              <Button tone="secondary" onClick={() => void refresh()}>
                手动刷新
              </Button>
              <Button tone="ghost" onClick={() => setTab('personal')}>
                去看看我的入口
              </Button>
            </>
          }
        />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex h-full items-center">
        <EmptyBlock
          icon={LayoutGrid}
          title="团队入口还没有内容"
          detail="管理员还没有发布任何入口。你可以先使用我的入口。"
          actions={
            isAdmin ? (
              <>
                <Button tone="primary" onClick={addFirstEntry}>
                  添加第一个入口
                </Button>
                <Button tone="ghost" onClick={() => setTab('personal')}>
                  去看看我的入口
                </Button>
              </>
            ) : (
              <Button tone="ghost" onClick={() => setTab('personal')}>
                去看看我的入口
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <GroupSections
      groups={groups}
      source="team"
      mode="readonly"
      runtime={runtime}
      onOpen={(entry) => void openEntry(entry)}
      menuFor={menuFor}
      filtering={filtering}
      selecting={selecting && !filtering}
      selectionOrderOf={(id) => {
        const i = selected.findIndex((e) => e.id === id);
        return i >= 0 ? i + 1 : null;
      }}
      onToggleSelect={toggleSelected}
      isFavoriteOf={isFavorite}
      onToggleFavorite={(entry) => void toggleFavorite(entry.id)}
      pendingFeedbackIds={pendingIds}
    />
  );
}
