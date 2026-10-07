/**
 * ChainLaunchBar —— 多选连锁启动的操作条（2026-10-05）。
 *
 * 多选模式 + 清单非空时浮现在内容区底部：显示已选数量与启动间隔，
 * 提供 启动 / 清空 / 退出。按钮点击都会先落到调用方，不会自动消失。
 */
import { ListChecks, X } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';

export interface ChainLaunchBarProps {
  count: number;
  intervalMs: number;
  launching?: boolean;
  onLaunch(): void;
  onClear(): void;
  onExit(): void;
}

export function ChainLaunchBar({ count, intervalMs, launching = false, onLaunch, onClear, onExit }: ChainLaunchBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="连锁启动"
      className="pointer-events-auto fixed bottom-[72px] left-1/2 z-[var(--z-toast)] flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] px-3 py-2"
      style={{ background: 'var(--bg-overlay)', boxShadow: 'var(--elev-3)' }}
    >
      <ListChecks size={16} strokeWidth={2} aria-hidden className="text-[var(--accent-text)]" />
      <span className="t-sm whitespace-nowrap text-[var(--fg)]">
        已选 <span className="w-emph">{count}</span> 项 · 间隔 {(intervalMs / 1000).toFixed(1)}s
      </span>
      <Button tone="primary" size="sm" softDisabled={count === 0 || launching} onClick={onLaunch}>
        启动连锁
      </Button>
      <Button tone="ghost" size="sm" onClick={onClear}>
        清空
      </Button>
      <Button tone="ghost" size="sm" aria-label="退出多选" icon={X} onClick={onExit} />
    </div>
  );
}
