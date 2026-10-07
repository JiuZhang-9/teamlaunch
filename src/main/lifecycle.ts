/**
 * 生命周期控制器 —— 单实例锁与诚实的退出语义。
 *
 * 两个历史事故在这里根治：
 *  1. 托盘"退出"点了没反应：palette 窗口的 close 事件无条件 preventDefault，
 *     把 app.quit() 的关窗阶段整个挡回去。现在退出走显式标记：markQuitting()
 *     之后的 close 一律放行，其余照旧"隐藏而非销毁"（保住二次唤起的速度）。
 *  2. 多实例并存：此前从未调用 requestSingleInstanceLock，旧实例退不掉、
 *     新实例照起，管理员/员工两个角色的实例同时扫描同一份数据目录，
 *     测试结果完全不可信。锁按 userData 目录隔离——TL_PROFILE 双档案
 *     各自一把锁，同机双实例测试不受影响。
 */
import { app } from 'electron';

let quitting = false;

export function markQuitting(): void {
  quitting = true;
}

export function isQuitting(): boolean {
  return quitting;
}

/** 拿锁失败返回 false（调用方应立即 app.quit()）；成功则挂上 second-instance 处理。 */
export function acquireSingleInstanceLock(onSecondInstance: () => void): boolean {
  const got = app.requestSingleInstanceLock();
  if (!got) return false;
  app.on('second-instance', onSecondInstance);
  return true;
}
