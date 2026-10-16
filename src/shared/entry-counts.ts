/**
 * 入口计数（团队页与我的入口页共用）——给页面上的"统计条"算总数与分类型数量。
 *
 * 为什么放 shared：两页要的是**同一个口径**；各写一遍的话，入口类型（判别联合）
 * 将来加一个分支就会漏掉一处，表现为"两页数字对不上"而没人知道哪个是真的。
 */
import type { Entry } from './schema/entry.ts';

export type EntryCountKey = Entry['type'];

export interface EntryCounts {
  total: number;
  byType: Record<EntryCountKey, number>;
}

/** 只数入口本身：空分组不计入，与卡片可见性一致（组头计数由 GroupHeader 自己显示）。 */
export function countEntries(groups: Array<{ entries: Entry[] }>): EntryCounts {
  const byType: Record<EntryCountKey, number> = { app: 0, folder: 0, web: 0 };
  let total = 0;
  for (const group of groups) {
    for (const entry of group.entries) {
      byType[entry.type] += 1;
      total += 1;
    }
  }
  return { total, byType };
}
