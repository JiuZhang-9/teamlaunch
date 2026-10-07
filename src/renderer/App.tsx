/**
 * 应用装配。
 *
 * Provider 顺序有依赖关系：Sync → Personal → Feedback → Edit → Workbench
 * （Edit 读同步快照作为"已发布版本"，Workbench 的打开动作要能给 Edit 定位）。
 *
 * 界面缩放是**浏览器式 zoom**（webContents.setZoomFactor，主进程应用并持久化）：
 * 窗口尺寸不变，字体与内部 UI 等比缩放、布局重排。渲染层不再做任何缩放盒子——
 * 旧的"缩放 1040×720 设计盒再塞回窗口"方案放大即拥挤、对话框被裁，已整体移除。
 */
import { useEffect, useRef } from 'react';
import { api } from './bridge/index.ts';
import { hostState } from './bridge/index.ts';
import { HostLoadError } from './components/organisms/HostLoadError.tsx';
import { MainWindowShell } from './components/organisms/MainWindowShell.tsx';
import { ToastViewport } from './components/molecules/Toast.tsx';
import { EditProvider } from './store/editStore.tsx';
import { FavoriteProvider } from './store/favoriteStore.tsx';
import { FeedbackProvider } from './store/feedbackStore.tsx';
import { PersonalProvider } from './store/personalStore.tsx';
import { SettingsProvider, useSettings } from './store/settingsStore.tsx';
import { SyncProvider } from './store/syncStore.tsx';
import { ToastProvider, useToasts } from './store/toastStore.tsx';
import { WorkbenchProvider } from './store/workbenchStore.tsx';

function ToastLayer() {
  const { toasts, dismiss } = useToasts();
  return <ToastViewport toasts={toasts} onDismiss={dismiss} />;
}

/** 首帧兜底应用持久化缩放（主进程在窗口创建时已应用过，这里覆盖缓存晚于首帧的竞态）。 */
function ZoomBoot() {
  const { settings } = useSettings();
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    void api.window.setZoom(settings.uiZoom);
  }, [settings.uiZoom]);
  return null;
}

export function App() {
  // 宿主缺失时**替代**整个 UI，不是叠一层提示：此时任何数据操作都落不了地。
  if (hostState.fatalError) {
    return (
      <HostLoadError
        message={hostState.fatalError}
        onCopy={() => void navigator.clipboard?.writeText(hostState.fatalError ?? '')}
      />
    );
  }

  return (
    <ToastProvider>
      <SettingsProvider>
        <SyncProvider>
          <PersonalProvider>
            <FeedbackProvider>
              <EditProvider>
                <FavoriteProvider>
                <WorkbenchProvider>
                  {/* 必须是 flex 容器：外壳靠 flex-1 撑满窗口。曾是普通 div，
                      外壳塌缩成内容高度，对话框"往上串"就是它。 */}
                  <div className="relative flex h-full w-full flex-col overflow-hidden" style={{ background: 'var(--bg-canvas)' }}>
                    <ZoomBoot />
                    <MainWindowShell />
                    <ToastLayer />
                  </div>
                </WorkbenchProvider>
                </FavoriteProvider>
              </EditProvider>
            </FeedbackProvider>
          </PersonalProvider>
        </SyncProvider>
      </SettingsProvider>
    </ToastProvider>
  );
}
