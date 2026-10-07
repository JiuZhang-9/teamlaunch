/**
 * 分组操作：重命名 / 上移 / 下移 / 删除。
 *
 * 此前这个入口只弹一句"尚未开放"——因为 editStore 里根本没有分组级操作。
 * 现在能力补齐（editStore 的 renameGroup / moveGroup / removeGroup），界面也做成真的。
 *
 * 两条纪律：
 *  - 到边界的移动**禁用**而不是"点了没反应"；
 *  - 删除分组会连带删掉组内入口，所以做**两段确认**，不做一键删除。
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { Dialog } from './Dialog.tsx';

export interface GroupActionsDialogProps {
  groupName: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** 组内入口数量：删除前必须让用户知道会连带删掉多少。 */
  entryCount: number;
  /** 页面归属：删除提示的文案跟着变（团队页 / 我的入口），共用组件不能写死一边。 */
  scope: 'team' | 'personal';
  onRename(name: string): void;
  onMove(delta: -1 | 1): void;
  onRemove(): void;
  onCancel(): void;
}

const PAGE_LABEL = { team: '团队页', personal: '我的入口' } as const;

export function GroupActionsDialog({
  groupName, canMoveUp, canMoveDown, entryCount, scope, onRename, onMove, onRemove, onCancel,
}: GroupActionsDialogProps) {
  const [name, setName] = useState(groupName);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const renamed = name.trim() !== groupName;

  return (
    <Dialog title={`「${groupName}」分组`} width="normal" onClose={onCancel}>
      <label className="mb-1 block t-xs text-[var(--fg-2)]" htmlFor="group-rename">
        分组名称
      </label>
      <div className="mb-3 flex items-center gap-2">
        {/* Input 原子恒为 w-full：给它一个可收缩的弹性外壳，重命名按钮才不会被挤成竖排。 */}
        <div className="min-w-0 flex-1">
          <Input
            id="group-rename"
            value={name}
            aria-label="分组名称"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          tone="secondary"
          className="shrink-0"
          softDisabled={!renamed || name.trim().length === 0}
          onClick={() => {
            onRename(name.trim());
            onCancel();
          }}
        >
          重命名
        </Button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Button tone="ghost" icon={ArrowUp} disabled={!canMoveUp} onClick={() => onMove(-1)}>
          上移
        </Button>
        <Button tone="ghost" icon={ArrowDown} disabled={!canMoveDown} onClick={() => onMove(1)}>
          下移
        </Button>
        <span className="t-xs text-[var(--meta)]">调整分组在页面中的先后顺序</span>
      </div>

      {!confirmingRemove ? (
        <Button tone="danger" icon={Trash2} onClick={() => setConfirmingRemove(true)}>
          删除分组
        </Button>
      ) : (
        <div className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3">
          <p className="t-sm mb-2 text-[var(--danger-fg)]">
            {entryCount > 0
              ? `删除后，这个分组以及组内的 ${entryCount} 个入口都会从${PAGE_LABEL[scope]}移除。`
              : `删除后，这个分组会从${PAGE_LABEL[scope]}移除。`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              tone="danger"
              icon={Trash2}
              onClick={() => {
                onRemove();
                onCancel();
              }}
            >
              确认删除
            </Button>
            <Button tone="ghost" onClick={() => setConfirmingRemove(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
