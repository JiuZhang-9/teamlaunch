/**
 * PaletteRoot —— 迷你面板窗口（`#/palette`）的根组件。
 *
 * 这是一个独立窗口的视图，不是主窗口里的一层浮层：
 *  - open 状态完全由主进程的 shown/hidden 推送驱动（显示/失焦/热键切换都走那里）；
 *  - 关闭动作（Esc）请主进程收起窗口，面板窗口本身永不被销毁（K-D 预热）；
 *  - SettingsProvider 必须挂：主题属性（data-theme）由它写到文档根上，
 *    不挂的话这个窗口永远停在浅色主题——主窗口深色、面板白色就是这么来的。
 */
import { useEffect, useState } from 'react';
import { api } from '../bridge/index.ts';
import { ToastProvider, useToasts } from '../store/toastStore.tsx';
import { SettingsProvider } from '../store/settingsStore.tsx';
import { SyncProvider } from '../store/syncStore.tsx';
import { PersonalProvider } from '../store/personalStore.tsx';
import { WorkbenchProvider } from '../store/workbenchStore.tsx';
import { ToastViewport } from '../components/molecules/Toast.tsx';
import { MiniPaletteView } from './MiniPaletteView.tsx';

function ToastLayer() {
  const { toasts, dismiss } = useToasts();
  return <ToastViewport toasts={toasts} onDismiss={dismiss} />;
}

function PaletteWindow() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const offShown = api.events.onPaletteShown(() => setOpen(true));
    const offHidden = api.events.onPaletteHidden(() => setOpen(false));
    return () => {
      offShown();
      offHidden();
    };
  }, []);

  // 窗口标题标明身份：Alt+Tab / 任务切换里用户能认出这是"全局快捷窗口"，
  // 不会把它误认成又一个主界面。
  useEffect(() => {
    document.title = 'TeamLaunch · 全局快捷窗口';
  }, []);

  // Esc 收起必须不依赖输入框焦点：MiniPalette 的 onKeyDown 只覆盖焦点在面板内的情况，
  // 焦点一旦落在 body（点击过面板空白处/系统焦点丢失）就收不到键——窗口级兜底。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void api.palette.hide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius-lg)]" style={{ background: 'var(--bg-canvas)' }}>
      <MiniPaletteView docked open={open} onClose={() => void api.palette.hide()} />
      <ToastLayer />
    </div>
  );
}

export function PaletteRoot() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <SyncProvider>
          <PersonalProvider>
            <WorkbenchProvider>
              <PaletteWindow />
            </WorkbenchProvider>
          </PersonalProvider>
        </SyncProvider>
      </SettingsProvider>
    </ToastProvider>
  );
}
