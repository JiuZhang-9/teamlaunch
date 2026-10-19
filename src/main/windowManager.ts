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
import { defaultBounds, isRestorableBounds } from '../shared/window-bounds.ts';

/* 默认大小不再写死：2026-10-18 起由 windowState.defaultBounds() 按屏幕工作区自适应
   （用户反馈"起始默认窗口有点小，想大点，让页面能容纳更多卡片"——目标 1280×820，
   1366×768 的机器上自动收进工作区，不会顶出屏幕）。 */
/* 最小宽度 880：侧栏 240 + 内容区左右各 24 之后仍要留住 3–4 列卡片（704 时只剩 416px = 2 列）。
   与 design-tokens.css 的 --win-w-min 保持一致。 */
const MIN_W = 880;
const MIN_H = 480;
const PALETTE_W = 560;

let mainWindow: BrowserWindow | null = null;
let palette: BrowserWindow | null = null;

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
export async function createMainWindow(): Promise<BrowserWindow> {
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
  const flushBounds = trackWindowBounds(userData, mainWindow);
  /* 关窗前补一次立即写：拖动后 500ms 内就关窗的话，节流计时器会随进程一起消失，
     最后一次调整的尺寸/位置就丢了。 */
  mainWindow.on('close', flushBounds);
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
      height: 420,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
    }),
  );
  watchPreloadError(palette);
  void palette.loadURL(rendererUrl('#/palette'));

  palette.on('close', (e) => {
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

export function togglePalette(): void {
  if (!palette) {
    preheatPalette();
    return;
  }
  if (palette.isVisible()) hidePalette();
  else showPalette();
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

/** 把主窗口拿到前台（点系统通知的默认动作 / 托盘菜单都用它）。 */
export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

export function showPalette(): void {
  if (!palette || palette.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const y = Math.round(area.y + area.height * 0.18);
  const x = Math.round(area.x + (area.width - PALETTE_W) / 2);
  palette.setPosition(x, y, false);
  palette.show();
  palette.focus();
  palette.webContents.send('tl:palette-shown');
}

export function hidePalette(): void {
  if (!palette || palette.isDestroyed()) return;
  palette.webContents.send('tl:palette-hidden');
  palette.hide();
}

export function getPalette(): BrowserWindow | null {
  return palette;
}
