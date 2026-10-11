/**
 * 入口同一性判定（纯函数，放 shared 以便进门禁/smoke）。
 *
 * 用途：剪贴板里的网址/路径"是不是清单里已经有这一条"——已经有的不该再插一行，
 * 而是把高亮直接落到那一条（用户要的"快捷进入"）。
 *
 * 判定口径：
 *  - 只比"同一个类型的同一个目标"：类型不同一律不算同一条（同名不同类很常见）；
 *  - 路径按 Windows 口径归一：反斜杠统一、忽略大小写、两侧空白去掉；
 *    app 入口的目标和它记住的原始 .lnk 路径都算；
 *  - 网址只去掉两侧空白（URL 路径大小写敏感，不能 lowercase）。
 */
import type { Entry, EntryType } from './schema/entry.ts';

/** 被比对的一方：来自剪贴板识别的结果，字段可能不全。 */
export interface EntryProbe {
  type: EntryType;
  url?: string | null;
  target?: string | null;
  sourcePath?: string | null;
}

const normPath = (p: string): string => p.trim().replace(/\//g, '\\').toLowerCase();
const normUrl = (u: string): string => u.trim();

function pathsOf(entry: Entry): string[] {
  if (entry.type === 'web') return [];
  const out: string[] = [];
  if (typeof entry.target === 'string' && entry.target.length > 0) out.push(normPath(entry.target));
  if (entry.type === 'app' && typeof entry.sourcePath === 'string' && entry.sourcePath.length > 0) {
    out.push(normPath(entry.sourcePath));
  }
  return out;
}

export function matchesProbe(entry: Entry, probe: EntryProbe): boolean {
  if (entry.type !== probe.type) return false;
  if (entry.type === 'web') {
    return typeof probe.url === 'string' && probe.url.length > 0 && normUrl(entry.url) === normUrl(probe.url);
  }
  const mine = pathsOf(entry);
  if (mine.length === 0) return false;
  const theirs = [probe.target, probe.sourcePath]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map(normPath);
  return theirs.some((t) => mine.includes(t));
}

/** 在清单里找同一条入口（找不到返回 -1）。 */
export function findEntryIndex(list: readonly Entry[], probe: EntryProbe): number {
  return list.findIndex((e) => matchesProbe(e, probe));
}
