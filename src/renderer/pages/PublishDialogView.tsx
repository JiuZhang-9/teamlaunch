/**
 * V-06 发布对话框的视图层：把编辑态草稿接到发布动作上。
 *
 * 失败后草稿一律保留（editStore 只在服务端 200 时清空）；
 * 「定位」只是关掉对话框并高亮目标卡片，不改变草稿。
 */
import { useEdit } from '../store/editStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { PublishDialog } from '../components/organisms/PublishDialog.tsx';

export interface PublishDialogViewProps {
  onClose(): void;
  onLocate(entryId: string): void;
}

export function PublishDialogView({ onClose, onLocate }: PublishDialogViewProps) {
  const { changes, issues, phase, lastError, publish } = useEdit();
  const { snapshot, refresh } = useSync();
  const { push } = useToasts();
  const { openDialog } = useWorkbench();
  const revision = snapshot.revision ?? 0;

  return (
    <PublishDialog
      revision={revision}
      changes={changes}
      issues={issues}
      publishing={phase === 'publishing'}
      error={lastError}
      onCancel={onClose}
      onPublish={async (summary) => {
        const outcome = await publish(summary);
        if (outcome.ok) {
          push({
            title: `已发布 v${outcome.revision}，${outcome.changedCount} 项变更`,
            tone: 'success',
          });
          onClose();
        }
      }}
      onLocate={onLocate}
      onRetry={() => {
        // 版本冲突的「重新拉取并合并」= 拉最新后让管理员在草稿上重来，绝不静默覆盖
        void refresh().then(() => {
          push({ title: '已重新拉取团队数据，请确认改动后再次发布', tone: 'info' });
          onClose();
        });
      }}
      onOpenSettings={() => {
        onClose();
        openDialog('settings');
      }}
      onOpenDiagnostics={() => {
        onClose();
        openDialog('diagnostics');
      }}
    />
  );
}
