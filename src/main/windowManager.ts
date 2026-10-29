/**
 * 窗口管理 —— 主窗口 + 迷你唤起面板。
 *
 * K-D 的关键实现在这里：迷你面板**冷启动一次、之后只 show()/hide()**。
 * 用 close() 会让第二次唤起重新走一遍窗口创建与 React 挂载，
 * 开发者 SSD 本机测不出来，用户机械硬盘上会明显变慢。
 */
import { BrowserWindow, dialog, screen } from 'electron';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { isQuitting } from './lifecycle.ts';
import { logLine } from './appLog.ts';
import { loadWindowState, trackWindowBounds } from './windowState.ts';
import { loadPalettePosition, trackPalettePosition, type PalettePosition } from './paletteState.ts';
import { defaultBounds, isRestorableBounds } from '../shared/window-bounds.ts';
import { planSurface, type Surface, type SurfacePlan, type SurfaceSnapshot } from '../shared/surface-machine.ts';
import { ensureProgramsFresh } from './programIndex.ts';

/* 默认大小不再写死：2026-10-18 起由 windowState.defaultBounds() 按屏幕工作区自适应
   （用户反馈"起始默认窗口有点小，想大点，让页面能容纳更多卡片"——目标 1280×820，
   1366×768 的机器上自动收进工作区，不会顶出屏幕）。 */
/* 最小宽度 880：侧栏 240 + 内容区左右各 24 之后仍要留住 3–4 列卡片（704 时只剩 416px = 2 列）。
   与 design-tokens.css 的 --win-w-min 保持一致。 */
const MIN_W = 880;
const MIN_H = 480;
const PALETTE_W = 800;
/** 快捷窗口高度：与 design-tokens 的 --palette-h 同一个口径（1.5.1 再放大到 800×560）。 */
const PALETTE_H = 560;
/** 小屏夹紧的下限：再小就不像快捷面板了，宁可让系统把它挪进工作区。 */
const PALETTE_MIN_W = 480;
const PALETTE_MIN_H = 360;

let mainWindow: BrowserWindow | null = null;
let palette: BrowserWindow | null = null;
/** 用户拖到过的位置（1.5.1）：加载一次，show 时优先用它；没拖过就用默认居中。 */
let palettePosition: PalettePosition | null = null;
/** 隐藏/关闭前补一次立即写（节流计时器会随隐藏丢失最后一次拖动）。 */
let flushPalettePosition: (() => void) | null = null;

/**
 * 窗口可见性状态机（2026-10-27，1.2.0）：两面互斥、Ctrl+Space 先照顾主窗口。
 *
 * 判定本体在 shared/surface-machine.ts（不启动 Electron 也能测），这里只负责执行。
 * `activeSurface` 记「最后一次**显示**的是哪一面」，**不是**最后收起的那一面：
 * 从主窗口切到快捷窗口时主窗口只是让位，不该把「下次 Ctrl+Space 的目标」抢走。
 * 只活在主进程内存里——这是本次会话的交互状态，不写 settings、不跨机同步、不持久化。
 * 首次启动默认 `palette`：第一下仍然是唤起搜索面板（保持原手感）。
 */
let activeSurface: Surface = 'palette';

/**
 * 托盘开关的实时值（托盘关着时「收起主窗口」只能最小化，否则藏了没有任何可见入口）。
 * 由 index.ts 在启动时注入 getter，设置里随时改都按当时的值生效。
 */
let trayEnabledGetter: () => boolean = () => true;

export function setTrayEnabledGetter(getter: () => boolean): void {
  trayEnabledGetter = getter;
}

/** 快捷窗口本次打开的范围：入口搜索（默认）或本机程序搜索（Ctrl+Alt+F 专用）。 */
export type PaletteScope = 'entries' | 'programs';
let paletteScope: PaletteScope = 'entries';

/** 生产加载打包产物；开发加载 Vite dev server（由 TL_DEV_URL 注入）。 */
export function rendererUrl(hash = ''): string {
  if (process.env.TL_DEV_URL) return `${process.env.TL_DEV_URL}${hash}`;
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'index.html')
    : path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
  return `file://${base}${hash}`;
}

