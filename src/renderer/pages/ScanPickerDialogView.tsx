/**
 * 「扫描本机程序」对话框的宿主：打开即扫，扫完交给勾选对话框。
 *
 * 扫描范围＝入口点（开始菜单 / 桌面 / 任务栏固定项 / 注册表已安装程序），
 * 只读目录与注册表、不遍历磁盘（用户 2026-09-29 拍板）。扫描期间给一句"正在扫描"，
 * 失败/空结果由 useEntryPicker 统一提示后关掉对话框——不摆一个空列表在那里。
 */
import { useEffect, useState } from 'react';
import { Dialog } from '../components/organisms/Dialog.tsx';
import { ScanPickerDialog } from '../components/organisms/ScanPickerDialog.tsx';
import { useEntryPicker } from '../hooks/useEntryPicker.ts';
import { usePersonal } from '../store/personalStore.tsx';
import type { ScanCandidate } from '../bridge/types.ts';

export function ScanPickerDialogView({ onClose }: { onClose(): void }) {
  const { config } = usePersonal();
  const { scan, commitScan } = useEntryPicker();
  const [items, setItems] = useState<ScanCandidate[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void scan().then((result) => {
      if (cancelled) return;
      // null = 没扫到（原因已经 toast 过）→ 直接收起，不留空对话框
      if (result === null) onClose();
      else setItems(result);
    });
    return () => {
      cancelled = true;
    };
    // 打开即扫一次：关闭后再打开会重新扫（注册表/目录都可能变），重复扫同一会话没有意义。
  }, []);

  if (items === null) {
    return (
      <Dialog title="扫描本机程序" width="normal" onClose={onClose}>
        <p className="t-sm text-[var(--muted)]">
          正在扫描开始菜单、桌面、任务栏固定项与已安装程序…
        </p>
      </Dialog>
    );
  }

  const existing = config.groups
    .flatMap((g) => g.entries)
    .map((e) => (e.type === 'web' ? e.url : e.target));

  return (
    <ScanPickerDialog
      items={items}
      existingTargets={existing}
      onCancel={onClose}
      onConfirm={(picked) => {
        void commitScan(picked);
        onClose();
      }}
    />
  );
}
