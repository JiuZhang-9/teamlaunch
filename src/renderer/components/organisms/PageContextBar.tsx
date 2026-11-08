/**
 * PageContextBar —— 团队页 / 个人页的页面身份条（2026-11-08 方案 C）。
 *
 * 两个页面共用同一套外壳和卡片，过去只有侧栏 tab 能说明"我在哪"。
 * 这里用一条 36px 的上下文行写明：页面名 + 治理语义（管理员发布/仅本机）+ 入口数。
 * 不引入第二个主色，只靠图标、文案和状态芯片区分。
 */
import { BuildingComplex, UserRound } from 'lucide-react';

export interface PageContextBarProps {
  tab: 'team' | 'personal';
  count: number;
  editing?: boolean;
}

export function PageContextBar({ tab, count, editing = false }: PageContextBarProps) {
  const personal = tab === 'personal';
  const Icon = personal ? UserRound : BuildingComplex;
  const title = personal ? '个人入口' : '团队入口';
  const chip = personal ? '仅本机 · 不同步' : editing ? '编辑中 · 未发布' : '管理员发布 · 只读';

  return (
    <div
      data-tl-page-context={tab}
      className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-[var(--space-6)]"
      style={{ background: 'var(--bg-surface)' }}
    >
      <Icon size={16} strokeWidth={2} aria-hidden className="text-[var(--fg-2)]" />
      <span className="t-sm w-emph text-[var(--fg)]">{title}</span>
      <span className="rounded-pill bg-[var(--accent-tint)] px-1.5 py-0.5 t-2xs text-[var(--accent-text)]">
        {chip}
      </span>
      <span className="ml-auto t-2xs text-[var(--meta)]">{count} 个入口</span>
    </div>
  );
}
