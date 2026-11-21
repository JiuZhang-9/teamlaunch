/**
 * 收藏（2026-10-30，1.7.0；2026-11-21，1.10.0 加手动排序）。
 *
 * 一份数据、两个展示面：
 *  - 主页「收藏」= 完整列表（管理面）；
 *  - 快捷窗口 / 主窗口搜索的快速打开区 = 同一份列表的最近几条（快捷面）。
 *
 * 只存入口 id + 收藏时间，内容以当前团队快照 / 本机配置为准；被删除的入口由界面跳过。
 * 纯函数放 shared：主进程的 toggle/setMany/reorder 与渲染层的迁移/展示必须给出同一套顺序与去重。
 *
 * 顺序模型（1.10.0，用户要求"收藏支持拖拽左右排列，并与主页同步"）：
 *  - 显示顺序 = `sort` 升序；没有 `sort` 的项（老数据 / 刚收藏）按 addedAt 倒序排在最前。
 *  - 拖拽结束后主进程把整份列表写成 sort 0..n-1（reorderFavorites），从此顺序完全显式。
 *  - 老数据（全部没有 sort）显示为"最近收藏在前"，与 1.9.x 完全一致，不需要迁移标记。
 *  - 主页、搜索浮层、快捷窗口都只走 favoriteIdsForDisplay，不允许各自再 reverse 一次。
 */
export interface FavoriteItem {
  entryId: string;
  addedAt: string;
  /**
   * 手动排序权重（1.10.0）：拖拽后写成 0..n-1。
   * 缺省 = 老收藏或刚收藏：老收藏按 addedAt 倒序，刚收藏排最前。
   */
  sort?: number;
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

/** 只保留合法的 sort：非负有限整数；坏值按"没有 sort"处理（排最前，不丢条目）。 */
function normalizedSort(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/** 读盘 / IPC 进来的任意形状 → 合法收藏列表（按 id 去重，保留最早出现的位置）。 */
export function normalizeFavorites(value: unknown): FavoriteItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: FavoriteItem[] = [];
  for (const raw of value) {
    if (!isFavoriteItem(raw) || seen.has(raw.entryId)) continue;
    seen.add(raw.entryId);
    const item: FavoriteItem = { entryId: raw.entryId, addedAt: raw.addedAt };
    const sort = normalizedSort(raw.sort);
    if (sort !== undefined) item.sort = sort;
    list.push(item);
  }
  /* 有显式顺序时数组已是"显示顺序在前"，超限丢末尾；老数据是"添加顺序"，
     超限（几乎不可能）丢最旧的那批。 */
  const hasManualOrder = list.some((item) => item.sort !== undefined);
  return hasManualOrder ? list.slice(0, FAVORITES_MAX) : list.slice(-FAVORITES_MAX);
}

/**
 * 显示顺序（唯一口径）：有 sort 的按 sort 升序，没有 sort 的（刚收藏 / 老数据）排最前；
 * 同为"没有 sort"时按 addedAt 倒序（最近收藏在前）。
 *
 * 主页、搜索收藏行、快捷窗口收藏行都必须用它，不允许调用方再 reverse。
 */
export function favoriteIdsForDisplay(list: FavoriteItem[]): string[] {
  const items = normalizeFavorites(list);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const as = a.item.sort;
      const bs = b.item.sort;
      if (as === undefined && bs === undefined) {
        return b.item.addedAt.localeCompare(a.item.addedAt) || b.index - a.index;
      }
      if (as === undefined) return -1;
      if (bs === undefined) return 1;
      if (as !== bs) return as - bs;
      return b.item.addedAt.localeCompare(a.item.addedAt) || b.index - a.index;
    })
    .map((entry) => entry.item.entryId);
}

/** 把当前显示顺序固化成连续的 sort（0..n-1）。之后任何插入都能用连续 sort 表达。 */
function withManualOrder(list: FavoriteItem[]): FavoriteItem[] {
  const items = normalizeFavorites(list);
  const byId = new Map(items.map((item) => [item.entryId, item]));
  return favoriteIdsForDisplay(items).map((id, index) => ({ ...byId.get(id)!, sort: index }));
}