function windowOptions(extra: Electron.BrowserWindowConstructorOptions) {
  return {
    show: false,
    // 首帧前的底色：取允许直写的 #000（P0-2 例外），避免加载闪白；
    // 真正的画布色由渲染层 Token（--bg-canvas）接管。
    backgroundColor: '#000000',
    webPreferences: {
      // 从 main 产物自身位置推导，不依赖 app.getAppPath() 在打包/开发两种模式下的语义差异。
      // 打包后 main 在 app.asar/dist/main/index.cjs、preload 在 app.asar/dist/preload/index.cjs，
      // __dirname/../preload 是恒定关系；Electron 能直接从 asar 里读 preload。
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      /* 把**真实运行版本**交给 preload（→ 渲染层界面显示），而不是让界面用构建期常量：
         构建期常量取自打包时读到的 package.json，一旦"产物没重建就打包"就会与真实版本不一致
         （2026-10-17 出过一次：跳过 build 直接调 electron-builder，装完界面仍显示旧版本）。
         走 additionalArguments 不需要新开 IPC 通道。 */
      additionalArguments: [`--tl-app-version=${app.getVersion()}`],
    },
    ...extra,
  };
}

/**
 * preload 加载失败**必须吵出来**。
 *
 * 之前它是静默的：preload 没跑成 → 渲染层拿不到 window.tl → 回落 mock 宿主，
 * 用户看到的是"功能都在但点了没反应"，界面上还写着"预览模式"——
 * 一个故障被打扮成了正常状态，谁都不会想到去报"组件没加载"。
 *
 * 现在：写 %APPDATA%\TeamLaunch\logs\preload-error.log 留证据，
 * 再用 dialog.showErrorBox 弹出来（用户能截图，这是我们拿真实错误的唯一手段）。
 */
function reportPreloadError(preloadPath: string, error: Error): void {
  const detail = `${new Date().toISOString()}\npreload=${preloadPath}\n${error.stack ?? error.message}\n\n`;
  void (async () => {
    try {
      const dir = path.join(app.getPath('userData'), 'logs');
      await mkdir(dir, { recursive: true });
      await appendFile(path.join(dir, 'preload-error.log'), detail, 'utf8');
    } catch {
      // 日志写不进去也不能拦住弹窗——弹窗才是这一环的目的
    }
    dialog.showErrorBox(
      'TeamLaunch 启动故障',
      `应用组件未能加载，功能不可用。\n\n${preloadPath}\n\n${error.message}\n\n详细信息已写入用户数据目录 logs\\preload-error.log`,
    );
  })();
}

/** 给窗口挂上 preload 失败捕获。主窗口与迷你面板都要挂——面板同样依赖 window.tl。 */
function watchPreloadError(win: BrowserWindow): void {
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    reportPreloadError(preloadPath, error);
  });
}

/**
 * 建主窗口（2026-10-18 起 async：要先读回上次的位置与大小）。
 *
 * 恢复顺序：读 `config/window-state.json` → 校验矩形仍落在某个显示器工作区内
 * （外接屏拔掉后不按旧坐标摆放，回落居中默认）→ 建窗 → 需要时最大化 → 挂节流写盘。
 */
