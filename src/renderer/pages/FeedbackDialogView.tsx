/**
 * V-08 反馈对话框的视图层。
 *
 * 【红线】状态映射是这里最关键的一段：**PENDING 只能来自"已落盘到待发送队列"**，
 *    SENT 只能来自服务端确认。绝不把"没发出去"渲染成红色错误。
 */
import { useMemo, useState } from 'react';
import { api } from '../bridge/index.ts';
import { FeedbackDialog } from '../components/organisms/FeedbackDialog.tsx';
import type { FeedbackStatusKind } from '../components/molecules/FeedbackStatus.tsx';
import { useFeedback } from '../store/feedbackStore.tsx';
import { usePersonal } from '../store/personalStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import type { FeedbackReason } from '../../shared/schema/feedback.ts';
import type { Entry } from '../../shared/schema/entry.ts';

export interface FeedbackDialogViewProps {
  entryId: string;
  onClose(): void;
}

export function FeedbackDialogView({ entryId, onClose }: FeedbackDialogViewProps) {
  const { snapshot } = useSync();
  const { config: personal } = usePersonal();
  const { markPending, markSent } = useFeedback();
  const { push } = useToasts();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<FeedbackStatusKind | null>(null);
  const [detail, setDetail] = useState<string | undefined>();

  const entry = useMemo<Entry | null>(() => {
    const pools = [snapshot.config?.groups ?? [], personal.groups];
    for (const groups of pools) {
      for (const g of groups) {
        const hit = g.entries.find((e) => e.id === entryId);
        if (hit) return hit;
      }
    }
    return null;
  }, [snapshot.config, personal.groups, entryId]);

  // 上报体只含 deviceId + 入口 id + 原因枚举：schema 硬约束是不带任何自由文本，
  // 所以 note 只留在本地供管理员后续人工核对，不随反馈发出。
  const submit = async (reason: FeedbackReason, _note: string) => {
    if (!entry) return;
    setSubmitting(true);
    const result = await api.feedback.submit({
      entryId: entry.id,
      entryRevision: snapshot.revision ?? undefined,
      reasonCode: reason,
      occurredAt: new Date().toISOString(),
    });
    setSubmitting(false);

    if (result.status === 'SENT') {
      setStatus('sent');
      markSent(entry.id);
      push({ title: '反馈已发送给管理员', tone: 'success' });
      window.setTimeout(onClose, 2000);
      return;
    }
    if (result.status === 'PENDING') {
      // 进了待发送队列就是 PENDING，不是失败——不得显示"提交失败"
      setStatus('pending');
      setDetail('反馈已保存到本机，联网后会自动重试。');
      markPending(entry.id);
      return;
    }
    if (result.status === 'RATE_LIMITED') {
      setStatus('rate_limited');
      return;
    }
    setStatus('dropped');
    setDetail(
      result.reason === 'EXPIRED'
        ? '这条反馈没能发送：超过保留期限（7 天）未送达。可以重新提交。'
        : '这条反馈没能发送：待发送队列已满。可以重新提交。',
    );
  };

  return (
    <FeedbackDialog
      entry={entry}
      submitting={submitting}
      status={status}
      statusDetail={detail}
      onSubmit={(reason, note) => {
        void submit(reason, note);
      }}
      onClose={onClose}
      onRetry={() => setStatus(null)}
    />
  );
}
