/**
 * 快捷面板的手动固定（2026-10-21 用户要求：「手动固定行 / 最近打开行」分开，右键可固定）。
 *
 * 口径与「最近打开」一致：
 *  - 只存入口 id，不存名称/路径等内容；上限 30 条，按 id 去重；
 *  - 只属于这台机器（本机记忆，不进 settings.json、不参与团队同步）；
 *  - 顺序 = 用户固定的先后顺序（先固定的排前面）。
 *
 * 与最近打开分开存：最近打开是自动记录、会被新打开挤掉；固定是用户意图，不该被挤掉。
 */
import { useEffect, useState } from 'react';
import { readMemoryString, subscribeMemory, writeMemoryString } from './localMemory.ts';

const KEY = 'pinnedEntries';
const MAX_STORED = 30;

export function pinnedEntryIds(): string[] {
  const raw = readMemoryString(KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/** 固定 / 取消固定；返回操作后的状态。 */
export function togglePinnedEntry(entryId: string): boolean {
  if (entryId.length === 0) return false;
  const list = pinnedEntryIds();
  const on = list.includes(entryId);
  const next = on ? list.filter((id) => id !== entryId) : [...list, entryId].slice(-MAX_STORED);
  writeMemoryString(KEY, JSON.stringify(next));
  return !on;
}

/** 可订阅的固定清单：在面板里右键固定后立刻重排，不需要重启。 */
export function usePinnedEntryIds(): string[] {
  const [ids, setIds] = useState<string[]>(pinnedEntryIds);
  useEffect(() => subscribeMemory(KEY, () => setIds(pinnedEntryIds())), []);
  return ids;
}
