/**
 * 自动更新客户端（electron-updater，generic provider，双源）。
 *
 * 源的角色（ADR-009，2026-10-16 决策）：
 *  - **正式源 = GitHub Releases**（UPDATE_FEED.githubBaseUrl）：公开用户、异地办公、
 *    以及"管理员机根本没在网"的场合都靠它；它是版本权威。
 *  - **局域网镜像 = 加速与回落**（updateFeed.ts 注册的管理员机 base + /updates/）：
 *    两边报同一个版本时从内网下载（快、不占公司出口带宽）；GitHub 不可达时由它供货。
 *
 * 选源规则（见 runCheck）：两个源各探一次 latest.yml；谁报的版本新听谁的，同为最新时
 * 优先局域网镜像。**关键点是镜像里没有该版本时必须回落 GitHub**——否则"管理员忘了把
 * 新版放进分发目录"会把全公司永久钉在旧版本上，而这种故障在界面上和"世界上还没有新版"
 * 长得一模一样，没人会去查。这也是镜像只能当回落、不能当优先源的原因。
 *
 * 纪律：
 *  - 只在打包版启用：开发态没有安装器语境，误跑只会制造假错误；
 *  - 两个源都够不着（公开用户没镜像 / 公司网封 GitHub）= 静默跳过，绝不报"更新失败"——
 *    源不可达是常态而非故障（与同步客户端的保守回落同一纪律）；
 *  - **下载自动、安装不自动**（autoInstallOnAppQuit = false）：装与重启由用户确认。
 *    这次关掉提示也不丢东西——已下载的包留在 `%LOCALAPPDATA%\teamlaunch-updater`
 *    缓存里，下次启动的检查会复用它并重新提示（electron-updater 的
 *    DownloadedUpdateHelper 专门处理"downloaded from some previous app launch"），
 *    不会重下整包。
 *  - 一切失败都落盘到 `%APPDATA%\TeamLaunch\logs\main.log`：这条链路曾经完全不可观测。
 */
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { logLine } from './appLog.ts';
import { getUpdateFeedBase } from './updateFeed.ts';
import { UPDATE_FEED } from '../shared/constants.ts';
import { isVersionNewer } from '../shared/version.ts';

const CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AppUpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'downloaded'; version: string };

/** 更新源：github = 正式源（GitHub Releases）；mirror = 局域网镜像（管理员机 feed）。 */
export type UpdateSource = 'github' | 'mirror';

/** 更新器状态快照（设置页状态行读取；一次性拉取，不走推送）。 */
export interface AppUpdateStatus {
  /** 检查链是否已启用（只有打包版启用；开发态为 false）。 */
  active: boolean;
  currentVersion: string;
  /** 最近一轮实际采用的源；null = 两个源都够不着（是常态，不是故障）。 */
  source: UpdateSource | null;
  /** 最近一轮的结论：已是最新 / 两个源都够不着；null = 还没跑过一轮。 */
  lastResult: 'latest' | 'unreachable' | null;
  /** 已发现的更高版本；null = 尚未发现。 */
  availableVersion: string | null;
  /** 下载完成、等待用户确认安装。 */
  readyToInstall: boolean;
  /** 最近一轮失败的可读原因；null = 本轮没失败（旧错误会被清零，免得误导）。 */
  lastError: string | null;
  /** 最近一次检查完成时间（ISO）；null = 还没跑过一轮。 */
  lastCheckedAt: string | null;
}

let started = false;
let inFlight: Promise<void> | null = null;
let announcedVersion: string | null = null;
/** 配置加固的落地句柄：检查前先等它写完，免得与 setFeedURL 抢 clientPromise。 */
let configReady: Promise<void> | null = null;
/** 调试开关：开发态强制启用检查链（仅排障用，不会真的执行安装器）。 */
const debug = process.env.TL_UPD_DEBUG === '1';

const status = {
  source: null as UpdateSource | null,
  lastResult: null as 'latest' | 'unreachable' | null,
  availableVersion: null as string | null,
  readyToInstall: false,
  lastError: null as string | null,
  lastCheckedAt: null as string | null,
};

