/**
 * 全局热键（AC-05）：默认 `Ctrl+Space`，冲突可改键。
 *
 * 三条约束：
 *  - 注册失败**不弹窗、不静默抢占**，只上报一次；提示走主窗口 Banner 与设置页；
 *  - 同一个键切换唤起/收起；
 *  - 热键只做 `show()` —— 面板在启动时已预热（K-D）。
 */
import { globalShortcut } from 'electron';
import type { BrowserWindow } from 'electron';
import { togglePalette } from './windowManager.ts';

export type HotkeyStatus = 'registered' | 'conflict' | 'empty';

export interface HotkeyReport {
  accelerator: string;
  status: HotkeyStatus;
}

let conflictNotified = false;

export function registerHotkey(
  accelerator: string | null,
  mainWindow: BrowserWindow | null,
  onReport: (r: HotkeyReport) => void,
): HotkeyReport {
  globalShortcut.unregisterAll();
  if (!accelerator) {
    onReport({ accelerator: '', status: 'empty' });
    return { accelerator: '', status: 'empty' };
  }

  const ok = globalShortcut.register(accelerator, () => togglePalette());
  if (!ok) {
    // 不反复弹窗，也不静默抢占：本次会话只通知一次
    if (!conflictNotified) {
      conflictNotified = true;
      mainWindow?.webContents.send('tl:hotkey-conflict', { accelerator });
    }
    onReport({ accelerator, status: 'conflict' });
    return { accelerator, status: 'conflict' };
  }

  onReport({ accelerator, status: 'registered' });
  return { accelerator, status: 'registered' };
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
}
