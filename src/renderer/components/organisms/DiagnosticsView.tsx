/**
 * DiagnosticsView（V-10）—— 全应用**唯一**允许出现 IP / 端口的界面。
 *
 * 纪律：
 *  - 结论块最多 1 个（danger > warn > 版本不一致），其余降级为行内状态图标；
 *  - Loading 期间不渲染结论块——先显示"异常"再翻正会让用户以为真坏了；
 *  - 未持令牌的员工视角，服务端字段显示「需要管理员权限」，不留空白也不显示 ***。
 */
import { ChevronRight, CircleCheck, CircleX, CloudOff, Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../atoms/Button.tsx';
import { EmptyBlock } from '../molecules/EmptyBlock.tsx';
import { Skeleton } from '../atoms/Skeleton.tsx';
import { Dialog } from './Dialog.tsx';
import type { DiagnosticLevel, DiagnosticSnapshot } from '../../bridge/types.ts';

export interface DiagnosticsViewProps {
  loading: boolean;
  snapshot: DiagnosticSnapshot | null;
  copyError: string | null;
  onClose(): void;
  onCopy(): void;
  onRefresh(): void;
  onRepair(): void;
  onSwitchGuide(): void;
}

const LEVEL_ICON = {
  ok: CircleCheck,
  warn: TriangleAlert,
  bad: CircleX,
} as const;

const LEVEL_COLOR: Record<DiagnosticLevel, string> = {
  ok: 'var(--diag-ok-fg)',
  warn: 'var(--warn-fg)',
  bad: 'var(--diag-bad-fg)',
};

/** 状态图标必须带 aria-label：关闭颜色后仍可辨识 */
const LEVEL_LABEL: Record<DiagnosticLevel, string> = {
  ok: '正常',
  warn: '需要注意',
  bad: '异常',
};

export function DiagnosticsView({
  loading, snapshot, copyError, onClose, onCopy, onRefresh, onRepair, onSwitchGuide,
}: DiagnosticsViewProps) {
  const [rawOpen, setRawOpen] = useState(false);
  const conclusion = snapshot?.conclusion ?? null;

  return (
    <Dialog
      title="诊断"
      width="wide"
      onClose={onClose}
      footer={
        <>
          {copyError && <span className="mr-auto t-xs text-[var(--danger-fg)]">{copyError}</span>}
          <Button tone="secondary" icon={Copy} onClick={onCopy}>
            复制诊断信息
          </Button>
          <Button tone="ghost" icon={RefreshCw} onClick={onRefresh}>
            刷新
          </Button>
        </>
      }
    >
      {loading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} h={32} />
          ))}
        </div>
      )}

      {!loading && !snapshot && (
        <EmptyBlock
          icon={CloudOff}
          title="拿不到巡检信息"
          detail="管理员电脑未开机或未连接网络。稍后会自动重试，你也可以手动刷新。"
          actions={
            <Button tone="secondary" icon={RefreshCw} onClick={onRefresh}>
              刷新
            </Button>
          }
        />
      )}

      {!loading && snapshot && (
        <>
          {conclusion && (
            <div
              role="status"
              aria-live="assertive"
              className="mb-3 rounded-[var(--radius-md)] border p-3"
              style={{
                background: conclusion.level === 'bad' ? 'var(--danger-bg)' : 'var(--warn-bg)',
                color: conclusion.level === 'bad' ? 'var(--danger-fg)' : 'var(--warn-fg)',
                borderColor: conclusion.level === 'bad' ? 'var(--danger-fg)' : 'var(--warn-fg)',
              }}
            >
              <div className="flex items-start gap-2">
                <TriangleAlert size={16} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="t-sm w-emph">{conclusion.title}</p>
                  <p className="t-xs mt-0.5">{conclusion.detail}</p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                {conclusion.actions.map((a) => (
                  <Button
                    key={a.id}
                    size="sm"
                    tone="secondary"
                    onClick={a.id === 'repair' ? onRepair : onSwitchGuide}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div
            role="table"
            aria-label="巡检项"
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]"
          >
            {snapshot.rows.map((r, i) => {
              const Icon = LEVEL_ICON[r.level];
              return (
                <div
                  key={`${r.key}-${i}`}
                  role="row"
                  className="flex min-h-[var(--row-h)] items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-1 last:border-b-0"
                >
                  <span role="cell" className="w-[160px] shrink-0 t-xs text-[var(--diag-key-fg)]">
                    {r.key}
                  </span>
                  <span
                    role="cell"
                    className="min-w-0 flex-1 t-sm t-mono truncate-1"
                    style={{ color: r.locked ? 'var(--meta)' : 'var(--diag-value-fg)' }}
                  >
                    {r.value}
                  </span>
                  <Icon
                    size={16}
                    strokeWidth={2}
                    aria-label={LEVEL_LABEL[r.level]}
                    className="shrink-0"
                    style={{ color: r.locked ? 'var(--meta)' : LEVEL_COLOR[r.level] }}
                  />
                </div>
              );
            })}
          </div>

          <p className="mt-2 t-2xs text-[var(--meta)]">
            本机自连自身 IP 的自检不可信：回环不经过防火墙入站规则，真实验证必须由第二台机器完成。
          </p>

          <button
            type="button"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((v) => !v)}
            className="mt-3 flex h-8 w-full items-center gap-2 rounded-[var(--radius-md)] px-3 t-sm text-[var(--fg-2)] hover:bg-[var(--bg-surface-hover)]"
          >
            <ChevronRight
              size={16}
              strokeWidth={2}
              aria-hidden
              className="shrink-0 transition-transform duration-[var(--motion-fast)]"
              style={{ transform: rawOpen ? 'rotate(90deg)' : 'none' }}
            />
            原始巡检响应
          </button>
          {rawOpen && (
            <pre className="tl-scroll mt-1 h-[200px] overflow-auto rounded-[var(--radius-md)] p-3 t-2xs t-mono"
              style={{ background: 'var(--bg-surface-2)', color: 'var(--fg-2)' }}
            >
              {snapshot.raw}
            </pre>
          )}
        </>
      )}
    </Dialog>
  );
}
