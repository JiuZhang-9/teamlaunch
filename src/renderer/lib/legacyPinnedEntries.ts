/**
 * 旧「固定」数据的迁移入口（2026-10-30，1.7.0）。
 *
 * 1.7.0 起「固定」并入「收藏」：快捷窗口顶部显示的就是收藏列表。
 * 这里只保留读取/清空旧 localStorage 的能力，给收藏 store 做一次性合并；
 * 不再提供写入——新代码一律走 `api.favorites.*`。
 */
import { readMemoryString, writeMemoryString } from './localMemory.ts';

const LEGACY_KEY = 'pinnedEntries';

export function legacyPinnedEntryIds(): string[] {
  const raw = readMemoryString(LEGACY_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/** 迁移成功后清空旧 key：写空数组即可，读取方会当成"没有旧固定"。 */
export function clearLegacyPinnedEntries(): void {
  writeMemoryString(LEGACY_KEY, JSON.stringify([]));
}