/** 单条收藏 / 取消收藏；返回新列表（不修改入参）。新收藏排显示最前。 */
export function toggleFavoriteInList(list: FavoriteItem[], entryId: string, addedAt: string): FavoriteItem[] {
  const current = normalizeFavorites(list);
  if (entryId.length === 0) return current;
  if (current.some((item) => item.entryId === entryId)) {
    return current.filter((item) => item.entryId !== entryId);
  }
  const ordered = withManualOrder(current);
  return [
    { entryId, addedAt, sort: 0 },
    ...ordered.map((item) => ({ ...item, sort: (item.sort ?? 0) + 1 })),
  ].slice(0, FAVORITES_MAX);
}

/**
 * 多选批量"一次设定成同一个状态"：不是逐项 toggle。
 * on=true 时这批 id 按传入顺序排到显示最前（与单条收藏的"刚收藏在前"一致）；
 * on=false 时只把它们从列表里摘掉，其余顺序不变。
 */
export function setFavoriteManyInList(
  list: FavoriteItem[],
  entryIds: string[],
  on: boolean,
  addedAt: string,
): FavoriteItem[] {
  const current = normalizeFavorites(list);
  const wanted = [...new Set(entryIds.filter((id) => id.length > 0))];
  if (!on) {
    const drop = new Set(wanted);
    return current.filter((item) => !drop.has(item.entryId));
  }
  const byId = new Map(current.map((item) => [item.entryId, item]));
  const ordered = withManualOrder(current);
  const frontIds = new Set(wanted);
  const front: FavoriteItem[] = wanted.map((entryId) => ({
    entryId,
    addedAt: byId.get(entryId)?.addedAt ?? addedAt,
    sort: 0,
  }));
  const rest = ordered.filter((item) => !frontIds.has(item.entryId));
  return [...front, ...rest].map((item, index) => ({ ...item, sort: index })).slice(0, FAVORITES_MAX);
}

/**
 * 一次性迁移：把旧「固定」localStorage 里的 id 并进收藏。
 * 旧固定列表是"先固定的在前"；显示顺序要"最近固定的在前"，所以反向放到显示最前。
 */
export function mergeLegacyPinned(
  list: FavoriteItem[],
  pinnedIds: string[],
  addedAt: string,
): FavoriteItem[] {
  const current = normalizeFavorites(list);
  const ordered = withManualOrder(current);
  const seen = new Set(current.map((item) => item.entryId));
  const front: FavoriteItem[] = [];
  for (const id of [...pinnedIds].reverse()) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    front.push({ entryId: id, addedAt });
  }
  if (front.length === 0) return ordered;
  return [...front, ...ordered].map((item, index) => ({ ...item, sort: index })).slice(0, FAVORITES_MAX);
}

/**
 * 按传入的 id 顺序重写整份列表的 sort（0..n-1）。
 *
 * 语义：`orderedIds` 里出现的项按这个顺序排最前，没出现的项按当前显示顺序跟随。
 * 搜索浮层只拖可见的一行（传它的可见顺序），主页传完整顺序；两种调用都得到确定结果。
 */
export function reorderFavorites(list: FavoriteItem[], orderedIds: string[]): FavoriteItem[] {
  const current = normalizeFavorites(list);
  const byId = new Map(current.map((item) => [item.entryId, item]));
  const seen = new Set<string>();
  const next: FavoriteItem[] = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (item === undefined || seen.has(id)) continue;
    seen.add(id);
    next.push({ ...item, sort: next.length });
  }
  for (const id of favoriteIdsForDisplay(current)) {
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (item === undefined) continue;
    seen.add(id);
    next.push({ ...item, sort: next.length });
  }
  return next.slice(0, FAVORITES_MAX);
}

/**
 * 把 id 拖到 `toIndex`（移除前口径，与 CardGrid 的落点一致）。
 * 例：[a,b,c] 拖 a 到 c 后 → toIndex=3 → [b,c,a]；拖 c 到 a 前 → toIndex=0 → [c,a,b]。
 */
export function moveFavoriteId(list: string[], id: string, toIndex: number): string[] {
  const from = list.indexOf(id);
  if (from < 0) return [...list];
  const next = list.filter((item) => item !== id);
  const insertAt = Math.max(0, Math.min(toIndex > from ? toIndex - 1 : toIndex, next.length));
  next.splice(insertAt, 0, id);
  return next;
}
