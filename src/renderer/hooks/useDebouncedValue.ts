import { useEffect, useRef, useState } from 'react';

/**
 * 输入防抖 120ms（V-03/V-04 共用规格）。
 * 防抖期内保留上一次结果，绝不先清空再重画 —— 那会造成列表闪白。
 */
export function useDebouncedValue<T>(value: T, delay = 120): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** 每次挂载后延迟执行（遮罩出现动画等的轻量替代，本项目动效极少）。 */
export function useTimeout(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const t = setTimeout(() => ref.current(), ms);
    return () => clearTimeout(t);
  }, [ms]);
}
