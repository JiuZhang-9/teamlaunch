/**
 * PublishDialog（V-06）—— 先展示校验与变更摘要，确认后才真正发布（AC-06）。
 *
 * 红线：
 *  - 打开时焦点落在**发布说明输入框**，不落在发布按钮（避免连按 Enter 误发布）；
 *  - 宽度恒定 480，问题列表展开时只内部滚动，绝不改变宽度；
 *  - 失败后**草稿一律保留**，只有服务端 200 才清空。
 */
import {
  CircleCheck, CircleMinus, CirclePlus, CircleX, CloudUpload, Crosshair, Pencil, RotateCcw, TriangleAlert,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { MenuItem } from '../molecules/MenuItem.tsx';
import { StatusPill } from '../molecules/StatusPill.tsx';
import { Dialog } from './Dialog.tsx';
import type { PublishError } from '../../bridge/types.ts';
import type { ChangeSet, PublishIssue } from '../../lib/publish.ts';
import { changeLabel } from '../../lib/publish.ts';

export interface PublishDialogProps {
  revision: number;
  changes: ChangeSet;
  issues: PublishIssue[];
  publishing: boolean;
  error: PublishError | null;
  onCancel(): void;
  onPublish(summary: string): void;
  onLocate(entryId: string): void;
  onRetry(): void;
  onOpenSettings(): void;
  onOpenDiagnostics(): void;
}

/** 失败文案：每条都写清"现在是什么情况 + 下一步能做什么"，不出现英文错误码。 */
type FailureCopy = { tone: 'warn' | 'danger'; title: string; detail?: string };

function failureCopy(error: PublishError, revision: number): FailureCopy {
  switch (error) {
    case 'REVISION_CONFLICT':
      return {
        tone: 'warn',
        title: `团队数据已被更新到 v${revision + 1}，你的改动基于 v${revision}`,
        detail: '不会自动覆盖。重新拉取并合并后，无法自动合并的字段会列出来让你选。',
      };
    case 'INSTANCE_MISMATCH':
      return { tone: 'danger', title: '连的不是同一个团队数据源（instanceId 不一致）' };
    case 'SIGNATURE_INVALID':
      return { tone: 'danger', title: '签名校验未通过，请重新启用管理员模式' };
    case 'VALIDATION_FAILED':
      return { tone: 'danger', title: '服务端拒绝了这份配置，请检查各入口的字段' };
    case 'PAYLOAD_TOO_LARGE':
      return { tone: 'danger', title: '配置超过上限（1MB / 8 组 / 200 项），请合并分组后再发布' };
    case 'RATE_LIMITED':
      return { tone: 'warn', title: '操作太频繁，请稍后再试' };
    case 'NETWORK_UNREACHABLE':
      return { tone: 'danger', title: '发不到管理员电脑，改动仍保存在本机' };
  }
}

export function PublishDialog(props: PublishDialogProps) {
  const {
    revision, changes, issues, publishing, error, onCancel, onPublish, onLocate, onRetry, onOpenSettings, onOpenDiagnostics,
  } = props;
  const [summary, setSummary] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ added: true, modified: true, removed: false });
  const summaryRef = useRef<HTMLInputElement | null>(null);

  const total = changes.added.length + changes.modified.length + changes.removed.length;
  const clean = issues.length === 0;
  const failure = error ? failureCopy(error, revision) : null;

  const groups: Array<{
    key: 'added' | 'modified' | 'removed';
    icon: typeof CirclePlus;
    label: string;
    list: ChangeSet['added'];
  }> = [
    { key: 'added', icon: CirclePlus, label: `新增 ${changes.added.length} 项`, list: changes.added },
    { key: 'modified', icon: Pencil, label: `修改 ${changes.modified.length} 项`, list: changes.modified },
    { key: 'removed', icon: CircleMinus, label: `删除 ${changes.removed.length} 项`, list: changes.removed },
  ];

  return (
    <Dialog
      title="发布到团队"
      width="normal"
      onClose={onCancel}
      initialFocus={summaryRef}
      footer={
        <>
          {failure && error === 'NETWORK_UNREACHABLE' && (
            <Button tone="secondary" icon={RotateCcw} onClick={onRetry}>
              重试
            </Button>
          )}
          <Button tone="ghost" size="lg" onClick={onCancel}>
            取消
          </Button>
          <Button
            tone="primary"
            size="lg"
            icon={CloudUpload}
            iconSize={20}
            loading={publishing}
            softDisabled={!clean}
            onClick={() => onPublish(summary)}
          >
            {total > 0 ? `发布 · ${total} 项改动` : '发布'}
          </Button>
        </>
      }
    >
      <p className="t-sm t-mono text-[var(--fg-2)]">
        v{revision} → v{revision + 1}
      </p>
      <p className="t-xs mt-0.5 text-[var(--muted)]">发布后在线成员将在 45 秒内更新</p>

      <div className="mt-3" aria-live={clean ? 'polite' : 'assertive'}>
        {clean && !failure && (
          <StatusPill variant="block" tone="success" icon={CircleCheck}>
            {total} 项改动全部通过校验
          </StatusPill>
        )}
        {!clean && (
          <StatusPill variant="block" tone="danger" icon={CircleX}>
            {issues.length} 项需要修正
          </StatusPill>
        )}
        {failure && (
          <StatusPill variant="block" tone={failure.tone} icon={TriangleAlert}>
            <span>
              {failure.title}
              {failure.detail && <span className="block t-2xs opacity-90">{failure.detail}</span>}
            </span>
          </StatusPill>
        )}
      </div>

      {failure && (
        <div className="mt-2 flex gap-2">
          {error === 'REVISION_CONFLICT' && (
            <Button tone="secondary" icon={RotateCcw} onClick={onRetry}>
              重新拉取并合并
            </Button>
          )}
          {error === 'INSTANCE_MISMATCH' && (
            <Button tone="secondary" onClick={onOpenDiagnostics}>
              查看诊断
            </Button>
          )}
          {error === 'SIGNATURE_INVALID' && (
            <Button tone="secondary" onClick={onOpenSettings}>
              去设置
            </Button>
          )}
        </div>
      )}

      {!clean && (
        <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          {issues.map((it) => (
            <div
              key={`${it.entryId}-${it.field}`}
              className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="t-sm truncate-1 text-[var(--fg)]">
                  {it.entryName} · {it.field}
                </p>
                <p className="t-2xs truncate-1 text-[var(--danger-fg)]">{it.reason}</p>
              </div>
              <Button size="sm" tone="ghost" icon={Crosshair} onClick={() => onLocate(it.entryId)}>
                定位
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        {groups.map((g) => (
          <div key={g.key} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <MenuItem
              icon={g.icon}
              label={g.label}
              showChevron
              expanded={open[g.key]}
              onSelect={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
            />
            {open[g.key] && g.list.length > 0 && (
              <div className="pb-1">
                {g.list.map((e) => (
                  <p key={e.id} className="t-xs py-1 pl-6 text-[var(--fg-2)]">
                    {g.key === 'added' ? '+ ' : g.key === 'modified' ? '~ ' : '− '}
                    {changeLabel(e)}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <label className="mt-3 block">
        <span className="t-xs block text-[var(--muted)]">发布说明（可选）</span>
        <Input
          ref={summaryRef}
          className="mt-1"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="例如：报价目录已迁移到新共享盘"
        />
      </label>
    </Dialog>
  );
}
