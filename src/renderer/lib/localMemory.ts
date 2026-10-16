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

/** 读一个短字符串列表记忆（如"已提示过的公告 id"）；解析失败按空列表——记忆坏了不该影响功能。 */
export function readMemoryList(key: string): string[] {
  const raw = readMemoryString(key);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 写列表记忆；只保留最近 cap 条，防止长期运行无限增长。 */
export function writeMemoryList(key: string, list: string[], cap = 100): void {
  writeMemoryString(key, JSON.stringify(list.slice(-cap)));
}
