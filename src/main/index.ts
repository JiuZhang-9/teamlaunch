/**
 * 主进程入口 —— 只做装配，不含业务逻辑（Spec §4 代码组织铁律）。
 *
 * 装配顺序有依赖：单实例锁 → 窗口 → IPC → 同步广播 → 热键 → 托盘。
 * 迷你面板在窗口创建后立刻预热（K-D），不等热键第一次按下。
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createMainWindow, getMainWindow, getPalette, preheatPalette } from './windowManager.ts';
import { registerIpc } from './ipc.ts';
import { bindSyncBroadcast, installSyncService, syncService } from './syncBridge.ts';
import { startAutoUpdater } from './updater.ts';
import { installServerPort } from './serverPort.ts';
import {
  bypassLanProxy,
  createAdminSyncPort,
  createFallbackSyncPort,
  createLocalServerPort,
  startEmbeddedService,
  stopEmbeddedService,
  sweepService,
} from './backendService.ts';
import { registerHotkey, unregisterAll } from './hotkey.ts';
import { createTray, destroyTray } from './tray.ts';
import { acquireSingleInstanceLock, markQuitting } from './lifecycle.ts';
import { localStore } from './localStore.ts';
import { ensureDeviceIdentity } from './deviceIdentity.ts';
import { SettingsSchema, type Settings } from '../shared/schema/local.ts';
import { createMemberSyncClient, type MemberSyncClient } from './syncClient.ts';
import { createMemberServerPort } from './memberServerPort.ts';

/**
 * 多档案支持（单机双角色测试用）：`TL_PROFILE=emp` 让该实例用独立数据目录。
 * 必须在 ready 之前、取单实例锁之前设置——锁正是按 userData 目录隔离的，
 * 管理员档案与员工档案因此可以同机并存、互不干扰。
 */
const profile = process.env.TL_PROFILE?.trim();
if (profile && profile !== 'default') {
  app.setPath('userData', path.join(app.getPath('appData'), `TeamLaunch-${profile}`));
}

/** 装配期读到的设置，之后由设置面板的 patch 同步更新（客户端按它决定发现与轮询）。 */
let currentSettings: Settings = SettingsSchema.parse({});
let memberClient: MemberSyncClient | null = null;

/**
 * 装配后端（D-02：同步服务内嵌在管理员客户端进程内）。
 *
 * 角色闸门在这里：`role === 'admin'` 才起服务，默认 member 不起（安全默认值）。
 * 起不来就保持 syncBridge / serverPort 的保守回落，绝不伪造"已同步"。
 */
async function wireBackend(): Promise<void> {
  bypassLanProxy();
  currentSettings = await readSettingsSafe();
  await rewire(currentSettings.role);
}

/** 设置读取的守门人：手改/损坏的 settings.json 绝不能 brick 整个应用启动（回落默认值）。 */
async function readSettingsSafe(): Promise<Settings> {
  const stored = await localStore.settings<Partial<Settings>>({});
  const gate = SettingsSchema.safeParse(stored);
  return gate.success ? gate.data : SettingsSchema.parse({});
}

/**
 * 按角色装配：先收尾旧的，再按新角色起新的。
 *
 * 抽成独立函数是为了让**角色切换免重启**：用户在设置里开启管理员角色后，这里直接
 * 重新装配（停同步客户端 → 起内嵌服务 → 重装端口），界面随后就能设置口令。
 * installSyncService 会把广播订阅一起迁到新端口，渲染层立刻拿到新快照。
 */
async function rewire(role: string): Promise<void> {
  try {
    memberClient?.stop();
    memberClient = null;
    await stopEmbeddedService();

    const userData = app.getPath('userData');
    const started = await startEmbeddedService(userData, role);
    if (started) {
      // 管理员本机即权威源，直接给真实快照（不经 HTTP 往返）。
      installSyncService(createAdminSyncPort());
      installServerPort(createLocalServerPort());
      void syncService().refresh();
      return;
    }

    // 员工机：起同步客户端（L0→L3 发现 → 拉取 → 三重闸门 → 缓存 → 反馈队列）。
    // 遥测闸门在这里也过一遍：隐私门没确认就零上报（AC-18）。
    const identity = await ensureDeviceIdentity(userData);
    memberClient = await createMemberSyncClient({
      root: userData,
      deviceId: identity.deviceId,
      getSettings: () => currentSettings,
    });
    installSyncService(memberClient);
    installServerPort(createMemberServerPort(memberClient));
    // 遥测不在装配时做任何动作：canReportTelemetry 为 false 时上报函数直接返回 false。
  } catch {
    // 装配失败：如实回落 NEVER_SYNCED，手动刷新触发重试——绝不吞成冻结的旧状态。
    installSyncService(createFallbackSyncPort(() => rewire(currentSettings.role)));
  }
}

