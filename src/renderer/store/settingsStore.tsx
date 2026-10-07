/**
 * 本机设置（settings.json 的内存镜像）。
 * 主题、遥测开关、热键等一律从这里读；写操作只有 patch 一个出口。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../bridge/index.ts';
import { applyAccentColor } from '../lib/color.ts';
import type { Settings } from '../../shared/schema/local.ts';

type ThemeSetting = Settings['theme'];

interface SettingsCtx {
  settings: Settings;
  patch(patch: Partial<Settings>): Promise<void>;
  /** 解析后的实际主题：跟随系统时读取系统偏好，读取失败兜底深色（D-06，且不弹任何提示）。 */
  resolvedTheme: 'light' | 'dark';
}

const Ctx = createContext<SettingsCtx | null>(null);

function systemTheme(): 'light' | 'dark' {
  try {
    if (!window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => api.settings.get());
  const [system, setSystem] = useState<'light' | 'dark'>(systemTheme);

  // 跨窗口同步：任意窗口改了设置（主题/缩放/热键…）都广播到每个窗口，
  // 本窗口的 data-theme/界面随之更新——快捷窗口主题不同步的根因就是缺这条。
  useEffect(() => api.events.onSettingsChanged(setSettings), []);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    settings.theme === 'system' ? system : (settings.theme as 'light' | 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  // 主题色：accentColor 或主题切换时重算派生变量（深色模式整体提亮，见 lib/color.ts）。
  useEffect(() => {
    applyAccentColor(settings.accentColor, resolvedTheme);
  }, [settings.accentColor, resolvedTheme]);

  const patch = useCallback(async (p: Partial<Settings>) => {
    const next = await api.settings.patch(p);
    setSettings(next);
  }, []);

  const value = useMemo<SettingsCtx>(
    () => ({ settings, patch, resolvedTheme }),
    [settings, patch, resolvedTheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings 必须在 SettingsProvider 内使用');
  return v;
}

export type { ThemeSetting };
