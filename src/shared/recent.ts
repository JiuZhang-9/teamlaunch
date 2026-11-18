/**
 * 「最近打开」记录模型（2026-11-18）。
 *
 * 旧版只存入口 id：面板空查询时按当前清单解析，没加进入口的东西永远进不来。
 * 现在记录四类"通过 TeamLaunch 成功打开"的对象：
 *  - entry：真实入口，仍只存 id（重命名自动跟随；被删就消失）；
 *  - app / folder / web：未加入入口的直接打开项，存够打开与显示的字段；
 *  - chain：整条已保存连锁，只存 chainId（一条记录 = 一整条连锁，不拆步骤）。
 *
 * 三条边界：
 *  - 只记"这台机器"的（localStorage），不进 settings.json、不跨机同步；
 *  - 永不写 personal.json / 团队配置——最近打开不是入口；
 *  - 解析失败按空列表处理，坏一条不连累整个列表。
 *
 * 纯逻辑放 shared 的原因：门禁脚本（verify:recent）能直接跑，不依赖 React/DOM。
 */
import { CAPACITY } from './schema/common.ts';
import type { Entry } from './schema/entry.ts';
import type { EntryProbe } from './entry-match.ts';

export const RECENT_LIMIT = 20;

export interface RecentEntryRecord {
  kind: 'entry';
  entryId: string;
  at: string;
}

export interface RecentAppRecord {
  kind: 'app';
  name: string;
  target: string;
  sourcePath: string | null;
  args: string;
  cwd: string;
  at: string;
}

export interface RecentFolderRecord {
  kind: 'folder';
  name: string;
  target: string;
  at: string;
}

export interface RecentWebRecord {
  kind: 'web';
  name: string;
  url: string;
  at: string;
}

export interface RecentChainRecord {
  kind: 'chain';
  chainId: string;
  at: string;
}

export type RecentRecord =
  | RecentEntryRecord
  | RecentAppRecord
  | RecentFolderRecord
  | RecentWebRecord
  | RecentChainRecord;

/** 记录本体（不含时间）；写入时由 makeRecent 补 `at`。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RecentInput = DistributiveOmit<RecentRecord, 'at'>;

const MAX_TEXT = 4096;

const asText = (value: unknown, max = MAX_TEXT): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

const asNonEmptyText = (value: unknown, max = MAX_TEXT): string | null => {
  const text = asText(value, max);
  return text.trim().length > 0 ? text : null;
};

/** 路径归一：反斜杠统一、忽略大小写（URL 不适用）。 */
export function normalizeRecentPath(value: string): string {
  return value.trim().replace(/\//g, '\\').toLowerCase();
}

/** 最近一项的唯一键：同一目标/同一连锁重复打开只前移，不产生第二条。 */
export function recentKey(record: RecentRecord): string {
  switch (record.kind) {
    case 'entry':
      return `entry:${record.entryId}`;
    case 'app':
      return `app:${normalizeRecentPath(record.target)}|${record.args.trim()}`;
    case 'folder':
      return `folder:${normalizeRecentPath(record.target)}`;
    case 'web':
      return `web:${record.url.trim()}`;
    case 'chain':
      return `chain:${record.chainId}`;
  }
}

/** 未加入入口的项目（程序/文件夹/网页/连锁）：受「最近打开记录」开关控制。 */
export function isUnlistedRecent(record: RecentRecord): boolean {
  return record.kind !== 'entry';
}

/** 构造一条带时间戳的记录。 */
export function makeRecent(input: RecentInput, at = new Date().toISOString()): RecentRecord {
  return { ...input, at } as RecentRecord;
}

/** 最新在前；同键去重后截断到上限。 */
export function upsertRecent(
  list: readonly RecentRecord[],
  record: RecentRecord,
  limit = RECENT_LIMIT,
): RecentRecord[] {
  const key = recentKey(record);
  return [record, ...list.filter((r) => recentKey(r) !== key)].slice(0, limit);
}

/** 开关关闭时只留入口记录；直接项与连锁一并隐藏（记录本身保留）。 */
export function filterRecentForDisplay(
  list: readonly RecentRecord[],
  includeUnlisted: boolean,
): RecentRecord[] {
  return includeUnlisted ? [...list] : list.filter((r) => r.kind === 'entry');
}

function parseOne(raw: unknown): RecentRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const at = asNonEmptyText(r.at, 64);
  if (at === null) return null;

  /* 旧格式（≤1.9.0）：{ entryId, at }。没有 kind 字段，按入口记录迁移。 */
  const kind = typeof r.kind === 'string' ? r.kind : typeof r.entryId === 'string' ? 'entry' : null;
  if (kind === null) return null;

  if (kind === 'entry') {
    const entryId = asNonEmptyText(r.entryId, CAPACITY.MAX_ID_LEN);
    return entryId === null ? null : { kind: 'entry', entryId, at };
  }
  if (kind === 'chain') {
    const chainId = asNonEmptyText(r.chainId, CAPACITY.MAX_ID_LEN);
    return chainId === null ? null : { kind: 'chain', chainId, at };
  }
  if (kind === 'app') {
    const target = asNonEmptyText(r.target, MAX_TEXT);
    if (target === null) return null;
    return {
      kind: 'app',
      name: asNonEmptyText(r.name, CAPACITY.MAX_NAME_LEN) ?? target.replace(/^.*[\\/]/, '').slice(0, CAPACITY.MAX_NAME_LEN),
      target,
      sourcePath: asNonEmptyText(r.sourcePath, MAX_TEXT),
      args: asText(r.args, MAX_TEXT),
      cwd: asText(r.cwd, MAX_TEXT),
      at,
    };
  }
  if (kind === 'folder') {
    const target = asNonEmptyText(r.target, MAX_TEXT);
    if (target === null) return null;
    return { kind: 'folder', name: asNonEmptyText(r.name, CAPACITY.MAX_NAME_LEN) ?? '', target, at };
  }
  if (kind === 'web') {
    const url = asNonEmptyText(r.url, CAPACITY.MAX_URL_LEN);
    if (url === null) return null;
    return { kind: 'web', name: asNonEmptyText(r.name, CAPACITY.MAX_NAME_LEN) ?? url, url, at };
  }
  return null;
}

