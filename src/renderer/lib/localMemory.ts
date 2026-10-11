/**
 * 本机记忆 —— 只属于这台机器的界面状态（上次所在页、最近打开…）。
 *
 * 三条边界（ARCHITECTURE §5.2）：
 *  - **不进 settings.json**：那里只放用户意图；这类是"这台机器记得的事"，
 *    进了 settings 就会随 `tl:settings-patch` 广播给所有窗口、并被误当成可同步的偏好。
 *  - **不跨机同步**：每台机器各记各的，谁也不需要看到别人的。
 *  - **丢了也不影响功能**：读写成败都不抛错，读不到就用调用方给的默认值。
 *
 * 落地形态是渲染层 localStorage：读是同步的（首帧就能拿到，没有"异步读回来再改状态"
 * 的竞态）。唯一写入点由调用方保证（例如 lastTab 只由主窗口的 setTab 写）。
 */
const PREFIX = 'tl.';

export function readMemoryString(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    // 存储不可用（极端策略/配额）：按"没有记忆"处理
    return null;
  }
}

export function writeMemoryString(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // 写不进去只损失记忆本身，不影响当前操作
  }
}
