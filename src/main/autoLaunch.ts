/**
 * 开机自启登记与「这次是不是登录启动」。
 *
 * Windows 的 getLoginItemSettings() 没有 wasOpenedAtLogin（那是 macOS 字段），
 * 所以登录项自带参数 `--autostart`，启动时看 argv。旧版本注册的条目不带参数，
 * 但 index.ts 每次启动都会按当前设置重写一次登录项，升级后第一次启动即补齐。
 */
import { app } from 'electron';

const AUTOSTART_FLAG = '--autostart';

/** 按设置登记 / 注销登录项；开发态不写系统启动项（否则会把 electron.exe 挂进登录项）。 */
export function applyAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? [AUTOSTART_FLAG] : [] });
}

/** second-instance 的 argv 也要能判断：登录触发的第二实例不该抢前台。 */
export function launchedByAutostart(argv: readonly string[] = process.argv): boolean {
  return argv.includes(AUTOSTART_FLAG);
}