/**
 * 解析存储值（JSON 字符串或已解析数组）。
 * 旧格式自动迁移；坏记录整条丢弃；同键只保留第一条（最新）。
 */
export function parseRecentRecords(raw: unknown): RecentRecord[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: RecentRecord[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = parseOne(item);
    if (record === null) continue;
    const key = recentKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
    if (out.length >= RECENT_LIMIT) break;
  }
  return out;
}

/** 未加入入口的记录 → 与入口清单比对的探针（连锁/入口记录返回 null）。 */
export function probeOfRecent(record: RecentRecord): EntryProbe | null {
  if (record.kind === 'app') {
    return { type: 'app', target: record.target, sourcePath: record.sourcePath };
  }
  if (record.kind === 'folder') return { type: 'folder', target: record.target };
  if (record.kind === 'web') return { type: 'web', url: record.url };
  return null;
}

/** 路径末级（文件夹显示名用）；`D:\` 这类根路径回退到自身。 */
export function recentPathBase(value: string): string {
  const cleaned = value.trim().replace(/[\\/]+$/, '');
  const cut = Math.max(cleaned.lastIndexOf('\\'), cleaned.lastIndexOf('/'));
  const base = cleaned.slice(cut + 1);
  return base.length > 0 ? base : cleaned;
}

/** 显示名：入口/连锁由调用方按当前清单解析，这里只处理直接项。 */
export function recentDisplayName(record: RecentRecord): string {
  switch (record.kind) {
    case 'app':
      return record.name || recentPathBase(record.target);
    case 'folder':
      return record.name || recentPathBase(record.target);
    case 'web':
      return record.name || record.url;
    default:
      return '';
  }
}

/**
 * 合成 Entry 的稳定 id：图标缓存与列表 key 都依赖它。
 * 连锁沿用 `chain:` 前缀（收藏与启动链路按这个前缀识别）。
 */
export function recentDisplayId(record: RecentRecord): string {
  if (record.kind === 'chain') return `chain:${record.chainId}`;
  return `recent:${record.kind}:${hash36(recentKey(record))}`;
}

/** FNV-1a 32 位 → base36（稳定、短、无 Node 依赖）。 */
function hash36(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** 直接打开项 → 记录本体；入口对象返回 null（入口走 recordEntryOpen）。 */
export function directRecentInput(entry: Entry): RecentInput | null {
  const name = entry.name.slice(0, CAPACITY.MAX_NAME_LEN);
  if (entry.type === 'app') {
    const target = entry.target.trim();
    if (target.length === 0) return null;
    return {
      kind: 'app',
      name,
      target,
      sourcePath: entry.sourcePath ?? null,
      args: entry.args ?? '',
      cwd: entry.cwd ?? '',
    };
  }
  if (entry.type === 'folder') {
    const target = entry.target.trim();
    if (target.length === 0) return null;
    return { kind: 'folder', name, target };
  }
  const url = entry.url.trim();
  if (url.length === 0) return null;
  return { kind: 'web', name, url };
}

/** 取网页标题回写后的新列表；记录已不存在/不是网页时原样返回。 */
export function renameRecentTitle(
  list: readonly RecentRecord[],
  key: string,
  title: string,
): RecentRecord[] {
  const clean = title.trim().slice(0, CAPACITY.MAX_NAME_LEN);
  if (clean.length === 0) return [...list];
  return list.map((record) => {
    if (recentKey(record) !== key || record.kind !== 'web') return record;
    return { ...record, name: clean };
  });
}
