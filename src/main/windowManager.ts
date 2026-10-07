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

const WIN_W = 1040;
const WIN_H = 720;
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

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow(
    windowOptions({
      width: WIN_W,
      height: WIN_H,
      minWidth: MIN_W,
      minHeight: MIN_H,
      frame: false,
      titleBarStyle: 'hidden',
      title: 'TeamLaunch',
    }),
  );
  watchPreloadError(mainWindow);
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
