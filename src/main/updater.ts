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
 *  - **自动检查可关**（设置项 `autoCheckUpdates`，默认开）：关掉后不排任何定时检查、零外网请求；
 *    「检查更新」按钮不受它限制——那是用户的显式动作，不叫"自动检查"。
 */
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { logLine } from './appLog.ts';
import { notifySystem } from './notify.ts';
import { getUpdateFeedBase } from './updateFeed.ts';
import { UPDATE_FEED } from '../shared/constants.ts';
import { isVersionNewer } from '../shared/version.ts';

const CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AppUpdateEvent =
  | { type: 'available'; version: string }
  | { type: 'progress'; version: string; percent: number }
  | { type: 'downloaded'; version: string };

/** 更新源：github = 正式源（GitHub Releases）；mirror = 局域网镜像（管理员机 feed）。 */
export type UpdateSource = 'github' | 'mirror';

/** 更新器状态快照（设置页状态行读取；一次性拉取，不走推送）。 */
export interface AppUpdateStatus {
  /** 检查链是否已启用（只有打包版启用；开发态为 false）。 */
  active: boolean;
  /** 是否会自动检查（设置项 autoCheckUpdates）；false = 只有手点「检查更新」才会发请求。 */
  autoCheck: boolean;
  currentVersion: string;
  /** 最近一轮实际采用的源；null = 两个源都够不着（是常态，不是故障）。 */
  source: UpdateSource | null;
  /** 最近一轮的结论：已是最新 / 两个源都够不着；null = 还没跑过一轮。 */
  lastResult: 'latest' | 'unreachable' | null;
  /** 已发现的更高版本；null = 尚未发现。 */
  availableVersion: string | null;
  /** 下载完成、等待用户确认安装。 */
  readyToInstall: boolean;
  /**
   * 新版本包的后台下载进度（0–100）；null = 当前没有在下载。
   * 工作区小窗的圆形进度环读它（打开小窗时能立刻显示进度，不必等下一次 progress 事件）。
   */
  downloadPercent: number | null;
  /** 最近一轮失败的可读原因；null = 本轮没失败（旧错误会被清零，免得误导）。 */
  lastError: string | null;
  /** 最近一次检查完成时间（ISO）；null = 还没跑过一轮。 */
  lastCheckedAt: string | null;
}

/** 安装动作的结果：ok=false 时 reason 是给用户看的一句话（界面 toast 直接显示）。 */
export interface InstallUpdateResult {
  ok: boolean;
  reason?: string;
}

let started = false;
/** 事件出口（startAutoUpdater 注入）：runCheck 里的"复用已下载包"也要能播报事件。 */
let emitTo: ((event: AppUpdateEvent) => void) | null = null;
let inFlight: Promise<void> | null = null;
let announcedVersion: string | null = null;
/**
 * 本进程里 electron-updater 是否真的下载完成过。
 *
 * 为什么必须记它：electron-updater 的 downloadedUpdateHelper 是**进程内**状态，只有本进程
 * 执行过 downloadUpdate 才存在；跨重启复用的包它一概不知道，此时 quitAndInstall() 会抛
 * "No update filepath provided, can't quit and install"（2026-10-23 用户现场：1.1.2 下载完，
 * 第二天点「立即更新并重启」毫无反应，日志里全是这条）。所以安装要分两条路走。
 */
let downloadedInThisProcess = false;
/** 安装已发起：挡重复点击（失败会复位，允许重试）。 */
let installInFlight = false;
/** 配置加固的落地句柄：检查前先等它写完，免得与 setFeedURL 抢 clientPromise。 */
let configReady: Promise<void> | null = null;
/** 调试开关：开发态强制启用检查链（仅排障用，不会真的执行安装器）。 */
const debug = process.env.TL_UPD_DEBUG === '1';
/** 自动检查（设置项 autoCheckUpdates，默认开）：关掉后连定时器都不留；手点检查不受它限制。 */
let autoCheckEnabled = true;
/** 首次自动检查是否已跑过：决定下一次的间隔用"启动延迟"还是"周期"。 */
let autoCheckedOnce = false;
/** 上次推送下载进度的时刻（节流用；见 download-progress 处理器）。 */
let lastProgressAt = 0;
let autoTimer: NodeJS.Timeout | null = null;

