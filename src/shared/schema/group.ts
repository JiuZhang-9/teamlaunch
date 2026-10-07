/**
 * 分组与容量闸门。团队配置与"我的入口"共用同一道闸门，两处容量语义不可能分叉。
 */

import { z } from 'zod';
import { CAPACITY } from './common.ts';
import { EntrySchema } from './entry.ts';

export const GroupSchema = z.object({
  id: z.string().min(1).max(CAPACITY.MAX_ID_LEN),
  name: z.string().min(1).max(CAPACITY.MAX_NAME_LEN),
  sort: z.int(),
  entries: z.array(EntrySchema),
});

/**
 * 分组列表：容量闸门所在。同时卡住两件事——
 *   1. 入口总数跨分组求和 ≤ 200
 *   2. 入口 id 全局唯一（id 串号会让"定位问题项""失效反馈聚合"静默错位）
 */
export const GroupListSchema = z
  .array(GroupSchema)
  .max(CAPACITY.MAX_GROUPS)
  .check((ctx) => {
    const groups = ctx.value;
    let total = 0;
    const seen = new Set<string>();
    for (const g of groups) {
      total += g.entries.length;
      for (const e of g.entries) {
        if (seen.has(e.id)) {
          ctx.issues.push({
            code: 'custom',
            message: `入口 id 重复：${e.id}`,
            path: ['entries'],
            input: e.id,
          });
        }
        seen.add(e.id);
      }
    }
    if (total > CAPACITY.MAX_ENTRIES) {
      ctx.issues.push({
        code: 'custom',
        message: `入口总数 ${total} 超过上限 ${CAPACITY.MAX_ENTRIES}`,
        path: [],
        input: total,
      });
    }
  });

export type Group = z.infer<typeof GroupSchema>;