const allWindows = (): BrowserWindow[] =>
  [getMainWindow(), getPalette()].filter((w): w is BrowserWindow => Boolean(w) && !w!.isDestroyed());

/** 托盘开关真实生效：开启且不存在则创建，关闭则销毁（PRD 11.5：托盘常驻可关闭）。 */
function syncTray(): void {
  if (currentSettings.trayEnabled) void createTray({ refresh: () => void syncService().refresh() });
  else destroyTray();
}

if (!acquireSingleInstanceLock(() => {
  const main = getMainWindow();
  if (main) {
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
  }
})) {
  // 同一档案已有实例在跑：把焦点交给它，自己退出。
  app.quit();
} else {
  app.whenReady().then(async () => {
    await wireBackend();

    // 开机自启动的启动时同步（打包版）：登记只在勾选瞬间发生的话，"设置里已开启 → 重装/换机后
    // 不生效"，用户必须再勾一次才恢复。这里按已存设置双向对齐：true 登记成登录项，false 清掉
    // 残留条目。开发态仍跳过（否则把 electron.exe 挂进登录项，见 ipc.ts 同一守卫）。
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: currentSettings.autoLaunch });
    }

    const main = createMainWindow();
    preheatPalette();

    // 自动更新客户端（打包版才启用）：进展直推主窗口，由 toast 呈现。
    startAutoUpdater((event) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('tl:app-update', event);
    });

    registerIpc({
      getWindows: allWindows,
      closeToTray: () => currentSettings.trayEnabled,
      onHotkey: (status, accelerator) => {
        main.webContents.send('tl:hotkey-status', { status, accelerator });
      },
      // 设置一改，客户端下一轮就按新值走（手动端点 / 轮询间隔 / 遥测开关）。
      // 角色变化必须重新装配：否则改了 role 也要重启应用才生效，用户会以为开关没用。
      onSettingsPatch: (next) => {
        const roleChanged = currentSettings.role !== next.role;
        currentSettings = next;
        if (roleChanged) void rewire(next.role);
        syncTray();
        // 设置变更广播给所有窗口：主题（data-theme）在每个窗口各自的
        // SettingsProvider 里生效——不广播的话快捷窗口永远停在旧主题上。
        for (const win of allWindows()) {
          if (!win.isDestroyed()) win.webContents.send('tl:settings', next);
        }
      },
    });

    bindSyncBroadcast(allWindows);

    registerHotkey(currentSettings.hotkey, main, (report) => {
      main.webContents.send('tl:hotkey-status', report);
    });

    syncTray();

    // 恢复持久化的界面缩放（浏览器式 zoom，只影响主窗口）。
    main.webContents.setZoomFactor(currentSettings.uiZoom / 100);

    main.on('ready-to-show', () => main.show());

    // 清扫定时器：服务内不起定时器，由主进程驱动（挑战/令牌/nonce/限流窗口）
    const sweeper = setInterval(() => sweepService(), 60_000);

    app.on('before-quit', () => {
      // 先立退出标记再走关窗流程：palette 的 close 只有看到标记才会放行。
      markQuitting();
      clearInterval(sweeper);
      // 轮询定时器不清，进程退出后就是野定时器；客户端与服务都要显式收尾。
      memberClient?.stop();
      // 优雅关闭，否则 Fastify 会变成僵尸进程占着 17890
      void stopEmbeddedService();
    });

    app.on('will-quit', () => {
      unregisterAll();
      destroyTray();
    });

    app.on('window-all-closed', () => {
      // 关窗=隐藏（托盘常驻）时不会走到这里；托盘关闭时 X 就是真退出。
      if (process.platform !== 'darwin') app.quit();
    });
  });
}
