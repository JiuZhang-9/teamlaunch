/**
 * TitleBar —— 无边框窗口的标题栏（h40，**唯一横贯全窗的 app-region: drag 区**）。
 *
 * 2026-10-02 侧栏化定稿：最左侧新增侧栏折叠按钮（PanelLeft，点击侧栏完全消失/恢复，
 * 状态持久化在 settings.sidebarCollapsed）；Logo 换成 BrandMark 框线 T（随主题色），
 * 产品名降为次级灰（fg-2）弱化存在感。交互元素逐个声明 no-drag。
 *
 * 1.3.0（2026-10-27 用户要求）：更新进度**顶栏也显示**（工作区弹窗里保留一份）。
 * 胶囊 = 进度环 + 版本 + 百分比；下载完变成"可安装"；点开小浮层放安装/检测。
 * 顶栏在所有页面都可见，主页也能看到更新进度——工作栏只在内容页出现，所以不放那里。
 */
import { CircleHelp, Download, Minus, PanelLeft, RefreshCw, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../../bridge/index.ts';
import { APP_VERSION } from '../../lib/appVersion.ts';
import { Button } from '../atoms/Button.tsx';
import { BrandMark } from '../atoms/BrandMark.tsx';
import { MenuItem } from '../molecules/MenuItem.tsx';
import { ProgressRing } from '../molecules/ProgressRing.tsx';

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
  /** 应用更新（1.3.0）：非 null 时在顶栏显示进度胶囊；工作区弹窗里也有一份。 */
  update?: { version: string; percent: number | null; ready: boolean } | null;
  onInstallUpdate?(): void;
  onCheckUpdate?(): void;
  updateChecking?: boolean;
}

const BTN =
  'grid h-10 w-10 shrink-0 place-items-center text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--fg)]';
/** 折叠按钮 hover/激活态走主题色（点缀应用点之一）。 */
const TOGGLE =
  'grid h-10 w-10 shrink-0 place-items-center transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]';

export function TitleBar({
  closeDisabled = false,
  collapsed = false,
  onToggleSidebar,
  onOpenAbout,
  onOpenHelp,
  teamRevision = null,
  update = null,
  onInstallUpdate,
  onCheckUpdate,
  updateChecking = false,
}: TitleBarProps) {
  const [updatePop, setUpdatePop] = useState(false);
  const updateRef = useRef<HTMLDivElement | null>(null);

  /* 点浮层外面 / Esc 收起：与工作区弹窗同一套交互，不额外引入组件。 */
  useEffect(() => {
    if (!updatePop) return;
    const onDown = (e: MouseEvent) => {
      if (!updateRef.current?.contains(e.target as Node)) setUpdatePop(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUpdatePop(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [updatePop]);

  const percent = update?.ready ? 100 : (update?.percent ?? 0);

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
          title={`关于 TeamLaunch（v${APP_VERSION}${teamRevision != null ? ` · 团队数据 v${teamRevision}` : ''}）`}
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
            v{APP_VERSION}
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

      {/* 更新胶囊（1.3.0）：所有页面都能看到；点开是安装/检测浮层。 */}
      {update && (
        <div ref={updateRef} className="relative shrink-0" style={NO_DRAG}>
          <button
            type="button"
            aria-expanded={updatePop}
            aria-haspopup="dialog"
            aria-label={
              update.ready
                ? `新版本 v${update.version} 已下载，点击安装`
                : `新版本 v${update.version} 正在后台下载 ${percent}%`
            }
            title={update.ready ? `新版本 v${update.version} 已就绪` : `新版本 v${update.version} 正在后台下载`}
            onClick={() => setUpdatePop((v) => !v)}
            className="flex h-8 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--accent-border)] px-2 transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
            style={{ background: 'var(--accent-tint)', color: 'var(--accent-text)' }}
          >
            <ProgressRing percent={percent} size={20} strokeWidth={2.5} showValue={false} label={`新版本 v${update.version} 下载进度`} />
            <span className="t-2xs w-emph whitespace-nowrap">
              v{update.version}
              {update.ready ? ' 可安装' : ` ${percent}%`}
            </span>
          </button>

          {updatePop && (
            <div
              role="dialog"
              aria-label="版本更新"
              className="absolute right-0 top-full z-[var(--z-dropdown)] mt-1 w-[248px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2.5"
              style={{
                background: 'var(--menu-bg)',
                boxShadow: 'var(--menu-elev)',
                WebkitAppRegion: 'no-drag',
              } as CSSProperties}
            >
              <div className="flex items-center gap-3 px-1 pb-2 pt-1">
                <ProgressRing percent={percent} label={`新版本 v${update.version} 下载进度`} />
                <div className="min-w-0 flex-1">
                  <p className="t-sm w-emph m-0 truncate-1 text-[var(--fg)]">新版本 v{update.version}</p>
                  <p className="t-2xs m-0 text-[var(--fg-2)]">
                    {update.ready ? '已下载完成，可以立即安装' : '正在后台下载，你可以继续用'}
                  </p>
                </div>
              </div>
              {update.ready && (
                <Button tone="primary" size="sm" fullWidth icon={Download} className="mb-1" onClick={onInstallUpdate}>
                  立即更新并重启
                </Button>
              )}
              <div className="mx-1 my-1.5 h-px bg-[var(--border-subtle)]" />
              <MenuItem
                icon={RefreshCw}
                label={updateChecking ? '正在检测…' : '检测版本更新'}
                disabled={updateChecking}
                onSelect={() => {
                  setUpdatePop(false);
                  onCheckUpdate?.();
                }}
              />
            </div>
          )}
        </div>
      )}

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
