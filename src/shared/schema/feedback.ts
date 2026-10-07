/**
 * 失效反馈。只带 reasonCode，不含任何自由文本 —— 这条是硬约束，不是风格建议。
 */

import { z } from 'zod';
import { CAPACITY, IsoDateTimeSchema, RevisionSchema } from './common.ts';

export const FeedbackReasonSchema = z.enum([
  'not_installed',
  'path_missing',
  'permission_denied',
  'link_unavailable',
  'network_unreachable',
  'other',
]);

export const FeedbackItemSchema = z.object({
  entryId: z.string().min(1).max(CAPACITY.MAX_ID_LEN),
  entryRevision: RevisionSchema.optional(),
  reasonCode: FeedbackReasonSchema,
  occurredAt: IsoDateTimeSchema,
});

export const FeedbackBatchSchema = z.object({
  items: z.array(FeedbackItemSchema).min(1).max(CAPACITY.MAX_FEEDBACK_BATCH),
});

export type FeedbackReason = z.infer<typeof FeedbackReasonSchema>;
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;
export type FeedbackBatch = z.infer<typeof FeedbackBatchSchema>;
