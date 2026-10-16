/**
 * PageTabs —— 2 个 Tab，role="tablist"，自动激活模式。两种方向：
 *   horizontal（默认）顶部标签：底部 2px 指示条，方向键左右。
 *   vertical         侧栏导航：左侧 3px 竖条，方向键上下。
 *
 * 指示器是**单个绝对定位元素**改 transform/width（不是两条各自显隐，
 * 那会出现一帧双条）；只动 transform / width，不动 left（left 触发布局重排）。
 * reduced-motion 下指示器不位移，直接在新位置出现（page-tabs.md §3）。
 */
import { BuildingComplex, House, UserRound } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TabKey } from '../../store/workbenchStore.tsx';

const TABS: Array<{ key: TabKey; label: string; icon: typeof BuildingComplex }> = [
  { key: 'home', label: '主页', icon: House },
  { key: 'team', label: '团队入口', icon: BuildingComplex },
  { key: 'personal', label: '我的入口', icon: UserRound },
];

export interface PageTabsProps {
  value: TabKey;
  onChange(next: TabKey): void;
  /** 竖向用于侧栏导航（选中态为左侧竖条），横向用于顶部标签（底部横条）。 */
  orientation?: 'horizontal' | 'vertical';
  /** 禁用项（2026-10-17）：视觉置灰、点击无效、方向键/Home/End 都跳过。编辑态锁「我的入口」用。 */
  disabledKeys?: TabKey[];
  /** 禁用项的统一提示（title 与 aria 说明为什么要先退出编辑）。 */
  disabledTitle?: string;
}

export function PageTabs({ value, onChange, orientation = 'horizontal', disabledKeys = [], disabledTitle }: PageTabsProps) {
  const vertical = orientation === 'vertical';
  const isDisabled = (key: TabKey) => disabledKeys.includes(key);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [indicator, setIndicator] = useState({ offset: 0, size: 0 });
  const index = TABS.findIndex((t) => t.key === value);

  /** 指示器的视觉尺寸 = 项尺寸 − 16，居中（横=宽，竖=高）。 */
  const measure = useCallback(() => {
    const el = tabRefs.current[index];
    if (!el) return;
    setIndicator(
      vertical
        ? { offset: el.offsetTop + 8, size: Math.max(0, el.offsetHeight - 16) }
        : { offset: el.offsetLeft + 8, size: Math.max(0, el.offsetWidth - 16) },
    );
  }, [index, vertical]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [measure]);

  /** 方向键在「未禁用」的页签之间循环（禁用项直接跳过，不聚焦、不切换）。 */
  const move = (delta: -1 | 1) => {
    const enabled = TABS.map((t, i) => (isDisabled(t.key) ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(index);
    const next = pos < 0 ? enabled[0] : enabled[(pos + delta + enabled.length) % enabled.length];
    onChange(TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label="工作区"
      aria-orientation={orientation}
      className={[
        'relative flex shrink-0',
        vertical ? 'w-full flex-col items-stretch gap-1' : 'h-[var(--control-h-md)] items-center gap-1 rounded-[var(--radius-md)] p-0.5',
      ].join(' ')}
      style={{ background: vertical ? 'transparent' : 'var(--tab-track-bg)' }}
      onKeyDown={(e) => {
        const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
        const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
        if (e.key === nextKey) {
          e.preventDefault();
          move(1);
        } else if (e.key === prevKey) {
          e.preventDefault();
          move(-1);
        } else if (e.key === 'Home' && !isDisabled('home')) {
          e.preventDefault();
          onChange('home');
        } else if (e.key === 'End' && !isDisabled('personal')) {
          e.preventDefault();
          onChange('personal');
        }
      }}
    >
      {TABS.map((t, i) => {
        const selected = t.key === value;
        const locked = isDisabled(t.key);
        const Glyph = t.icon;
        return (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tl-tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`tl-panel-${t.key}`}
            disabled={locked}
            aria-disabled={locked || undefined}
            title={locked ? disabledTitle : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={[
              'flex items-center gap-2 rounded-[var(--radius-sm)]',
              't-sm transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
              vertical
                ? 'h-[var(--sidebar-nav-h)] w-full justify-start px-3'
                : 'h-7 min-w-[88px] gap-1.5 px-3',
              locked
                ? 'cursor-not-allowed opacity-40'
                : selected
                  ? 'bg-[var(--tab-bg-selected)] w-emph'
                  : 'hover:bg-[var(--bg-surface-hover)]',
            ].join(' ')}
            style={{
              /* 背景必须走类：内联样式会压掉 hover:bg（2026-10-06 用户实测页签无悬停反馈） */
              color: selected ? 'var(--tab-fg-selected)' : 'var(--tab-fg)',
            }}
          >
            <Glyph size={16} strokeWidth={2} aria-hidden className="shrink-0" />
            {t.label}
          </button>
        );
      })}
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-[var(--radius-pill)]"
        style={{
          background: 'var(--tab-indicator)',
          ...(vertical
            ? { left: 0, top: 0, width: 'var(--sidebar-indicator-w)', height: indicator.size }
            : { left: 0, bottom: 0, height: 2, width: indicator.size }),
          transform: vertical ? `translateY(${indicator.offset}px)` : `translateX(${indicator.offset}px)`,
          transition:
            'transform var(--motion-base) var(--ease-standard), width var(--motion-base) var(--ease-standard), height var(--motion-base) var(--ease-standard)',
        }}
      />
    </div>
  );
}
