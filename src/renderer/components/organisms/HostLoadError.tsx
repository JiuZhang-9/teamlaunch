/**
 * 宿主加载失败的错误页 —— **替代**整个正常 UI，不是叠在它上面的一层。
 *
 * 这里刻意不复用"预览模式未接入 X"那套措辞：那个说法把故障说成了产品形态，
 * 用户会以为功能本来就没有，而不是安装坏了。故障就是故障，要说清楚。
 *
 * 也不给"继续试用"之类的出口：宿主缺失时所有数据操作都无法落地，
 * 放一个能进主界面的按钮只是让人以为还能用。
 */
import { PackageX } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';

export interface HostLoadErrorProps {
  message: string;
  onCopy(): void;
}

export function HostLoadError({ message, onCopy }: HostLoadErrorProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="grid h-full w-full place-items-center px-[var(--space-6)]"
      style={{ background: 'var(--bg-canvas)' }}
    >
      <div
        className="flex max-w-[520px] flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] p-[var(--space-6)]"
        style={{ background: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-2">
          <PackageX size={20} strokeWidth={2} aria-hidden className="text-[var(--danger-fg)]" />
          <h1 className="t-lg w-emph text-[var(--fg)]">无法启动</h1>
        </div>

        <p className="t-sm text-[var(--fg-2)]">{message}</p>

        <div className="mt-1">
          <Button tone="secondary" icon={PackageX} onClick={onCopy}>
            复制这段文字
          </Button>
        </div>
      </div>
    </div>
  );
}
