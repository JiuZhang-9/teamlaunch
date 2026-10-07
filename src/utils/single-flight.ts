/**
 * src/utils/single-flight.ts —— 同一 key 的并发调用共享一个 Promise
 *
 * 用途：消灭"检查再写入"的并发窗口。凡是 `if (!exists) create()` 的形状，
 * 两个并发调用会都判定不存在、都去创建，后写的覆盖先写的（已知静默错误来源）。
 */

export function createSingleFlight(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const inFlight = new Map<string, Promise<unknown>>();
  return async function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = task().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
}

/**
 * 串行互斥锁。Node 是单线程，但 await 点会让两段"读—改—写"交错。
 * 发布流程（读当前 revision → 校验 → 推进版本 → 落盘）必须整段串行。
 */
export function createMutex(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}
