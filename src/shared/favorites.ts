/**
 * 收藏（2026-10-30，1.7.0）：把原来的「主页收藏」与快捷窗口「固定」统一成一个概念。
 *
 * 一份数据、两个展示面：
 *  - 主页「收藏」= 完整列表（管理面）；
 *  - 快捷窗口 / 主窗口搜索的快速打开区 = 同一份列表的最近几条（快捷面）。
 *
 * 只存入口 id + 收藏时间，内容以当前团队快照 / 本机配置为准；被删除的入口由界面跳过。
 * 纯函数放 shared：主进程的 toggle/setMany 与渲染层的迁移/展示必须给出同一套顺序与去重。
 */
export interface FavoriteItem {
  entryId: string;
  addedAt: string;
}

/** 入口上限就是 200 条，收藏再多也超不过它；留一个硬顶防止坏文件无限增长。 */
export const FAVORITES_MAX = 200;

function isFavoriteItem(value: unknown): value is FavoriteItem {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.entryId === 'string' &&
    item.entryId.length > 0 &&
    typeof item.addedAt === 'string' &&
    item.addedAt.length > 0
  );
}

/** 读盘 / IPC 进来的任意形状 → 合法收藏列表（按 id 去重，保留最早出现的位置）。 */
export function normalizeFavorites(value: unknown): FavoriteItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: FavoriteItem[] = [];
  for (const item of value) {
    if (!isFavoriteItem(item) || seen.has(item.entryId)) continue;
    seen.add(item.entryId);
    list.push({ entryId: item.entryId, addedAt: item.addedAt });
  }
  return list.slice(-FAVORITES_MAX);
}

/** 快捷面用：最近收藏的排前面。主页展示也走这个顺序。 */
export function favoriteIdsNewestFirst(list: FavoriteItem[]): string[] {
  return [...list].reverse().map((item) => item.entryId);
}

/** 单条收藏 / 取消收藏；返回新列表（不修改入参）。 */
export function toggleFavoriteInList(list: FavoriteItem[], entryId: string, addedAt: string): FavoriteItem[] {
  const current = normalizeFavorites(list);
  if (entryId.length === 0) return current;
  if (current.some((item) => item.entryId === entryId)) {
    return current.filter((item) => item.entryId !== entryId);
  }
  return [...current, { entryId, addedAt }].slice(-FAVORITES_MAX);
}

/**
 * 多选批量"一次设定成同一个状态"：不是逐项 toggle。
 * 保持"最新收藏排在后面"的既有顺序；已在列表里的 id 先摘掉再按传入顺序追加。
 */
export function setFavoriteManyInList(
  list: FavoriteItem[],
  entryIds: string[],
  on: boolean,
  addedAt: string,
): FavoriteItem[] {
  const current = normalizeFavorites(list);
  const wanted = new Set(entryIds.filter((id) => id.length > 0));
  const kept = current.filter((item) => !wanted.has(item.entryId));
  if (!on) return kept;
  return [...kept, ...[...wanted].map((entryId) => ({ entryId, addedAt }))].slice(-FAVORITES_MAX);
}

/**
 * 一次性迁移：把旧「固定」localStorage 里的 id 并进收藏。
 * 旧固定列表是"先固定的在前"；追加到收藏尾部后，快捷面按倒序显示正好仍是最近固定的在前。
 */
export function mergeLegacyPinned(
  list: FavoriteItem[],
  pinnedIds: string[],
  addedAt: string,
): FavoriteItem[] {
  const current = normalizeFavorites(list);
  const seen = new Set(current.map((item) => item.entryId));
  const merged = [...current];
  for (const id of pinnedIds) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    merged.push({ entryId: id, addedAt });
  }
  return merged.slice(-FAVORITES_MAX);
}
