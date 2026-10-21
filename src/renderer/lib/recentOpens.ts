/**
 * 最近打开 —— 本机记忆（localStorage），面板空查询时的"最近打开"列表。
 *
 * 三条口径（与 PRD §8.4「最近使用」一致）：
 *  - **独立快捷区**：不改任何入口的官方排序，只影响面板空查询时先显示什么；
 *  - 只记 id 与时间，**不记任何内容**；上限 20 条、按 id 去重、最新在前；
 *  - 落盘的只有"这台机器"的一份（每台机器各记各的，不参与同步）。
 *
 * 注意：Chromium 对 localStorage 的落盘有延迟（实测数秒），
 * 强杀进程可能丢掉最后一次记录——这只是少一条"最近打开"，不影响别的功能。
 */
import { useEffect, useState } from 'react';
import { readMemoryString, subscribeMemory, writeMemoryString } from './localMemory.ts';

const KEY = 'recentOpens';
const MAX_STORED = 20;

interface RecentRecord {
  entryId: string;
  at: string;
}

function readAll(): RecentRecord[] {
  const raw = readMemoryString(KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentRecord =>
        typeof r === 'object' && r !== null &&
        typeof (r as RecentRecord).entryId === 'string' &&
        typeof (r as RecentRecord).at === 'string',
    );
  } catch {
    return [];
  }
}

/** 记一次成功的打开（同一条重复打开只前移，不产生第二条）。 */
export function pushRecentOpen(entryId: string): void {
  if (entryId.length === 0) return;
  const rest = readAll().filter((r) => r.entryId !== entryId);
  const next: RecentRecord[] = [{ entryId, at: new Date().toISOString() }, ...rest].slice(0, MAX_STORED);
  writeMemoryString(KEY, JSON.stringify(next));
}

/** 最近打开的 id（最新在前）。显示时再按当前清单过滤——被删掉的入口自然消失。 */
export function recentOpenIds(): string[] {
  return readAll().map((r) => r.entryId);
}

/**
 * 最近打开的可订阅视图（2026-10-21）。
 *
 * 打开动作发生在主窗口，展示发生在快捷面板窗口：没有订阅时，"最近打开"要等面板
 * 重新挂载才更新。订阅的是本机记忆，不涉及任何跨机同步。
 */
export function useRecentOpenIds(): string[] {
  const [ids, setIds] = useState<string[]>(recentOpenIds);
  useEffect(() => subscribeMemory(KEY, () => setIds(recentOpenIds())), []);
  return ids;
}
