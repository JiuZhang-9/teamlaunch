/**
 * 入口移动的唯一实现（单条与多选整块，2026-10-17 批 4）。
 *
 * 为什么放 shared：个人入口与团队草稿两套 store 此前各写了一份**逐行同构**的
 * "落点前移除 + 同组补偿索引 + sort 重排"；批 4 又要把"多选整块移动"加上去，
 * 再复制第三份必然在补偿索引这种细节上分叉——而那种错会静默丢卡（拖完发现少了一条）。
 *
 * 语义（与既有单条移动保持一致，扩展出整块）：
 *  - 移动块内的相对顺序 = 它们当前在页面上的顺序（分组顺序 → 组内顺序）；
 *  - `toIndex` 以**移除前**的目标组视角给（CardGrid 的落点就是这种口径）：
 *    同组时自动扣掉"块内早于落点"的条数；
 *  - 同组内部拖到块自身上（含紧邻两侧）＝ 不产生任何变化（拖回原位无操作）；
 *  - 组与入口的 `sort` 一律按位置重排（组 sort = 组序，入口 sort = 组内序）。
 */
import type { Entry } from './schema/entry.ts';

export interface MoveGroupLike {
  id: string;
  sort: number;
  entries: Entry[];
}

export function moveEntries<T extends MoveGroupLike>(
  groups: T[],
  ids: string[],
  toGroupId: string,
  toIndex?: number,
): T[] {
  const moving = new Set(ids.filter((id) => id.length > 0));
  if (moving.size === 0) return groups;
  const target = groups.find((g) => g.id === toGroupId);
  if (target === undefined) return groups;

  /* 按页面顺序收集（块内相对顺序由此确定）。 */
  const picked: Entry[] = [];
  const originals: Array<{ groupId: string; index: number }> = [];
  for (const g of groups) {
    g.entries.forEach((e, i) => {
      if (moving.has(e.id)) {
        picked.push(e);
        originals.push({ groupId: g.id, index: i });
      }
    });
  }
  if (picked.length === 0) return groups;

  const rawIndex = toIndex ?? target.entries.length;
  const sameGroup = originals.every((o) => o.groupId === toGroupId);
  if (sameGroup) {
    const lo = Math.min(...originals.map((o) => o.index));
    const hi = Math.max(...originals.map((o) => o.index));
    if (rawIndex >= lo && rawIndex <= hi + 1) return groups;
  }
  const removedBefore = sameGroup
    ? target.entries.slice(0, rawIndex).filter((e) => moving.has(e.id)).length
    : 0;

  const next = groups.map((g) => ({ ...g, entries: g.entries.filter((e) => !moving.has(e.id)) }));
  const t = next.find((g) => g.id === toGroupId);
  if (t === undefined) return groups;
  const insertAt = Math.max(0, Math.min(rawIndex - removedBefore, t.entries.length));
  t.entries.splice(insertAt, 0, ...picked);
  return next.map((g, k) => ({
    ...g,
    sort: k,
    entries: g.entries.map((e, i) => (e.sort === i ? e : { ...e, sort: i })),
  }));
}
