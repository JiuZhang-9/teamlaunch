/**
 * 全局热键（AC-05）：默认 `Ctrl+Space` 唤起上次收起的窗口；
 * 2026-10-24 起新增 `Ctrl+Alt+F`：直接打开快捷窗口的「本机程序」搜索范围。
 *
 * 四条约束：
 *  - 注册失败**不弹窗、不静默抢占**，每个键每次会话只上报一次；
 *  - 两个键分别注册、分别上报（不能因为一个冲突把另一个也注销）；
 *  - 同一个键是**开关**：唤起上次收起的那一面（主窗口或快捷面板），它已在最前就收起它；
 *  - 热键只做 `show()` —— 面板在启动时已预热（K-D）。
 */
import { globalShortcut } from 'electron';
import type { BrowserWindow } from 'electron';
import type { GlobalHotkeyKind } from '../shared/app-hotkeys.ts';
import { handleHotkeySearch, handleHotkeySurface } from './windowManager.ts';
import { logLine } from './appLog.ts';

export type HotkeyStatus = 'registered' | 'conflict' | 'empty';

export interface HotkeyReport {
  accelerator: string;
  status: HotkeyStatus;
  kind: GlobalHotkeyKind;
}

export interface GlobalHotkeyConfig {
  surface: string | null;
  search: string | null;
}

const conflictNotified = new Set<string>();

function normalize(accelerator: string | null | undefined): string | null {
  const value = (accelerator ?? '').trim();
  return value.length > 0 && value !== 'none' ? value : null;
}

function registerOne(
  accelerator: string | null,
  kind: GlobalHotkeyKind,
  handler: () => void,
  mainWindow: BrowserWindow | null,
  onReport: (r: HotkeyReport) => void,
): HotkeyReport {
  if (accelerator === null) {
    const report: HotkeyReport = { accelerator: '', status: 'empty', kind };
    onReport(report);
    return report;
  }

  let ok: boolean;
  try {
    ok = globalShortcut.register(accelerator, handler);
  } catch {
    // 手动改坏的加速器串：按"冲突/不可用"上报，绝不让启动或设置保存抛出去。
    ok = false;
  }
  /* 注册结果落盘（2026-10-19）：用户报"Ctrl+空格设不进去"，而这条链路上
     "系统不让注册"与"界面没记下来"表现很像——把结果写进日志，下次直接看得到是谁的问题。 */
  logLine('TL-HOTKEY', ok ? 'registered' : 'conflict', `${kind}:${accelerator}`);

  if (!ok) {
    // 不反复弹窗，也不静默抢占：每个键每次会话只通知一次（按 kind + 键位去重）。
    const conflictKey = `${kind}:${accelerator}`;
    if (!conflictNotified.has(conflictKey)) {
      conflictNotified.add(conflictKey);
      mainWindow?.webContents.send('tl:hotkey-conflict', { accelerator, kind });
    }
    const report: HotkeyReport = { accelerator, status: 'conflict', kind };
    onReport(report);
    return report;
  }

  const report: HotkeyReport = { accelerator, status: 'registered', kind };
  onReport(report);
  return report;
}

/**
 * 注册两个全局热键。调用方每次改键都应整组重注册（内部先 unregisterAll）——
 * 只重注册一个会把另一个悄悄注销，这是单键时代遗留的坑。
 */
export function registerHotkeys(
  config: GlobalHotkeyConfig,
  mainWindow: BrowserWindow | null,
  onReport: (r: HotkeyReport) => void,
): HotkeyReport[] {
  globalShortcut.unregisterAll();
  const surface = normalize(config.surface);
  const search = normalize(config.search);

  const reports: HotkeyReport[] = [];
  reports.push(registerOne(surface, 'surface', () => handleHotkeySurface(), mainWindow, onReport));

  if (search !== null && search === surface) {
    /* 两个热键写成同一个键：系统只允许注册一次。后注册的必然失败，
       与其让 Electron 返回一个含糊的 false，不如明确按"冲突"上报。 */
    logLine('TL-HOTKEY', 'conflict', `search:${search} (same as surface)`);
    const conflictKey = `search:${search}`;
    if (!conflictNotified.has(conflictKey)) {
      conflictNotified.add(conflictKey);
      mainWindow?.webContents.send('tl:hotkey-conflict', { accelerator: search, kind: 'search' });
    }
    const report: HotkeyReport = { accelerator: search, status: 'conflict', kind: 'search' };
    onReport(report);
    reports.push(report);
  } else {
    reports.push(registerOne(search, 'search', () => handleHotkeySearch(), mainWindow, onReport));
  }

  return reports;
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
}
