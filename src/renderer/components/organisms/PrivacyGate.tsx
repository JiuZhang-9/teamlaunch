/**
 * PrivacyGate（V-09）—— 首次启动的**状态门**，不是可关闭的对话框。
 *
 * 不可绕过：无 X、遮罩点击无效、Esc 无效、未确认时主窗口关闭按钮 disabled。
 * 初始焦点落在「不允许」——隐私默认取最小收集，按 Enter 不该在用户没读的情况下打开收集。
 * 排版刻意不全居中：标题居中，正文与四要点左对齐（需要逐条核对的内容，左对齐更快读）。
 */
import { CircleCheck, CircleX, ShieldCheck } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '../atoms/Button.tsx';

export interface PrivacyGateProps {
  /** 从设置进入时展示当前状态，并提供「保持 / 改为」而不是「允许 / 不允许」 */
  viewingFromSettings?: boolean;
  currentlyAllowed: boolean;
  onAllow(): void;
  onDeny(): void;
}

const POINTS: Array<{ label: string; positive: boolean }> = [
  { label: '只记录匿名设备标识与操作是否成功', positive: true },
  { label: '不记录搜索内容、文件路径、网址', positive: false },
  { label: '不记录你填写的说明与个人信息', positive: false },
  { label: '不用于任何个人绩效统计', positive: false },
];

export function PrivacyGate({
  viewingFromSettings = false,
  currentlyAllowed,
  onAllow,
  onDeny,
}: PrivacyGateProps) {
  const denyRef = useRef<HTMLButtonElement | null>(null);
  const allowed = viewingFromSettings ? currentlyAllowed : false;

  // 初始焦点落在「不允许」：隐私默认取最小收集
  useEffect(() => {
    denyRef.current?.focus();
  }, []);

  return (
    // flex（而非 grid）居中 + 面板限高内滚：与 Dialog 同一道防裁切纪律——
    // 内容比容器高时面板收缩滚动，而不是溢出被外壳裁掉（顶部图标/底部按钮消失）。
    <div
      className="absolute inset-0 z-[var(--z-dialog-backdrop)] flex items-center justify-center p-[var(--space-6)]"
      // 点击遮罩无效、Esc 无效：这里故意不挂任何关闭回调
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.stopPropagation();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'var(--bg-canvas)', opacity: 0.72 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tl-privacy-title"
        aria-describedby="tl-privacy-body"
        className="relative z-[var(--z-dialog)] flex max-h-full flex-col items-center overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--border-subtle)] p-[var(--space-8)]"
        style={{ width: 'var(--gate-w)', background: 'var(--bg-overlay)', boxShadow: 'var(--elev-3)' }}
      >
        <span
          className="grid place-items-center rounded-[var(--radius-lg)]"
          style={{
            width: 'var(--gate-icon-box)',
            height: 'var(--gate-icon-box)',
            background: 'var(--accent-tint)',
            color: 'var(--accent-text)',
          }}
        >
          <ShieldCheck size={24} strokeWidth={2} aria-hidden />
        </span>

        <h2 id="tl-privacy-title" className="t-title mt-3 text-center text-[var(--fg)]">
          关于使用数据
        </h2>

        {viewingFromSettings && (
          <p className="t-xs mt-1 text-[var(--muted)]">当前：{allowed ? '已允许' : '不允许'}</p>
        )}

        <p id="tl-privacy-body" className="t-base mt-3 text-left text-[var(--fg-2)]">
          TeamLaunch 会记录少量匿名数据，用来判断哪些入口失效、需要修。上线前请确认：
        </p>

        {/* 四要点用静态行而不是 MenuItem：本门只允许 2 个 tab stop */}
        <ul className="mt-3 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          {POINTS.map((p) => (
            <li
              key={p.label}
              className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
            >
              {p.positive ? (
                <CircleCheck size={16} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--success-fg)]" />
              ) : (
                <CircleX size={16} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--muted)]" />
              )}
              <span className="t-sm text-[var(--fg)]">{p.label}</span>
            </li>
          ))}
        </ul>

        <p className="t-xs mt-3 text-left text-[var(--muted)]">
          数据保存在管理员电脑上，不经过外部服务器。可随时在「设置」里关闭。
        </p>

        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            ref={denyRef}
            tone="secondary"
            size="lg"
            onClick={onDeny}
          >
            {viewingFromSettings ? (allowed ? '改为不允许' : '保持不允许') : '不允许'}
          </Button>
          <Button tone="primary" size="lg" onClick={onAllow}>
            {viewingFromSettings ? (allowed ? '保持允许' : '改为允许') : '允许并继续'}
          </Button>
        </div>
      </div>
    </div>
  );
}
