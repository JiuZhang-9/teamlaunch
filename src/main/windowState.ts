/**
 * 主窗口的位置与大小记忆（2026-10-18 用户要求）：
 * "现在每次打开窗口的位置和大小都不记忆，重新打开会恢复默认，需要设置一下，使其能记忆上次的位置和大小。"
 *
 * 归属：这是**机器维护的状态**，不是用户意图——按 ARCHITECTURE §5.2 的纪律不进 settings.json
 * （settings 只放用户显式的选择），单独一个 `config/window-state.json`。
 *
 * 本文件只管 IO 与事件接驳；"这个矩形还能不能用"与"默认该多大"两条判定在
 * `shared/window-bounds.ts`（纯函数，进 smoke）。
 *
 * 写盘节流：拖动/缩放窗口会连续触发 resize/move，不节流就是每帧一次磁盘写（K-05 的反面教材）。
 * 按 500ms 合并，并在窗口关闭前补一次立即写。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WindowBounds } from '../shared/window-bounds.ts';

export type { WindowBounds };

const FILE = path.join('config', 'window-state.json');
const DEBOUNCE_MS = 500;

function filePath(userData: string): string {
  return path.join(userData, FILE);
}

/** 读上次的窗口矩形；读不到 / 形状不认识就返回 null（调用方用默认值）。 */
export async function loadWindowState(userData: string): Promise<WindowBounds | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(filePath(userData), 'utf8'));
    if (raw === null || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      if (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number)) return null;
    }
    return {
      x: o.x as number,
      y: o.y as number,
      width: o.width as number,
      height: o.height as number,
      maximized: o.maximized === true,
    };
  } catch {
    return null;
  }
}

export async function saveWindowState(userData: string, bounds: WindowBounds): Promise<void> {
  const full = filePath(userData);
  await mkdir(path.dirname(full), { recursive: true });
  // 原子写（ADR-005）：半截 JSON 会让下次启动读到损坏状态。
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(bounds, null, 2), 'utf8');
  await rename(tmp, full);
}

/**
 * 把窗口的 resize/move 事件接成"节流写盘"。
 *
 * 返回一个 flush 函数：窗口关闭前调一次，保证最后一次拖动不丢。
 * 刻意**不**记录最大化/全屏时的 getBounds()——那给的是最大化矩形，
 * 记下来会把"用户原来那个小窗口"弄丢（下次取消最大化时尺寸乱跳）。
 */
export function trackWindowBounds(
  userData: string,
  win: {
    getBounds(): { x: number; y: number; width: number; height: number };
    isMaximized(): boolean;
    isMinimized(): boolean;
    isFullScreen(): boolean;
    on(event: string, listener: () => void): void;
  },
): () => void {
  /** 最近一次"正常态"的矩形：最大化时保留它，取消最大化后再继续记录。 */
  let lastNormal: { x: number; y: number; width: number; height: number } | null = null;
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const maximized = win.isMaximized();
    const bounds = win.isMinimized() || maximized || win.isFullScreen() ? lastNormal : win.getBounds();
    if (bounds === null) return;
    lastNormal = bounds;
    void saveWindowState(userData, { ...bounds, maximized }).catch(() => undefined);
  };

  const schedule = (): void => {
    /* 最大化/还原都会先触发一次几何变化：此刻先抓一份正常态尺寸，再走节流。 */
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) lastNormal = win.getBounds();
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  return flush;
}