function log(...parts: unknown[]): void {
  logLine('TL-UPD', ...parts);
  if (debug) console.log('[TL-UPD]', ...parts);
}

/**
 * 自己写一份更新器配置并指过去（加固，2026-10-12）。
 *
 * 为什么需要：electron-updater 下载前**必须**从配置里读 `updaterCacheDirName`
 * （AppUpdater.getOrCreateDownloadHelper → configOnDisk），默认读安装目录里的
 * `resources/app-update.yml`。而那个文件只在打包时能解析出 publish 配置才会写出
 * （本项目靠 package.json 的 repository 字段）——2026-10-07 之前打的安装包先天没有它，
 * 装出来的机器表现是"能发现新版本、下载前一刻抛 ENOENT、错误被静默吞掉、永远不更新"。
 * 写到可写的 userData 再指过去，安装包缺件就再也伤不到更新链路。
 */
async function useOwnUpdateConfig(): Promise<void> {
  try {
    const file = join(app.getPath('userData'), 'app-update.yml');
    // provider/url 每次检查前都会被 setFeedURL 覆盖；这里真正被读取的只有 updaterCacheDirName。
    await writeFile(file, 'provider: generic\nurl: http://127.0.0.1/\nupdaterCacheDirName: teamlaunch-updater\n', 'utf8');
    autoUpdater.updateConfigPath = file;
    log('own update config:', file);
  } catch (err) {
    log('own config write failed:', err);
  }
}

/**
 * 读某个源 latest.yml 里的版本号；够不着 / 该文件不存在 / 形状不认识都返回 null。
 *
 * 刻意不引 YAML 解析器：latest.yml 由 electron-builder 机器生成、形状稳定，我们只要
 * version 这一行；为一个字段引依赖（还要过 verify:deps 的锚定表）代价不成比例。
 */