const status = {
  source: null as UpdateSource | null,
  lastResult: null as 'latest' | 'unreachable' | null,
  availableVersion: null as string | null,
  readyToInstall: false,
  downloadPercent: null as number | null,
  lastError: null as string | null,
  lastCheckedAt: null as string | null,
};

function log(...parts: unknown[]): void {
  logLine('TL-UPD', ...parts);
  if (debug) console.log('[TL-UPD]', ...parts);
}

/** 「已下载待安装」的落盘记录：跨重启复用，避免重复下载（2026-10-19）。 */
interface PendingUpdate {
  version: string;
  /** 缓存目录里的安装包路径（记录时点的绝对值）。 */
  file: string;
  source: UpdateSource | null;
  at: string;
}

function pendingFile(): string {
  return join(app.getPath('userData'), 'config', 'update-pending.json');
}

/**
 * 读"已下载待安装"记录；记录里的文件**必须还在**才算数（用户可能清过缓存、
 * 或安全软件把它删了）——文件不在就当作没有并**顺手清掉这条死记录**，重新走下载。
 */
async function readPendingUpdate(): Promise<PendingUpdate | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(pendingFile(), 'utf8'));
    if (raw === null || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.version !== 'string' || typeof o.file !== 'string') {
      void clearPendingUpdate();
      return null;
    }
    try {
      await stat(o.file);
    } catch {
      // 记录在、文件没了：清掉它，别让下次检查反复读一条死记录。
      void clearPendingUpdate();
      return null;
    }
    return {
      version: o.version,
      file: o.file,
      source: (o.source === 'github' || o.source === 'mirror' ? o.source : null),
      at: typeof o.at === 'string' ? o.at : '',
    };
  } catch {
    return null;
  }
}

