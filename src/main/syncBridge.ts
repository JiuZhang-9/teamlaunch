/**
 * 主进程侧的同步服务桥。
 *
 * 渲染层拿到的同步 8 态**只能**来自这里 —— UI 不做任何推导（K-B）。
 * 真正的同步服务在 `src/server/**`（后端负责），本文件只定义契约与装配：
 * 服务就绪就转发它的快照；服务还没就绪时明确给出 `NEVER_SYNCED`，
 * 绝不因为"取不到"就自己判离线、也绝不沿用上一轮状态。
 */
import type { BrowserWindow } from 'electron';
import type { SyncSnapshot } from '../renderer/bridge/types.ts';

export interface SyncServicePort {
  snapshot(): SyncSnapshot;
  subscribe(listener: (s: SyncSnapshot) => void): () => void;
  refresh(): Promise<void>;
}

export const NEVER_SYNCED_SNAPSHOT: SyncSnapshot = {
  state: 'NEVER_SYNCED',
  offlineReason: null,
  hasCache: false,
  lastSyncedAt: null,
  revision: null,
  config: null,
};

let port: SyncServicePort | null = null;
let broadcastListener: ((snapshot: SyncSnapshot) => void) | null = null;
let detachBroadcast: (() => void) | null = null;

/**
 * 由 index.ts 在装配阶段注入。后端服务落地后替换这里即可，渲染层不动。
 *
 * 广播订阅必须跟着端口走：角色切换会整体换装端口（管理员 ↔ 员工），
 * 若订阅仍挂在旧端口上，渲染层从此收不到任何 tl:sync——
 * "切了管理员还是显示离线"的根因就是旧实现只订阅了一次。
 */
export function installSyncService(next: SyncServicePort): void {
  detachBroadcast?.();
  port = next;
  if (broadcastListener) detachBroadcast = next.subscribe(broadcastListener);
}

export function syncService(): SyncServicePort {
  if (port) return port;
  return {
    snapshot: () => NEVER_SYNCED_SNAPSHOT,
    subscribe: () => () => undefined,
    refresh: async () => undefined,
  };
}

/**
 * 把同步快照推给所有窗口。
 *
 * AC-09：无变化时不推送。轮询返回 304 时服务侧直接不 emit，
 * 这里不做任何"值相同就不发"的二次判断——那是 UI 该操心的，不是主进程该替它兜的。
 */
export function bindSyncBroadcast(getWindows: () => BrowserWindow[]): void {
  broadcastListener = (snapshot) => {
    for (const win of getWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('tl:sync', snapshot);
    }
  };
  detachBroadcast = syncService().subscribe(broadcastListener);
}
