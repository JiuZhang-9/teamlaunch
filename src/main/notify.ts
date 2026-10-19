/**
 * 系统通知（2026-10-19 用户要求："右下角弹窗，之前做的是应用内弹窗，现在需要改为全局的 Windows 弹窗"）。
 *
 * 用 Electron 的 `Notification`——Windows 10/11 上它就是系统级的 toast：**应用在后台、最小化、
 * 甚至被托盘藏着，用户也能看到**；点一下就回到主窗口。这是应用内 Toast 做不到的事，
 * 也正是"更新好了但用户没注意"这类问题的根因。
 *
 * 三条纪律：
 *  1. **只给"值得打扰"的事**：新公告、发现新版本、新版本已下载待安装。条目开失败、容量提示这类
 *     交互内的即时反馈仍留在应用内（用户此刻就在看着界面，弹系统通知是噪音）。
 *  2. **同内容不重复打扰**：同一版本/同一篇公告只发一次（调用方各自去重，这里再兜一层"标题+正文"指纹）。
 *  3. **失败静默、但落盘**：系统通知可能被用户关掉/被专注助手吞掉；发不出去不影响功能，
 *     只写一行日志（`[TL-NOTIFY]`），便于排障。
 */
import { Notification } from 'electron';
import { logLine } from './appLog.ts';
import { getMainWindow, showMainWindow } from './windowManager.ts';

/** 最近发出的通知指纹（进程内去重；重启后允许再发一次，因为用户可能错过了）。 */
const sent = new Set<string>();

export interface SystemNoticeOptions {
  title: string;
  body: string;
  /** 点击通知时把焦点给哪个窗口；缺省＝主窗口。 */
  onClick?(): void;
}

/** 系统支持吗（Windows 上恒为 true；留这个判断是为了在受限环境下不炸）。 */
export function canNotify(): boolean {
  try {
    return Notification.isSupported();
  } catch {
    return false;
  }
}

export function notifySystem({ title, body, onClick }: SystemNoticeOptions): boolean {
  const fingerprint = `${title}\u0000${body}`;
  if (sent.has(fingerprint)) return false;
  if (!canNotify()) {
    logLine('TL-NOTIFY', 'unsupported', title);
    return false;
  }
  try {
    const notice = new Notification({ title, body, silent: false });
    notice.on('click', () => {
      if (onClick) {
        onClick();
        return;
      }
      // 默认动作：把主窗口拿到前台（用户点通知的意图就是"我要去看"）。
      const win = getMainWindow();
      if (win && !win.isDestroyed()) showMainWindow();
    });
    notice.show();
    sent.add(fingerprint);
    // 去重集合别无限长：够挡住同一批事件即可。
    if (sent.size > 50) sent.clear();
    logLine('TL-NOTIFY', 'shown', title);
    return true;
  } catch (err) {
    logLine('TL-NOTIFY', 'failed', err instanceof Error ? err.message : String(err));
    return false;
  }
}
