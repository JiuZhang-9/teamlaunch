/**
 * 自动更新客户端（electron-updater，generic provider）。
 *
 * 更新源 = 团队同步服务所在的机器（updateFeed.ts 注册的 base）+ /updates/：
 * 管理员机构建后把 latest.yml + 安装包 + blockmap 丢进 userData\updates，
 * 员工机在同一局域网内自动检查、差量下载、提示重启更新。
 *
 * 纪律：
 *  - 只在打包版启用：开发态没有安装器语境，误跑只会制造假错误；
 *  - 没有端点（员工未连上 / 管理员服务未起）= 静默跳过，绝不报"更新失败"——
 *    局域网源不可达是常态而非故障（与同步客户端的保守回落同一纪律）；
 *  - 下载完成才提示；autoInstallOnAppQuit 保持默认——用户哪怕不理提示，
 *    下次正常退出时也会自动装上，重启即新版。
 */
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { getUpdateFeedBase } from './updateFeed.ts';

const CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AppUpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'downloaded'; version: string };

let started = false;
let announcedVersion: string | null = null;
let checking = false;
/** 调试开关：开发态强制启用检查链（仅排障用，不会真的执行安装器）。 */
const debug = process.env.TL_UPD_DEBUG === '1';
const log = (...parts: unknown[]): void => {
  if (debug) console.log('[TL-UPD]', ...parts);
};

async function check(): Promise<void> {
  if (!started || checking) return;
  const base = getUpdateFeedBase();
  if (!base) {
    log('skip: no feed base');
    return;
  }
  checking = true;
  log('checking', `${base}/updates/`);
  try {
    // 端点可能随发现漂移，每次检查前重设 feed。
    autoUpdater.setFeedURL({ provider: 'generic', url: `${base}/updates/` });
    const result = await autoUpdater.checkForUpdates();
    log('check done:', JSON.stringify(result?.updateInfo ?? null));
  } catch (err) {
    // 404（还没有新版本文件）/ 网络不可达 / 正在检查中：全是常态，静默。
    log('check failed:', err instanceof Error ? err.message : err);
  } finally {
    checking = false;
  }
}

export function startAutoUpdater(emit: (event: AppUpdateEvent) => void): void {
  if (started || (!app.isPackaged && !debug)) return;
  started = true;
  log('start', { packaged: app.isPackaged, debug });

  autoUpdater.autoDownload = true;
  // 调试模式让 electron-updater 自己的内部日志也出来（feed 抓取/解析/下载细节），
  // 并强制它在开发态也执行检查（否则它以"应用未打包"为由直接跳过）。
  if (debug) autoUpdater.forceDevUpdateConfig = true;
  autoUpdater.logger = debug ? { info: (...a) => log('eu:', ...a), warn: (...a) => log('eu-warn:', ...a), error: (...a) => log('eu-error:', ...a), debug: (...a) => log('eu-debug:', ...a) } : null;

  autoUpdater.on('update-available', (info) => {
    // 同版本只播报一次：检查是周期性的，别把 toast 变成整点报时。
    if (announcedVersion === info.version) return;
    announcedVersion = info.version;
    emit({ type: 'available', version: info.version });
  });
  autoUpdater.on('update-downloaded', (info) => {
    emit({ type: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    // 静默：源不可达/校验失败都由下次检查自然重试；不打扰用户。
    log('error:', err?.message ?? err);
  });

  setTimeout(() => void check(), debug ? 3_000 : CHECK_DELAY_MS);
  setInterval(() => void check(), CHECK_INTERVAL_MS);
}

/** 用户点了「立即更新并重启」：静默安装 + 重启回新版本（perMachine 会要一次 UAC）。 */
export function installDownloadedUpdate(): void {
  if (!started) return;
  autoUpdater.quitAndInstall(true, true);
}
