/**
 * DialogRouter —— 主窗口的对话框路由，从 MainWindowShell 拆出以保持单文件 ≤300 行。
 *
 * 常态对话框（设置 / 发布 / 反馈 / 诊断 / 解锁）由 workbenchStore 的 `dialog` 单点控制；
 * 导入结果与退出确认是局部瞬态，由外壳持有状态、这里只负责渲染。
 *
 * 隐私门是特例：未确认隐私说明时它是**阻塞层**，必须盖在其它对话框之上（AC-18）。
 */
import { api } from '../../bridge/index.ts';
import { AdminUnlockDialogView } from '../../pages/AdminUnlockDialogView.tsx';
import { EntryEditDialogView } from '../../pages/EntryEditDialogView.tsx';
import { ImportDialog } from './ImportDialog.tsx';
import { ConfirmDialog } from './SimpleDialog.tsx';
import { useEdit } from '../../store/editStore.tsx';
import { usePersonal, type ImportChoice, type ImportOutcome } from '../../store/personalStore.tsx';
import { useToasts } from '../../store/toastStore.tsx';
import { MiniPaletteView } from '../../pages/MiniPaletteView.tsx';
import { AnnouncementsEditorDialog } from './AnnouncementsEditorDialog.tsx';
import { HelpDialog } from './HelpDialog.tsx';
import { PublishDialogView } from '../../pages/PublishDialogView.tsx';
import { SettingsPanelView } from '../../pages/SettingsPanelView.tsx';
import { FeedbackDialogView } from '../../pages/FeedbackDialogView.tsx';
import { PrivacyGateView } from '../../pages/PrivacyGateView.tsx';
import { DiagnosticsPage } from '../../pages/DiagnosticsPage.tsx';

export interface DialogRouterProps {
  /** workbenchStore 的当前对话框标识 */
  dialog: string | null;
  /** 真实热键注册状态（由外壳订阅主进程推送得出），设置页展示用 */
  hotkeyConflict?: boolean;
  feedbackTargetId: string | null;
  closeDialog(): void;
  dirtyCount: number;
  revision: number;
  /** 未确认隐私说明：隐私门升级为阻塞层 */
  gateBlocking: boolean;
  miniOpen: boolean;
  onMiniClose(): void;
  onLocate(entryId: string): void;
  // ---- 局部瞬态 ----
  confirmExit: boolean;
  onCancelExit(): void;
  onConfirmExit(): void;
  importOutcome: ImportOutcome;
  onDismissImport(): void;
  onRetryImport(): void;
  /** 提交后仍有未决定的冲突（极罕见：预览与提交之间数据变了）—— 重新弹一次 */
  onResolveAgain?(outcome: Extract<ImportOutcome, { kind: 'conflict' }>): void;
  /** 提交被容量闸拦下：必须呈现为失败，绝不能说"导入成功" */
  onImportFailed?(reason: string): void;
}

export function DialogRouter({
  dialog, hotkeyConflict = false, feedbackTargetId, closeDialog,
  dirtyCount, revision, gateBlocking, miniOpen, onMiniClose,
  onLocate,
  confirmExit, onCancelExit, onConfirmExit,
  importOutcome, onDismissImport, onRetryImport, onResolveAgain, onImportFailed,
}: DialogRouterProps) {
  const edit = useEdit();
  const { resolveImport } = usePersonal();
  const { push } = useToasts();

  return (
    <>
      {/* 入口编辑器（管理员草稿的新建/编辑），挂在最外层：编辑模式下随时可打开 */}
      <EntryEditDialogView />

      {dialog === 'settings' && <SettingsPanelView hotkeyConflict={hotkeyConflict} onClose={closeDialog} />}

      {dialog === 'publish' && <PublishDialogView onClose={closeDialog} onLocate={onLocate} />}

      {dialog === 'feedback' && feedbackTargetId && (
        <FeedbackDialogView entryId={feedbackTargetId} onClose={closeDialog} />
      )}

      {dialog === 'diagnostics' && <DiagnosticsPage onClose={closeDialog} />}

      {dialog === 'shortcuts' && <HelpDialog onClose={closeDialog} />}

      {dialog === 'announcements' && <AnnouncementsEditorDialog onClose={closeDialog} />}

      {dialog === 'adminUnlock' && (
        <AdminUnlockDialogView
          onCancel={closeDialog}
          onUnlocked={() => {
            closeDialog();
            edit.beginEdit();
          }}
        />
      )}

      {importOutcome?.kind === 'error' && (
        <ImportDialog
          mode="error"
          error={{ message: importOutcome.error, line: importOutcome.line }}
          onClose={onDismissImport}
          onCopyError={() => void api.clipboard.write(importOutcome.error)}
          onRetryFile={onRetryImport}
        />
      )}

      {importOutcome?.kind === 'conflict' && (
        <ImportDialog
          mode="conflict"
          conflicts={importOutcome.conflicts.map((c) => ({ id: c.id, name: c.name, existingName: c.existingName }))}
          onClose={onDismissImport}
          onContinue={(choices: Record<string, ImportChoice>) => {
            void resolveImport(choices).then((outcome) => {
              // 提交也可能失败：文件合法、无冲突，但合并后撞上容量上限。
              // 预览过了不代表能写，所以这里必须按 outcome 分支，不能一律报成功。
              if (outcome?.kind === 'applied') {
                onDismissImport();
                const r = outcome;
                push({ title: `已导入 ${r.added + r.copied + r.overwritten} 个入口`, tone: 'success' });
                return;
              }
              if (outcome?.kind === 'conflict') {
                onResolveAgain?.(outcome);
                return;
              }
              onImportFailed?.(outcome?.kind === 'error' ? outcome.error : '导入未能完成，个人入口未做任何改动');
            });
          }}
        />
      )}

      {confirmExit && (
        <ConfirmDialog
          title="放弃未发布的改动？"
          detail={`有 ${dirtyCount} 项编辑尚未发布。放弃后团队页仍显示当前版本 v${revision}，本机草稿会被清空。`}
          confirmLabel="放弃改动"
          cancelLabel="继续编辑"
          destructive
          onCancel={onCancelExit}
          onConfirm={onConfirmExit}
        />
      )}

      {gateBlocking && <PrivacyGateView fromSettings={false} />}
      {!gateBlocking && dialog === 'privacy' && <PrivacyGateView fromSettings onDone={closeDialog} />}

      <MiniPaletteView open={miniOpen} onClose={onMiniClose} />
    </>
  );
}