export async function createMainWindow(closeToTray: () => boolean): Promise<BrowserWindow> {
  const userData = app.getPath('userData');
  const saved = await loadWindowState(userData);
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const bounds = saved !== null && isRestorableBounds(saved, areas)
    ? saved
    : defaultBounds(screen.getPrimaryDisplay().workArea);

  mainWindow = new BrowserWindow(
    windowOptions({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(MIN_W, bounds.width),
      height: Math.max(MIN_H, bounds.height),
      minWidth: MIN_W,
      minHeight: MIN_H,
      frame: false,
      titleBarStyle: 'hidden',
      title: 'TeamLaunch',
    }),
  );
  if (bounds.maximized) mainWindow.maximize();
  watchPreloadError(mainWindow);
  /* 用户通过任务栏 / Alt+Tab 把主窗口拉到前台时，它才是「当前这一面」——
     否则 activeSurface 会停在快捷窗口上，下一次 Ctrl+空格的目标就错了。
     顺手收掉快捷窗口：互斥不能只靠调用方自觉（2026-10-27，1.2.0）。 */
  mainWindow.on('focus', () => {
    activeSurface = 'main';
    hidePalette();
  });
  const flushBounds = trackWindowBounds(userData, mainWindow);
  /* 关窗前补一次立即写：拖动后 500ms 内就关窗的话，节流计时器会随进程一起消失，
     最后一次调整的尺寸/位置就丢了。

     原生 close 必须收进统一策略（2026-10-23 用户反馈 Ctrl+W 后主窗口再也打不开）：
     Ctrl+W / Alt+F4 走的是窗口原生 close（Ctrl+W 来自 Electron 默认菜单的 Close Window），
     此前只挂存盘、直接销毁窗口；而快捷面板是常驻预热的，window-all-closed 不触发，
     进程活着但主窗口没了——托盘 / 热键 / Ctrl+Tab 全都对 null 直接返回，只能重启。
     现在与标题栏 X 同一语义：托盘开启时收进托盘（可随时唤起），托盘关闭时正常退出。 */
  mainWindow.on('close', (e) => {
    flushBounds();
    // 退出流程中的 close 必须放行，否则 app.quit() 永远完不成（与面板同一条纪律）。
    if (isQuitting()) return;
    e.preventDefault();
    if (closeToTray()) hideMainWindow();
    else app.quit();
  });
  void mainWindow.loadURL(rendererUrl());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** 预热：应用启动即创建并加载，热键只做 show() + focus()。 */
export function preheatPalette(): void {
  if (palette) return;
  palette = new BrowserWindow(
    windowOptions({
      width: PALETTE_W,
      height: PALETTE_H,
      frame: false,
      resizable: false,
      /* 1.5.1：允许用户手动拖动；位置由 paletteState.ts 记住（拖完下次还在这里）。 */
      movable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
    }),
  );
  watchPreloadError(palette);
  /* 面板拿到焦点 = 用户正在用这一面；activeSurface 必须跟着它走。 */
  palette.on('focus', () => {
    activeSurface = 'palette';
  });
  const userData = app.getPath('userData');
  void loadPalettePosition(userData).then((p) => {
    palettePosition = p;
  });
  /* 内存里的位置跟着窗口走：拖动后立刻隐藏/再显示时，positionPalette 用的是最新位置，
     不会退回默认位置（磁盘写是节流的，内存必须即时）。 */
  palette.on('move', () => {
    if (!palette || palette.isDestroyed()) return;
    const b = palette.getBounds();
    palettePosition = { x: b.x, y: b.y };
  });
  flushPalettePosition = trackPalettePosition(userData, palette);
  void palette.loadURL(rendererUrl('#/palette'));

  palette.on('close', (e) => {
    /* 退出/关窗前补一次立即写：拖动后 300ms 内就隐藏的话，节流计时器会丢。 */
    flushPalettePosition?.();
    // 退出流程中的 close 必须放行，否则 app.quit() 永远完不成（托盘"退出"失灵的根因）。
    // 日常关闭仍按"隐藏而非销毁"处理，保住二次唤起不走冷启动。
    if (isQuitting()) return;
    e.preventDefault();
    hidePalette();
  });

  // 启动器语义：点击面板以外的地方 = 收起。不加这条，用户只能靠再按一次热键关闭。
  palette.on('blur', () => {
    if (!isQuitting()) hidePalette();
  });
}

/* ---------------- 状态机执行层 ---------------- */

/** 把真实窗口状态喂给纯状态机（shared/surface-machine.ts）。 */
function surfaceSnapshot(): SurfaceSnapshot {
  const main = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const pal = palette && !palette.isDestroyed() ? palette : null;
  return {
    mainExists: main !== null,
    mainVisible: main?.isVisible() ?? false,
    mainMinimized: main?.isMinimized() ?? false,
    mainFocused: main?.isFocused() ?? false,
    paletteExists: pal !== null,
    paletteVisible: pal?.isVisible() ?? false,
    activeSurface,
    trayEnabled: trayEnabledGetter(),
  };
}

/** 收起主窗口（进托盘）。托盘关着时不能 hide——藏了没有任何可见入口能把它找回来。 */
export function hideMainWindow(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.hide();
  return true;
}

function minimizeMainWindow(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.minimize();
  return true;
}

/** 按托盘开关让主窗口让位：托盘开 → 隐藏；托盘关 → 最小化（任务栏里还留着）。 */
function dismissMainWindow(): boolean {
  return trayEnabledGetter() ? hideMainWindow() : minimizeMainWindow();
}

/** 把主窗口拿到前台：最小化先还原，隐藏/在后台的 show + focus 一步到位。 */
function focusMainWindow(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  activeSurface = 'main';
  /* 通知渲染层"主窗口被重新唤起"（2026-10-29）：可见性变化只在隐藏/最小化时触发，
     被别的窗口挡住时 Ctrl+Space 只会 focus，不会触发 visibilitychange。
     渲染层收到后把搜索框置真并重读剪贴板、选中项回到第一条。 */
  mainWindow.webContents.send('tl:main-shown');
  return true;
}

function executePlan(plan: SurfacePlan): boolean {
  switch (plan.kind) {
    case 'noop':
      return false;
    case 'hidePalette':
      return hidePalette();
    case 'hideMain':
      return plan.minimize ? minimizeMainWindow() : dismissMainWindow();
    case 'focusMain':
    case 'showMain':
      return showMainWindow();
    case 'showPalette':
      return showPaletteNow('entries', plan.hideMain);
  }
}

/**
 * 快捷面板 → 主窗口（面板里 Ctrl+Tab / 「进入主窗口」）。
 * 统一走 showMainWindow：先收面板再还原，互斥由它保证。
 */
export function switchToMain(): boolean {
  return showMainWindow();
}

/**
 * 主窗口 → 快捷面板（主窗口里 Ctrl+Tab）。
 * 托盘开着时主窗口进托盘；托盘关着时最小化——两种都保证两面不同时可见。
 */
export function switchToPalette(): boolean {
  if (!palette || palette.isDestroyed()) return false;
  return showPalette('entries');
}

/**
 * 全局热键（Ctrl+空格）的唯一动作。
 *
 * 定稿语义（2026-10-27 用户确认）：Ctrl+Tab 负责两面互换，Ctrl+空格只开关当前可见的那一面。
 *  - 快捷窗口可见 → 只收起它（回主窗口走 Ctrl+Tab）；
 *  - 主窗口在屏幕上（有焦点 / 被别的窗口挡住 / 最小化）→ 只作用于主窗口，绝不去开快捷窗口；
 *  - 两面都不可见 → 打开上次显示过的那一面。
 * 判定全在 shared/surface-machine.ts，这里只执行。
 */
export function handleHotkeySurface(): void {
  executePlan(planSurface('toggle', surfaceSnapshot()));
}

/**
 * 第二个全局热键（Ctrl+Alt+F）：打开快捷窗口并直接进入「本机程序」范围。
 *
 * 与 Ctrl+空格的区别：这里不关心"上次收起的是谁"，目标始终是程序搜索窗口；
 * 面板已经在程序范围且在最前时，再按一次收起（和启动器的手感一致）。
 */
export function handleHotkeySearch(): void {
  if (!palette || palette.isDestroyed()) {
    preheatPalette();
    const created = palette;
    if (created) {
      created.webContents.once('did-finish-load', () => {
        if (created === palette && !created.isDestroyed()) showPalette('programs');
      });
    }
    return;
  }
  if (palette.isVisible() && paletteScope === 'programs' && palette.isFocused()) {
    hidePalette();
    return;
  }
  showPalette('programs');
}

/**
 * 面板窗口的不透明度（2026-10-19 用户要求）：整数百分比 60–100。
 * 返回**实际生效**的值（Electron 可能夹紧）——调用方据此判断，别自己假设成功了。
 * 窗口已存在才生效；不存在时只记设置，下次预热创建后由调用方再应用一次。
 */
export function setPaletteOpacity(percent: number): number {
  const target = Math.min(1, Math.max(0.6, percent / 100));
  if (palette && !palette.isDestroyed()) {
    palette.setOpacity(target);
    const applied = Math.round(palette.getOpacity() * 100);
    // 落盘留痕（与更新链路同一纪律）：透明度是"看不见就没法确认"的设置，
    // 排障时至少能回答"它到底设进去没有、设成了多少"。
    logLine('TL-PAL', 'opacity', `${applied}%`);
    return applied;
  }
  return Math.round(percent);
}

/** 把主窗口拿到前台（点系统通知的默认动作 / 托盘菜单都用它）。先收快捷窗口，保证互斥。 */
export function showMainWindow(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  hidePalette();
  return focusMainWindow();
}

/** 面板定位：优先用用户拖到的位置；否则放在主窗口所在显示器、顶距 20%。 */
function positionPalette(): void {
  if (!palette || palette.isDestroyed()) return;
  const main = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  let area: Electron.Rectangle;
  let displayId: number;
  if (palettePosition !== null) {
    /* 用户拖过：按拖到的位置所在显示器来夹，不跟着主窗口跑。 */
    const display = screen.getDisplayNearestPoint(palettePosition);
    area = display.workArea;
    displayId = display.id;
  } else if (main) {
    const b = main.getNormalBounds();
    const display = screen.getDisplayNearestPoint({
      x: b.x + Math.round(b.width / 2),
      y: b.y + Math.round(b.height / 2),
    });
    area = display.workArea;
    displayId = display.id;
  } else {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    area = display.workArea;
    displayId = display.id;
  }
  /* 1.5.1：面板 800×560，但小屏/高缩放下要夹进工作区——
     高度给上下留 160px（顶距 20% + 底部余量），宽度给左右留 80px。 */
  const width = Math.min(PALETTE_W, Math.max(PALETTE_MIN_W, area.width - 80));
  const height = Math.min(PALETTE_H, Math.max(PALETTE_MIN_H, area.height - 160));
  let x: number;
  let y: number;
  if (palettePosition !== null) {
    x = Math.min(Math.max(palettePosition.x, area.x), area.x + area.width - width);
    y = Math.min(Math.max(palettePosition.y, area.y), area.y + area.height - height);
  } else {
    x = Math.round(area.x + (area.width - width) / 2);
    y = Math.round(area.y + area.height * 0.20);
  }
  /* setBounds 而不是 setPosition：顺带把尺寸钉回常量，窗口被系统/缩放改过之后也不会带着旧尺寸乱跑。
     位置与尺寸写进日志——用户报过"弹到左上侧"，下次直接看得到我们算的是哪个坐标、哪块屏。 */
  palette.setBounds({ x, y, width, height }, false);
  logLine('TL-PAL', 'position', `${x},${y} ${width}x${height} display=${displayId}${palettePosition !== null ? ' saved' : ''}`);
}

/**
 * 打开快捷窗口。
 *
 * scope 只影响渲染层的搜索范围：entries=入口搜索（默认），programs=本机程序搜索。
 * 事件在窗口还在加载时可能丢——这里用 did-finish-load 兜底，保证冷启动按热键也能拿到范围。
 */
export function showPalette(scope: PaletteScope = 'entries'): boolean {
  if (!palette || palette.isDestroyed()) return false;
  const plan = planSurface('showPalette', surfaceSnapshot());
  if (plan.kind !== 'showPalette') return false;
  return showPaletteNow(scope, plan.hideMain);
}

/** 按状态机给出的让位方式打开面板；showPalette / executePlan 共用，避免两套判定。 */
function showPaletteNow(scope: PaletteScope, hideMain: 'hide' | 'minimize' | 'none'): boolean {
  if (!palette || palette.isDestroyed()) return false;
  if (hideMain === 'hide') hideMainWindow();
  else if (hideMain === 'minimize') minimizeMainWindow();

  paletteScope = scope;
  positionPalette();
  palette.show();
  palette.focus();
  activeSurface = 'palette';

  // 每次打开顺手检查索引是否过期（24h）；过期只在后台重扫，不阻塞本次搜索。
  ensureProgramsFresh();

  const sendScope = (): void => {
    if (palette && !palette.isDestroyed()) {
      palette.webContents.send('tl:palette-shown', { scope });
    }
  };
  if (palette.webContents.isLoading()) palette.webContents.once('did-finish-load', sendScope);
  else sendScope();
  return true;
}

export function hidePalette(): boolean {
  if (!palette || palette.isDestroyed()) return false;
  if (!palette.isVisible()) return false;
  /* 拖动后 300ms 内就收起：节流计时器会随隐藏一起消失，这里补一次立即写。 */
  flushPalettePosition?.();
  /* activeSurface 刻意不动：刚收起面板，下一次 Ctrl+空格应该还能把它打开（1.1.3 的手感）。 */
  palette.webContents.send('tl:palette-hidden');
  palette.hide();
  return true;
}

export function getPalette(): BrowserWindow | null {
  return palette;
}
