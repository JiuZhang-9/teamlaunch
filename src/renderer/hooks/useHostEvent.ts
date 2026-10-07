/**
 * 订阅主进程推送事件的统一入口。
 *
 * 两个纪律：
 *  1. 处理器用 ref 转发，所以订阅只建立一次（不会因为 handler 每渲染都换而反复退订重订）。
 *  2. 宿主没实现某个通道时**静默降级**，不能让订阅失败把整个界面拖挂——
 *     新老 preload 版本不一致时这是常见情况，宁可少一个提示也不要白屏。
 */
import { useEffect, useRef } from 'react';

export type HostSubscriber<T> = (cb: (payload: T) => void) => () => void;

export function useHostEvent<T>(subscribe: HostSubscriber<T> | undefined, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;

  useEffect(() => {
    const sub = subscribeRef.current;
    if (typeof sub !== 'function') return;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = sub((payload) => handlerRef.current(payload));
    } catch {
      return;
    }
    return () => {
      try {
        unsubscribe?.();
      } catch {
        /* 退订失败无副作用，不打断卸载 */
      }
    };
  }, []);
}
