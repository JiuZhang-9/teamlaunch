/**
 * 管理员口令对话框的视图层：持有 status 查询，把三态分发给 AdminUnlockDialog。
 *
 * 状态放在这一层而不是塞回 MainWindowShell：外壳已经 299 行，再塞异步会破 300 行上限；
 * 而且"这台机器能不能设置口令"是宿主状态，不是窗口布局的一部分。
 *
 * 关键纪律：
 *  - enroll / unlock 成功后**直接进入已解锁**，绝不要求用户再输一遍口令；
 *  - 开启管理员角色后必须**重新查一次 status**：否则界面会停在引导态，
 *    用户以为开启无效（角色切换后主进程会重新装配服务，状态随之变化）。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../bridge/index.ts';
import { AdminUnlockDialog } from '../components/organisms/AdminUnlockDialog.tsx';
import { useEdit } from '../store/editStore.tsx';
import { useSettings } from '../store/settingsStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import type { AdminStatus } from '../bridge/types.ts';

export interface AdminUnlockDialogViewProps {
  onCancel(): void;
  onUnlocked(): void;
}

export function AdminUnlockDialogView({ onCancel, onUnlocked }: AdminUnlockDialogViewProps) {
  const edit = useEdit();
  const { settings, patch } = useSettings();
  const { push } = useToasts();
  const [status, setStatus] = useState<AdminStatus | null>(null);

  const reload = useCallback(async () => {
    setStatus(null);
    const s = await api.admin.status();
    setStatus(s);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <AdminUnlockDialog
      status={status}
      onCancel={onCancel}
      onEnableAdmin={async () => {
        if (settings.role === 'admin') return true;
        // 角色切换后主进程会重新装配（起内嵌服务 / 起同步客户端），随后 status 才会变成可设置。
        await patch({ role: 'admin' });
        await reload();
        push({ title: '已开启管理员角色，现在可以设置团队口令了', tone: 'success' });
        return true;
      }}
      onEnroll={async (passphrase) => {
        const r = await api.admin.enroll(passphrase);
        if (r.ok) {
          // 设置成功即解锁：内部走一次 unlock 建立会话，界面上不再让用户输第二遍
          await edit.unlock(passphrase);
          onUnlocked();
          push({ title: '管理员口令已设置，已进入编辑模式', tone: 'success' });
        }
        return r;
      }}
      onUnlock={async (passphrase) => {
        const r = await api.admin.unlock(passphrase);
        if (r.ok) {
          await edit.unlock(passphrase);
          onUnlocked();
          push({ title: '已进入管理员编辑模式', tone: 'success' });
        }
        return r;
      }}
    />
  );
}
