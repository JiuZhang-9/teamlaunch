/**
 * 主窗口矩形的两个纯判定（2026-10-18 用户要求"记住上次的位置和大小"）。
 *
 * 放 shared 而不是 main/windowState.ts：那边有 fs 依赖，进了就拉不起 smoke；
 * 而这两条判定恰恰是**必须有人真跑过**的——判错的后果是窗口落在屏幕外，
 * 用户看到的是"应用打不开"（最坏的一类故障：连报错都没有）。
 */

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** 恢复的矩形至少要有这么一块落在某个显示器工作区内，否则视为"离屏"。 */
export const MIN_VISIBLE_PX = 80;

/** 窗口允许的最小尺寸（与 windowManager 的 MIN_W/MIN_H、design-tokens 的 --win-w-min 一致）。 */
export const MIN_WINDOW_W = 880;
export const MIN_WINDOW_H = 480;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 上次的矩形还能用吗：它与**任一**显示器工作区要有 `MIN_VISIBLE_PX` 以上的重叠。
 * 外接显示器拔掉后旧坐标会完全落在屏幕外——那时必须回落默认值，不能照搬。
 */
export function isRestorableBounds(bounds: WindowBounds, areas: Rect[]): boolean {
  return areas.some((a) => {
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX;
  });
}

/**
 * 默认矩形（首次启动 / 上次位置不可用时）：比旧的 1040×720 大一圈，但按屏幕自适应——
 * 1366×768 的笔记本上硬给 1280×820 会顶出工作区，所以取"目标值"与"工作区减边距"的较小者。
 */
export function defaultBounds(workArea: Rect): WindowBounds {
  const width = Math.max(MIN_WINDOW_W, Math.min(1280, workArea.width - 48));
  const height = Math.max(MIN_WINDOW_H, Math.min(820, workArea.height - 48));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
    maximized: false,
  };
}
