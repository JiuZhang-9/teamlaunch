/**
 * EditActionBar —— 管理员编辑态的**信号 3**，h64。
 *
 * 文案只有两句，不许用「草稿」「未提交」这类内部术语：
 *   无改动 → `当前版本 v26`；有改动 → `已编辑 N 项，尚未发布`。
 * 发布按钮无改动时禁用，但**必须保留可聚焦**（aria-disabled），
 * 用原生 disabled 会让键盘用户直接跳过，永远不知道为什么按不动。
 *
 * 定稿样式（2026-10-02）：出现时自下而上滑入（riseup）；「发布」用中性深底反白
 * （fg 前景 / canvas 底），不用主题色实心——主按钮不做高亮（用户明确要求）。
 */
import { CloudUpload } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Button } from '../atoms/Button.tsx';

/** 发布时间 → 展示日期（今年省年份）。 */
export function formatRevDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const md = `${d.getMonth() + 1}-${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? md + ' ' + hm : `${d.getFullYear()}-${md} ${hm}`;
}

export interface EditActionBarProps {
  dirtyCount: number;
  revision: number;
  /** 最近一次发布时间（主页/编辑条上给版本号加可记忆的日期标注）。 */
  publishedAt?: string | null;
  publishing: boolean;
  onDiscard(): void;
  onPublish(): void;
}

const riseup: CSSProperties = { animation: 'riseup var(--motion-base) var(--ease-emphasis)' };

export function EditActionBar({
  dirtyCount,
  revision,
  publishedAt = null,
  publishing,
  onDiscard,
  onPublish,
}: EditActionBarProps) {
  const dirty = dirtyCount > 0;
  return (
    <div
      className="flex h-[var(--editbar-h)] shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] px-[var(--space-6)]"
      style={{
        ...riseup,
        background: 'var(--bg-overlay)',
        boxShadow: 'var(--elev-2)',
      }}
    >
      {dirty && (
        <span
          aria-hidden
          data-motion="breathe"
          className="block shrink-0 rounded-[var(--radius-pill)]"
          style={{
            width: 'var(--sync-dot-size)',
            height: 'var(--sync-dot-size)',
            background: 'var(--warn-solid)',
          }}
        />
      )}
      <span
        className="t-base min-w-0 flex-1 truncate-1"
        style={{ color: dirty ? 'var(--fg)' : 'var(--fg-2)', fontWeight: dirty ? 'var(--weight-emphasize)' : 'var(--weight-read)' }}
      >
        {dirty
          ? `已编辑 ${dirtyCount} 项，尚未发布`
          : `当前版本 v${revision}${publishedAt ? ' · ' + formatRevDate(publishedAt) : ''}`}
      </span>
      <Button tone="ghost" size="lg" onClick={onDiscard}>
        放弃改动
      </Button>
      <Button
        tone="ghost"
        size="lg"
        icon={CloudUpload}
        iconSize={20}
        loading={publishing}
        softDisabled={!dirty}
        onClick={onPublish}
        style={
          dirty && !publishing
            ? { background: 'var(--fg)', color: 'var(--bg-canvas)', border: '1px solid var(--border-strong)' }
            : undefined
        }
      >
        {dirty ? `发布 · ${dirtyCount} 项改动` : '发布'}
      </Button>
    </div>
  );
}
