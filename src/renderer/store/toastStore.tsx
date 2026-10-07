/** 轻量 Toast 队列。 Toast UI 组件在 molecules/Toast.tsx。 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

export interface ToastAction {
  label: string;
  onSelect(): void;
}

export interface ToastItem {
  id: number;
  title: string;
  detail?: string;
  tone: ToastTone;
  actions?: ToastAction[];
  /** 0 表示常驻不自动消失（例如 DROPPED 类必须由用户确认） */
  duration: number;
}

interface ToastCtx {
  toasts: ToastItem[];
  push(t: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }): number;
  dismiss(id: number): void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastCtx['push']>(
    (t) => {
      seq.current += 1;
      const id = seq.current;
      const duration = t.duration ?? 3000;
      setToasts((list) => [...list.slice(-2), { ...t, id, duration }]);
      if (duration > 0) {
        setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), duration);
      }
      return id;
    },
    [],
  );

  const value = useMemo<ToastCtx>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToasts(): ToastCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToasts 必须在 ToastProvider 内使用');
  return v;
}