async function writePendingUpdate(info: { version: string; file: string }, source: UpdateSource | null): Promise<void> {
  try {
    await mkdir(dirname(pendingFile()), { recursive: true });
    const tmp = `${pendingFile()}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...info, source, at: new Date().toISOString() }, null, 2), 'utf8');
    await rename(tmp, pendingFile());
  } catch (err) {
    log('pending record write failed:', err);
  }
}

/** 装完了（或版本已经不低于它）就把记录清掉，免得下次又提示一个过期的版本。 */
async function clearPendingUpdate(): Promise<void> {
  try {
    await rm(pendingFile(), { force: true });
  } catch {
    // 删不掉也不影响功能：下次 read 时会因为文件不存在而当作没有
  }
}

/**
 * 把"上一轮已经下好、用户还没装"的包摆成可安装状态（复用或离线兜底）：不重下、不找 electron-updater。
 *
 * 复用也要提醒（2026-10-19）：用户上次可能没注意到，而这条记录只在"还没装"时存在；
 * 每次启动各提醒一次（进程内去重），装完记录自然消失。
 */
function reusePending(pending: PendingUpdate): void {
  status.availableVersion = pending.version;
  status.readyToInstall = true;
  status.downloadPercent = 100;
  status.source = pending.source;
  status.lastResult = null;
  status.lastError = null;
  status.lastCheckedAt = new Date().toISOString();
  log('pending update reused', { version: pending.version, file: pending.file });
  if (announcedVersion !== pending.version) {
    announcedVersion = pending.version;
    emitTo?.({ type: 'available', version: pending.version });
  }
  emitTo?.({ type: 'downloaded', version: pending.version });
  notifySystem({
    title: `新版本 v${pending.version} 已下载`,
    body: '点这里打开 TeamLaunch，点「立即更新并重启」完成安装',
  });
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

  /* ①先看有没有**上一轮已经下好、用户还没装**的包（2026-10-19 用户反馈："每次都会检测并自动下载，
     即使之前已下载但未安装"）。electron-updater 自己的 DownloadedUpdateHelper 只在同一进程内记着，
     跨重启就靠"缓存目录里那个文件"——我们不信推断，直接看自己落的记录 + 文件是否还在。 */
  const pending = await readPendingUpdate();
  if (pending !== null && !isVersionNewer(pending.version, app.getVersion())) {
    /* 记录里的版本已经不比当前新 = 那次安装成功了（或用户手动装了）：清掉记录，往下走正常检查。 */
    void clearPendingUpdate();
  }
  const reusable = pending !== null && isVersionNewer(pending.version, app.getVersion());

  const mirror = mirrorFeedUrl();
  // 两个源都探一次：既为选源，也用来判断本地已下好的包是不是源头最新的那个。
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
    /* 源不可达但本地已有下好的包：仍然算"可安装"（离线也能升）。
       否则这里会把就绪状态清掉，用户手里明明有包却再也装不上。 */
    if (reusable) reusePending(pending);
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

  /* 本地已下好的版本仍不落后于源头 → 直接复用，不重新下载（2026-10-19 的原始意图）。
     但源上若已有**比它更新**的版本，就必须往下走：否则一个下好没装的旧包会把新版本永久挡住
     （2026-10-23 用户现场：本地躺着 1.1.2、源上已经是 1.1.3，界面始终只提示 1.1.2）。 */
  if (reusable && (newest === null || !isVersionNewer(newest, pending.version))) {
    reusePending(pending);
    return;
  }

  /* 走到这里：要么没有可复用的包，要么源上已经有更新的版本。清掉上一轮遗留的"已就绪"，
     否则文件被清掉/记录失效之后，界面会一直显示"vX 已下载，点安装"——点下去只会报错
     （2026-10-19 自验时抓到的状态残留）。真需要的话下面的 checkForUpdates 会重新点亮它。 */
  if (status.readyToInstall || status.availableVersion !== null) {
    status.readyToInstall = false;
    status.availableVersion = null;
    status.downloadPercent = null;
  }

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

/**
 * 排下一次自动检查（自续期，不用 setInterval）。
 *
 * 为什么自续期：① 关掉开关要能**立刻**停掉后续请求，而不是让一个已排好的定时器到点再判断；
 * ② 一轮检查可能因为下载耗时远超间隔，setInterval 会叠出并发轮次。
 */
function scheduleAutoCheck(): void {
  if (autoTimer !== null) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  if (!started || !autoCheckEnabled) return;
  const delay = autoCheckedOnce ? CHECK_INTERVAL_MS : debug ? 3_000 : CHECK_DELAY_MS;
  autoTimer = setTimeout(() => {
    autoTimer = null;
    void check().finally(() => {
      autoCheckedOnce = true;
      scheduleAutoCheck();
    });
  }, delay);
}

/** 设置项 autoCheckUpdates 的落点：启动时按已存设置调用一次，用户改开关时再调用。 */
export function setAutoCheckEnabled(enabled: boolean): void {
  if (autoCheckEnabled === enabled) return;
  autoCheckEnabled = enabled;
  log('auto check', enabled ? 'enabled' : 'disabled');
  scheduleAutoCheck();
}

export function startAutoUpdater(emit: (event: AppUpdateEvent) => void): void {
  if (started || (!app.isPackaged && !debug)) return;
  started = true;
  emitTo = emit;
  log('start', { packaged: app.isPackaged, debug, version: app.getVersion() });

  configReady = useOwnUpdateConfig();

  /* 只发 NSIS 全量安装包：禁止 web 安装器这一形态（electron-updater 6.8.9 起会对默认值发告警）。
     我们从不发布 .web.exe，放开它等于多一个"feed 内容能触发的下载形态"——收紧。 */
  autoUpdater.disableWebInstaller = true;
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
    // 新一轮下载开始：进度归零（否则小窗会先亮上一轮的旧百分比）。
    status.downloadPercent = 0;
    // 同版本只播报一次：检查是周期性的，别把提示变成整点报时。
    if (announcedVersion === info.version) return;
    announcedVersion = info.version;
    emit({ type: 'available', version: info.version });
    // 系统级提示（2026-10-19 用户要求）：应用在后台也能看见。
    notifySystem({ title: `发现新版本 v${info.version}`, body: '正在后台下载，下载完成后会再提醒你安装' });
  });
  /* 下载进度（2026-10-18 用户要求小窗里有圆形进度条）：electron-updater 分块回调得很密，
     节流到约 4 次/秒再推给渲染层——进度环不需要更高刷新率，IPC 也不该被它刷屏；
     100% 与 0% 永远放行（首尾两个状态不能因为节流丢掉）。 */
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.max(0, Math.min(100, Math.round(p.percent)));
    status.downloadPercent = percent;
    const now = Date.now();
    if (percent !== 100 && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    emit({ type: 'progress', version: status.availableVersion ?? '', percent });
    log('progress:', `${percent}%`, `${Math.round(p.bytesPerSecond / 1024)} KB/s`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    status.availableVersion = info.version;
    status.readyToInstall = true;
    status.downloadPercent = 100;
    /* 本进程下载完的包：安装仍优先走 update-pending.json 那条自控路径（见 installDownloadedUpdate），
       这里只用于兜底"记录没写成功"的极端情况。 */
    downloadedInThisProcess = true;
    /* 落盘记住"哪个版本已经下好了"（2026-10-19）：重启或下一轮检查直接复用它，
       不再重复下载整包（用户反馈"即使之前已下载但未安装，每次都会重新下载"）。 */
    const file = (info as { downloadedFile?: string }).downloadedFile;
    if (typeof file === 'string' && file.length > 0) void writePendingUpdate({ version: info.version, file }, status.source);
    emit({ type: 'downloaded', version: info.version });
    // 系统级提示：这是"需要用户动手"的那一刻，必须走出应用也能看见。
    notifySystem({
      title: `新版本 v${info.version} 已下载`,
      body: '点这里打开 TeamLaunch，点「立即更新并重启」完成安装',
    });
  });
  autoUpdater.on('error', (err) => {
    // 静默：源不可达/校验失败都由下次检查自然重试；只落盘留证据，不打扰用户。
    status.lastError = err?.message ?? String(err);
    log('error:', err);
  });

  scheduleAutoCheck();
}

/** 手动检查（设置页「检查更新」）：跑完一轮再回答，界面据此刷新状态行。 */
export async function checkForUpdatesNow(): Promise<AppUpdateStatus> {
  /* 手动检查**不受** autoCheckUpdates 限制：那是用户的显式动作，不叫"自动检查"。
     关掉开关只停掉后台的定时检查，也让"公司网里完全不发请求"成为可能。 */
  await check();
  return getUpdateStatus();
}

export function getUpdateStatus(): AppUpdateStatus {
  return {
    active: started,
    autoCheck: autoCheckEnabled,
    currentVersion: app.getVersion(),
    source: status.source,
    lastResult: status.lastResult,
    availableVersion: status.availableVersion,
    readyToInstall: status.readyToInstall,
    downloadPercent: status.downloadPercent,
    lastError: status.lastError,
    lastCheckedAt: status.lastCheckedAt,
  };
}

/**
 * 读安装包同目录的 update-info.json（electron-updater 下载成功时写的）里的提权标记。
 * 读不到就当作不需要提权——与 electron-updater 的默认行为一致。
 */
async function isAdminRightsRequired(file: string): Promise<boolean> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(dirname(file), 'update-info.json'), 'utf8'));
    return raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).isAdminRightsRequired === true;
  } catch {
    return false;
  }
}

/** 起一个与本进程脱钩的子进程；等到系统真正创建进程（'spawn'）就算成功，不等它退出。 */
function spawnDetached(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}

/**
 * 静默运行已下载的 NSIS 安装包。参数与 electron-updater 的 NsisUpdater.doInstall 一致：
 * `--updated` 表示原地升级、`/S` 静默、`--force-run` 装完把应用拉回来。
 *
 * 提权：electron-builder 的安装器在"静默升级 per-machine 安装"时会自己走 UAC（installer.nsi
 * 里的 UAC_RunElevated），一般不用我们代劳；只有直接启动被系统拒绝（EACCES/UNKNOWN）时，
 * 才按 electron-updater 的做法改走 resources\elevate.exe。
 */
async function runDownloadedInstaller(file: string): Promise<void> {
  const args = ['--updated', '/S', '--force-run'];
  const elevate = join(process.resourcesPath, 'elevate.exe');
  if (await isAdminRightsRequired(file)) {
    log('install: 安装包要求管理员权限，走 elevate.exe');
    await spawnDetached(elevate, [file, ...args]);
    return;
  }
  try {
    await spawnDetached(file, args);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'UNKNOWN') throw err;
    log('install: 直接运行被系统拒绝，改走 elevate.exe', code);
    await spawnDetached(elevate, [file, ...args]);
  }
}

/**
 * 用户点了「立即更新并重启」：静默安装 + 重启回新版本（per-machine 安装会要一次 UAC）。
 *
 * 主路径是**自己运行已下载的安装包**（2026-10-23 修）：electron-updater 的
 * downloadedUpdateHelper 只活在下载进程里，跨重启后它的 quitAndInstall 直接抛
 * "No update filepath provided, can't quit and install"——用户看到的就是"点了没反应"。
 * 我们的 update-pending.json 记着包在哪、文件也验过还在，参数与 electron-updater 的
 * NsisUpdater.doInstall 完全一致（--updated /S --force-run），不依赖网络，也不依赖
 * 库的内部状态；同一进程内下载完的也走这条路，只有记录缺失时才退回 quitAndInstall。
 */
export async function installDownloadedUpdate(): Promise<InstallUpdateResult> {
  if (!started) return { ok: false, reason: '开发态没有安装器，无法自动安装' };
  if (installInFlight) return { ok: false, reason: '正在安装，请稍候' };
  installInFlight = true;

  const pending = await readPendingUpdate();
  /* 记录可能已经过期（用户手动装过/上一轮装成功了但还没轮到检查）：过期就清掉，绝不拿旧包降级。 */
  if (pending !== null && !isVersionNewer(pending.version, app.getVersion())) {
    void clearPendingUpdate();
  }
  if (pending !== null && isVersionNewer(pending.version, app.getVersion())) {
    log('install: 直接运行已下载的安装包', { version: pending.version, file: pending.file });
    try {
      await runDownloadedInstaller(pending.file);
    } catch (err) {
      installInFlight = false;
      const reason = `安装程序没能启动：${err instanceof Error ? err.message : String(err)}`;
      log('install: launch failed', err);
      return { ok: false, reason };
    }
    log('install: 安装器已启动，退出本体');
    /* 与 electron-updater 同款收尾：安装器起来后退出本体，让它替换文件；--force-run 装完会把应用拉回来。
       记录**不**在这里删：万一安装失败，下次启动还能用同一个包重试（版本真升上去时 runCheck 会自然忽略它）。 */
    setTimeout(() => app.quit(), 100);
    return { ok: true };
  }

  /* 记录缺失但本进程刚下载完：electron-updater 手里有句柄，只有它能装（极少数：落盘记录写失败）。 */
  if (downloadedInThisProcess) {
    log('quitAndInstall: 用户确认安装（本进程已下载，无待安装记录）');
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  }

  installInFlight = false;
  const reason = '没有找到已下载的安装包，请点「检查更新」重新下载';
  log('install: no pending update');
  return { ok: false, reason };
}
