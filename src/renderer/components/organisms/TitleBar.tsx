/**
 * TitleBar —— 无边框窗口的标题栏（h40，**唯一横贯全窗的 app-region: drag 区**）。
 *
 * 2026-10-02 侧栏化定稿：最左侧新增侧栏折叠按钮（PanelLeft，点击侧栏完全消失/恢复，
 * 状态持久化在 settings.sidebarCollapsed）；Logo 换成 BrandMark 框线 T（随主题色）；
 * 产品名降为次级灰（fg-2）弱化存在感。交互元素逐个声明 no-drag。
 */
import { PanelLeft, Minus, Square, X, CircleHelp } from 'lucide-react';
import type { CSSProperties } from 'react';
import { api } from '../../bridge/index.ts';
import { BrandMark } from '../atoms/BrandMark.tsx';

const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface TitleBarProps {
  /** 隐私说明未确认时关闭按钮必须 disabled（AC-18） */
  closeDisabled?: boolean;
  /** 侧栏当前是否折叠（来自 settings.sidebarCollapsed）。 */
  collapsed?: boolean;
  onToggleSidebar?(): void;
  /** 点击产品名/Logo 直达「设置 · 关于」（关于并入设置对话框，行业惯例：标题栏常驻版本号）。 */
  onOpenAbout?(): void;
  /** 点击 ？ 圆形按钮打开帮助中心（快捷键速查 + 使用说明）。 */
  onOpenHelp?(): void;
  teamRevision?: number | null;
}

const BTN =
  'grid h-10 w-10 shrink-0 place-items-center text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--fg)]';
/** 折叠按钮 hover/激活态走主题色（点缀应用点之一）。 */
const TOGGLE =
  'grid h-10 w-10 shrink-0 place-items-center transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]';

export function TitleBar({ closeDisabled = false, collapsed = false, onToggleSidebar, onOpenAbout, onOpenHelp, teamRevision = null }: TitleBarProps) {
  return (
    // 无边框窗口的拖拽区：整个标题栏可拖动窗口，交互元素逐个声明 no-drag。
    <div
      className="flex h-[var(--win-titlebar-h)] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-[var(--space-3)]"
      style={{ background: 'var(--bg-chrome)', '--bg-surface-hover': 'var(--bg-chrome-hover)', ...DRAG } as CSSProperties}
    >
      {onToggleSidebar && (
        <button
          type="button"
          aria-label={collapsed ? '显示侧栏' : '隐藏侧栏'}
          aria-pressed={collapsed || undefined}
          onClick={onToggleSidebar}
          className={TOGGLE}
          style={{
            ...NO_DRAG,
            color: collapsed ? 'var(--accent-text)' : 'var(--fg-2)',
            background: collapsed ? 'var(--accent-tint)' : 'transparent',
            width: 40,
            height: 40,
            marginLeft: -6,
            borderRadius: 'var(--radius-md)',
          }}
        >
          <PanelLeft size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
      {onOpenAbout ? (
        <button
          type="button"
          onClick={onOpenAbout}
          title={`关于 TeamLaunch（v${__APP_VERSION__}${teamRevision != null ? ` · 团队数据 v${teamRevision}` : ''}）`}
          className="flex h-10 shrink-0 select-none items-center gap-2 rounded-[var(--radius-md)] px-1.5 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
          style={NO_DRAG}
        >
          <BrandMark variant="frame" />
          <span
            className="t-sm truncate-1"
            style={{ color: 'var(--fg-2)', fontWeight: 'var(--weight-read)' }}
          >
            TeamLaunch
          </span>
          <span className="t-2xs" style={{ color: 'var(--meta)' }}>
            v{__APP_VERSION__}
          </span>
        </button>
      ) : (
        <>
          <BrandMark variant="frame" />
          <span
            className="t-sm truncate-1 select-none"
            style={{ color: 'var(--fg-2)', fontWeight: 'var(--weight-read)' }}
          >
            TeamLaunch
          </span>
        </>
      )}
      <div className="flex-1" />
      {onOpenHelp && (
        <button
          type="button"
          aria-label="帮助"
          title="帮助（快捷键速查与使用说明）"
          onClick={onOpenHelp}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--border-strong)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--fg)]"
          style={NO_DRAG}
        >
          <CircleHelp size={15} strokeWidth={2} aria-hidden />
        </button>
      )}
      <button type="button" aria-label="最小化" onClick={() => void api.window.min()} className={BTN} style={NO_DRAG}>
        <Minus size={16} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" aria-label="最大化" onClick={() => void api.window.toggleMax()} className={BTN} style={NO_DRAG}>
        <Square size={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="关闭"
        aria-disabled={closeDisabled || undefined}
        disabled={closeDisabled}
        onClick={() => void api.window.close()}
        className={[BTN, 'hover:bg-[var(--danger-bg)] hover:text-[var(--danger-fg)]', closeDisabled ? 'cursor-not-allowed opacity-50' : ''].join(' ')}
        style={NO_DRAG}
      >
        <X size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
