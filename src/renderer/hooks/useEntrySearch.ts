/**
 * 入口搜索：跨分组打分排序。
 *
 * 排序由 `matches()` 给出的分数决定，UI 不再二次排序；
 * 空查询返回空数组——"空查询显示最近打开"是迷你面板的规则，不是窗口内搜索的。
 */
import { useMemo } from 'react';
import { matches } from '../lib/entry.ts';
import type { SearchHit } from '../pages/WindowSearchView.tsx';
import type { Group } from '../../shared/schema/group.ts';

export function useEntrySearch(groups: Group[], query: string): SearchHit[] {
  return useMemo<SearchHit[]>(() => {
    const q = query.trim();
    if (!q) return [];
    const scored: Array<{ hit: SearchHit; score: number }> = [];
    for (const g of groups) {
      for (const e of g.entries) {
        const score = matches(e, g.name, q);
        if (score > 0) scored.push({ hit: { entry: e, groupName: g.name }, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.hit);
  }, [groups, query]);
}
