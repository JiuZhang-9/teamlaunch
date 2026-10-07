/**
 * 遥测。两条机器闸门都写在这里：事件名白名单、props 键名黑名单。
 * 黑名单是防 PII 外泄的最后一道闸，命中即拒绝上报，而不是"脱敏后上报"。
 */

import { z } from 'zod';
import { CAPACITY, IsoDateTimeSchema } from './common.ts';

export const TelemetryEventNameSchema = z.enum([
  'page_view',
  'sign_up_complete',
  'first_core_action',
  'entry_open_attempted',
  'entry_open_dispatched',
  'entry_open_failed',
  'team_sync_completed',
  'offline_cache_rendered',
  'entry_feedback_submitted',
  'team_publish_completed',
  'session_start',
  'session_duration',
  'error_occurred',
]);

const FORBIDDEN_PROP_KEYS = [
  'ip',
  'ipaddress',
  'clientip',
  'searchterm',
  'query',
  'keyword',
  'path',
  'fullpath',
  'target',
  'url',
  'serial',
  'mac',
  'hostname',
  'username',
  'email',
  'deviceid',
  'device_id',
];

function findForbiddenKey(node: unknown, depth = 0): string | null {
  if (depth > 4 || node === null || typeof node !== 'object') return null;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (FORBIDDEN_PROP_KEYS.includes(k.toLowerCase())) return k;
    const hit = findForbiddenKey(v, depth + 1);
    if (hit) return `${k}.${hit}`;
  }
  return null;
}

export const TelemetryItemSchema = z.object({
  name: TelemetryEventNameSchema,
  ts: IsoDateTimeSchema,
  props: z.record(z.string(), z.unknown()).check((ctx) => {
    const hit = findForbiddenKey(ctx.value);
    if (hit) {
      ctx.issues.push({
        code: 'custom',
        message: `props 含禁报字段：${hit}`,
        path: [],
        input: hit,
      });
    }
  }),
});

/** clientStats 是遥测完整度自证计数器快照：丢失率 = (eviction + retention) / recorded。 */
export const TelemetryBatchSchema = z.object({
  items: z.array(TelemetryItemSchema).min(1).max(CAPACITY.MAX_TELEMETRY_BATCH),
  clientStats: z.object({
    recorded: z.int().min(0),
    uploaded: z.int().min(0),
    droppedByEviction: z.int().min(0),
    droppedByRetention: z.int().min(0),
  }),
});

export type TelemetryEventName = z.infer<typeof TelemetryEventNameSchema>;
export type TelemetryItem = z.infer<typeof TelemetryItemSchema>;
export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;
