/**
 * PageIdentityHint —— 团队 / 个人页的按需页面身份提示（2026-11-08 定稿，方案 C）。
 *
 * 常驻只有卡片区顶部中央一根 18×2px 淡线；切页或悬停时，在**同一条中心线**展开
 * 30px 横幅（页面名 + 治理标签 + 入口数）。不占布局、不遮搜索栏，鼠标移开 160ms 收起。
 *
 * 放置要求：组件必须渲染在内容面板（卡片模块）内部，absolute 相对面板定位；
 * 这样 left:50% 是卡片区中心，不会被侧栏宽度带偏。
 */
import { useEffect, useRef, useState } from 'react';
import { BuildingComplex, UserRound } from 'lucide-react';

export interface PageIdentityHintProps {
  tab: 'team' | 'personal';
  count: number;
  editing?: boolean;
}

export function PageIdentityHint({ tab, count, editing = false }: PageIdentityHintProps) {
  const [open, setOpen] = useState(false);
  const hovering = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const autoTimer = useRef<number | null>(null);

  const personal = tab === 'personal';
  const Icon = personal ? UserRound : BuildingComplex;
  const title = personal ? '个人入口' : '团队入口';
  const chip = personal ? '仅本机 · 不同步' : editing ? '编辑中 · 未发布' : '管理员发布 · 只读';

  useEffect(() => {
    const clear = (): void => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
      hideTimer.current = null;
      autoTimer.current = null;
    };
    clear();
    setOpen(true);
    autoTimer.current = window.setTimeout(() => {
      if (!hovering.current) setOpen(false);
    }, 1700);
    return clear;
  }, [tab]);

  const show = (): void => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setOpen(true);
  };

  const hideSoon = (): void => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!hovering.current) setOpen(false);
    }, 160);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-[18px]">
      {/* 淡线热区：位于内容面板顶部内边距里，不压卡片；鼠标移入即展开 */}
      <span
        data-tl-page-hint-trigger
        aria-hidden
        className="group pointer-events-auto absolute left-1/2 top-0 flex h-[18px] w-[140px] -translate-x-1/2 cursor-help items-start justify-center"
        onPointerEnter={() => {
          hovering.current = true;
          show();
        }}
        onPointerLeave={() => {
          hovering.current = false;
          hideSoon();
        }}
      >
        <span className="mt-[3px] block h-[2px] w-[18px] rounded-pill bg-[var(--border-strong)] opacity-35 transition-[width,opacity,background-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] group-hover:w-[28px] group-hover:bg-[var(--meta)] group-hover:opacity-100" />
      </span>

      <div
        data-tl-page-hint
        role="status"
        aria-live="polite"
        className={[
          'pointer-events-none absolute left-1/2 top-[2px] z-[3] flex h-[30px] max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[var(--fg-2)] shadow-[var(--menu-elev)]',
          'transition-[opacity,transform] duration-[var(--motion-base)] ease-[var(--ease-standard)]',
          open ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0',
        ].join(' ')}
      >
        <Icon size={14} strokeWidth={2} aria-hidden className="text-[var(--fg-2)]" />
        <span className="t-xs w-emph text-[var(--fg)]">{title}</span>
        <span className="rounded-pill bg-[var(--accent-tint)] px-1.5 py-0.5 t-2xs text-[var(--accent-text)]">{chip}</span>
        <span className="t-2xs text-[var(--meta)]">{count} 个入口</span>
      </div>
    </div>
  );
}