async function probeFeedVersion(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/latest.yml?noCache=${Date.now()}`, {
      signal: AbortSignal.timeout(UPDATE_FEED.probeTimeoutMs),
    });
    if (!res.ok) return null;
    const match = /^version:\s*([^\s#]+)\s*$/m.exec(await res.text());
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** 局域网镜像的 feed 地址；管理员机不在网（尚未注册端点）时为 null。 */
function mirrorFeedUrl(): string | null {
  const base = getUpdateFeedBase();
  return base === null ? null : `${base}/updates`;
}

async function runCheck(): Promise<void> {
  if (configReady !== null) await configReady;
  const mirror = mirrorFeedUrl();
  // 两个源都探一次：不知道镜像里有没有"同一个新版本"，就决定不了该从哪儿下。
  const [githubVersion, mirrorVersion] = await Promise.all([
    probeFeedVersion(UPDATE_FEED.githubBaseUrl),
    mirror === null ? Promise.resolve(null) : probeFeedVersion(mirror),
  ]);
  status.lastCheckedAt = new Date().toISOString();

  if (githubVersion === null && mirrorVersion === null) {
    // 两个源都够不着：公开用户没有镜像、公司网可能封 GitHub——都是常态，不是故障。
    status.source = null;
    status.lastResult = 'unreachable';
    status.lastError = null;
    log('skip: no feed reachable', { mirrorRegistered: mirror !== null });
    return;
  }

  // 谁报的版本新听谁的；两处同样新时优先局域网镜像（内网快，且不占公司出口带宽）。
  const githubWins =
    githubVersion !== null && (mirrorVersion === null || isVersionNewer(githubVersion, mirrorVersion));
  const newest = githubWins ? githubVersion : mirrorVersion;
  const source: UpdateSource = githubWins ? 'github' : 'mirror';
  const feedUrl = githubWins ? UPDATE_FEED.githubBaseUrl : (mirror as string);
  status.source = source;
  status.lastError = null;

  if (newest === null || !isVersionNewer(newest, app.getVersion())) {
    // 没有比当前更新的版本。刻意**不**再让 electron-updater 跑一轮：两次探测已经回答了
    // 这个问句，重复发请求只是浪费（结论一致——见 shared/version.ts 的判定纪律）。
    status.lastResult = 'latest';
    log('no newer version', { source, newest, current: app.getVersion() });
    return;
  }

  status.lastResult = null;
  log('checking', `${feedUrl}/`, `目标 ${newest}（源 ${source}）`);
  try {
    // 端点可能随发现漂移，每次检查前重设 feed。
    autoUpdater.setFeedURL({ provider: 'generic', url: `${feedUrl}/` });
    const result = await autoUpdater.checkForUpdates();
    log('check done:', JSON.stringify(result?.updateInfo ?? null));
  } catch (err) {
    // 404（源上缺文件）/ 网络抖动 / 正在检查中：全是常态，静默重试。
    status.lastError = err instanceof Error ? err.message : String(err);
    log('check failed:', err);
  }
}

/** 同一时刻只允许一轮检查：周期检查与用户手点会撞上，撞上就复用进行中的那一轮。 */
function check(): Promise<void> {
  if (!started) return Promise.resolve();
  if (inFlight !== null) return inFlight;
  inFlight = runCheck().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startAutoUpdater(emit: (event: AppUpdateEvent) => void): void {
  if (started || (!app.isPackaged && !debug)) return;
  started = true;
  log('start', { packaged: app.isPackaged, debug, version: app.getVersion() });

  configReady = useOwnUpdateConfig();

  autoUpdater.autoDownload = true;
  // 下载自动做，安装不自动做：退出时悄悄装上是最容易被判为"这软件自己乱动"的行为。
  autoUpdater.autoInstallOnAppQuit = false;
  // 内部日志始终落盘（生产环境尤其需要）：排障时是唯一证据来源。
  autoUpdater.logger = {
    info: (...a: unknown[]) => log('eu:', ...a),
    warn: (...a: unknown[]) => log('eu-warn:', ...a),
    error: (...a: unknown[]) => log('eu-error:', ...a),
    debug: (...a: unknown[]) => log('eu-debug:', ...a),
  };
  // 调试模式额外让 electron-updater 在开发态也执行检查（否则它以"应用未打包"为由跳过）。
  if (debug) autoUpdater.forceDevUpdateConfig = true;

  autoUpdater.on('update-available', (info) => {
    status.availableVersion = info.version;
    status.readyToInstall = false;
    // 同版本只播报一次：检查是周期性的，别把提示变成整点报时。
    if (announcedVersion === info.version) return;
    announcedVersion = info.version;
    emit({ type: 'available', version: info.version });
  });
  autoUpdater.on('update-downloaded', (info) => {
    status.availableVersion = info.version;
    status.readyToInstall = true;
    emit({ type: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    // 静默：源不可达/校验失败都由下次检查自然重试；只落盘留证据，不打扰用户。
    status.lastError = err?.message ?? String(err);
    log('error:', err);
  });

  setTimeout(() => void check(), debug ? 3_000 : CHECK_DELAY_MS);
  setInterval(() => void check(), CHECK_INTERVAL_MS);
}

/** 手动检查（设置页「检查更新」）：跑完一轮再回答，界面据此刷新状态行。 */
export async function checkForUpdatesNow(): Promise<AppUpdateStatus> {
  await check();
  return getUpdateStatus();
}

export function getUpdateStatus(): AppUpdateStatus {
  return {
    active: started,
    currentVersion: app.getVersion(),
    source: status.source,
    lastResult: status.lastResult,
    availableVersion: status.availableVersion,
    readyToInstall: status.readyToInstall,
    lastError: status.lastError,
    lastCheckedAt: status.lastCheckedAt,
  };
}

/** 用户点了「立即更新并重启」：静默安装 + 重启回新版本（per-machine 安装会要一次 UAC）。 */
export function installDownloadedUpdate(): void {
  if (!started) return;
  log('quitAndInstall: 用户确认安装');
  autoUpdater.quitAndInstall(true, true);
}
