/**
 * 反馈投递状态（AC-13 / AC-13a）。
 *
 * 只记录**服务端确认前**的状态：PENDING 的入口在卡片上留角标，SENT 后消失。
 * 这里不保存"发送成功"的持久列表——SENT 之后界面就不再需要它了。
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface FeedbackCtx {
  pendingIds: Set<string>;
  markPending(entryId: string): void;
  markSent(entryId: string): void;
}

const Ctx = createContext<FeedbackCtx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const markPending = useCallback((entryId: string) => {
    setPendingIds((prev) => new Set(prev).add(entryId));
  }, []);

  const markSent = useCallback((entryId: string) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(entryId);
      return next;
    });
  }, []);

  const value = useMemo<FeedbackCtx>(() => ({ pendingIds, markPending, markSent }), [pendingIds, markPending, markSent]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFeedback(): FeedbackCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback 必须在 FeedbackProvider 内使用');
  return v;
}
