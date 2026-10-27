/**
 * 快捷窗口与主窗口搜索共用的候选/打分/去重逻辑（2026-10-27，1.4.0，C5）。
 *
 * 为什么必须共用：两边都在做"剪贴板候选 → 入口结果 → 本机程序"这件事。
 * 各写一套的结局是同一句查询在面板里搜得到、在主窗口里搜不到（或顺序不同）。
 * 这里只做数据，不碰 React；两个视图各自负责渲染与键盘。
 */
import { api } from '../bridge/index.ts';
import { matches, subtitleOf, targetSummary } from './entry.ts';
import { programSubtitle, systemEntry } from './programs.ts';
import { normalizeProgramPath } from '../../shared/program-filter.ts';
import { scoreProgram } from '../../shared/program-match.ts';
import { findEntryIndex, type EntryProbe } from '../../shared/entry-match.ts';
import type { Entry } from '../../shared/schema/entry.ts';
import type { Group } from '../../shared/schema/group.ts';
import type { ProgramIndexSnapshot } from '../../shared/schema/programs.ts';
import type { IdentifyResult } from '../bridge/types.ts';

/** 行的种类（默认 result）。 */
export type PaletteHitKind = 'result' | 'system' | 'clip-new' | 'clip-existing' | 'pinned' | 'recent';

export interface PaletteHit {
  entry: Entry;
  subtitle: string;
  source: '团队' | '本机' | '程序';
  kind?: PaletteHitKind;
  /** 入口结果所属分组（主窗口副标题用；程序/剪贴板新条目没有）。 */
  groupName?: string;
}

export interface Candidate {
  entry: Entry;
  groupName: string;
  source: '团队' | '本机';
}

export interface ClipboardCandidate {
  probe: EntryProbe;
  draft: Entry;
  text: string;
}

type Identified = Exclude<IdentifyResult, { kind: 'none' }>;

export const MAX_ROWS = 9;
export const MAX_PROGRAM_ROWS = 8;
export const MAX_PROGRAM_SCOPE_ROWS = 14;
/** 「固定」与「最近打开」各占一行图标格：面板 720px 下 7 列，主窗口 6 列。 */
export const SECTION_MAX = 6;
export const PALETTE_SECTION_MAX = 7;
/** 剪贴板文本长度上限：再长就不是"一个网址/一条路径"了。 */
export const CLIP_MAX = 4096;
/** 主窗口内容区更宽：入口结果与程序结果都可以多显示一些。 */
export const MAX_WINDOW_ROWS = 20;
export const MAX_WINDOW_PROGRAM_ROWS = 10;

/** 识别结果 → 比对探针（判断"清单里是不是已经有这一条"）。 */
function probeOf(id: Identified): EntryProbe {
  if (id.kind === 'web') return { type: 'web', url: id.url };
  if (id.kind === 'app') return { type: 'app', target: id.target, sourcePath: id.sourcePath };
  return { type: 'folder', target: id.target };
}

/** 识别结果 → 临时入口对象（只为渲染候选行；真正落库时由编辑器重新生成 id）。 */
function draftOf(id: Identified): Entry {
  const now = new Date().toISOString();
  if (id.kind === 'web') {
    return {
      id: 'clipboard-candidate', name: id.name, type: 'web', url: id.url,
      sort: 0, description: null, icon: { kind: 'fallback' }, iconAssetHash: null, updatedAt: now,
    };
  }
  if (id.kind === 'app') {
    return {
      id: 'clipboard-candidate', name: id.name, type: 'app', target: id.target,
      sourcePath: id.sourcePath, args: id.args ?? '', cwd: id.cwd ?? '', expandEnv: true,
      sort: 0, description: null, icon: { kind: 'local' }, iconAssetHash: null, updatedAt: now,
    };
  }
  return {
    id: 'clipboard-candidate', name: id.name, type: 'folder', target: id.target,
    sort: 0, description: null, icon: { kind: 'local' }, iconAssetHash: null, updatedAt: now,
  };
}

/**
 * 读一次剪贴板并识别成候选。失败/不识别一律返回 null——
 * 剪贴板候选是加分项，坏了不该打扰用户。
 *
 * 只认"整段就是一个条目"的剪贴板：含换行、超长一律不识别。
 * 把一段聊天记录/一串路径拆开去猜，最后只会变成一堆歧义（用户明确要求不做批量匹配）。
 */
export async function readClipboardCandidate(): Promise<ClipboardCandidate | null> {
  try {
    const text = String((await api.clipboard.read()) ?? '').trim();
    if (text.length === 0 || text.length > CLIP_MAX || /[\r\n]/.test(text)) return null;
    const identified = await api.entries.identify(text);
    if (identified.kind === 'none') return null;
    return { probe: probeOf(identified), draft: draftOf(identified), text };
  } catch {
    return null;
  }
}

export function buildCandidates(teamGroups: Group[], personalGroups: Group[]): Candidate[] {
  const list: Candidate[] = [];
  for (const g of teamGroups) {
    for (const e of g.entries) list.push({ entry: e, groupName: g.name, source: '团队' });
  }
  for (const g of personalGroups) {
    for (const e of g.entries) list.push({ entry: e, groupName: g.name, source: '本机' });
  }
  return list;
}

/** 本机程序结果：**不按"已添加入口"预先过滤**（入口搜索不支持拼音，过滤后会什么都搜不到）。 */
export function buildProgramHits(programs: ProgramIndexSnapshot, query: string, limit: number): PaletteHit[] {
  const q = query.trim();
  if (q.length === 0 || programs.items.length === 0) return [];
  return programs.items
    .map((p) => ({ p, score: scoreProgram(p, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'zh-CN'))
    .slice(0, limit)
    .map(({ p }) => ({
      entry: systemEntry(p, programs.scannedAt),
      subtitle: programSubtitle(p),
      source: '程序' as const,
      kind: 'system' as const,
    }));
}

export interface BuildHitsInput {
  /** 全部候选（团队 + 本机）：固定/最近/剪贴板去重用。 */
  candidates: Candidate[];
  /** 查询结果用的候选；默认 = candidates。主窗口传当前 Tab，保证"搜索只作用于当前页"。 */
  searchCandidates?: Candidate[];
  clip: ClipboardCandidate | null;
  query: string;
  pinnedIds: string[];
  recentIds: string[];
  programHits: PaletteHit[];
  /** entries=入口搜索（默认）；programs=Ctrl+Alt+F 的程序专用范围。 */
  scope?: 'entries' | 'programs';
  /** 入口结果最多显示几条。 */
  maxRows?: number;
  /** 固定/最近打开各显示几个（面板 7、主窗口 6）。 */
  sectionMax?: number;
}

export function isPinnedHit(hit: PaletteHit | undefined): boolean {
  return hit?.kind === 'clip-new' || hit?.kind === 'clip-existing';
}

export function buildHits(input: BuildHitsInput): PaletteHit[] {
  const { candidates, clip, query, pinnedIds, recentIds, programHits, scope = 'entries' } = input;
  const searchPool = input.searchCandidates ?? candidates;
  const maxRows = input.maxRows ?? MAX_ROWS;
  const sectionMax = input.sectionMax ?? SECTION_MAX;
  const q = query.trim();

  /* 程序专用范围（Ctrl+Alt+F）：只搜本机程序。空查询不铺列表——
     几百个程序铺出来既慢又没法选，给一句"输入程序名"的提示更有用。 */
  if (scope === 'programs') return q.length === 0 ? [] : programHits;

  const items = candidates.map((c) => c.entry);

  /** 剪贴板置顶行：新内容可直接打开/加为入口；已在清单里的则把那条真实入口置顶。 */
  const pinned: PaletteHit[] = [];
  if (clip) {
    const idx = findEntryIndex(items, clip.probe);
    if (idx >= 0) {
      pinned.push({
        entry: items[idx],
        subtitle: `剪贴板内容 · ${targetSummary(items[idx])}`,
        source: candidates[idx].source,
        kind: 'clip-existing',
        groupName: candidates[idx].groupName,
      });
    } else {
      pinned.push({
        entry: clip.draft,
        subtitle: `剪贴板内容 · ${targetSummary(clip.draft)}`,
        source: '本机',
        kind: 'clip-new',
      });
    }
  }
  const pinnedId = pinned[0]?.entry.id ?? null;

  if (q.length === 0) {
    const byId = new Map(candidates.map((c) => [c.entry.id, c]));

    /* 「固定」行：用户手动钉住的入口，一行放得下 6 个。
       超过 6 个时显示**最近固定的 6 个**——刚固定完立刻能看到，而不是被旧固定挤出去。 */
    const fixed: PaletteHit[] = [];
    const fixedIds = new Set<string>();
    for (const id of [...pinnedIds].reverse()) {
      if (id === pinnedId || fixedIds.has(id)) continue;
      const c = byId.get(id);
      if (!c) continue;
      fixedIds.add(id);
      fixed.push({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source, kind: 'pinned', groupName: c.groupName });
      if (fixed.length >= sectionMax) break;
    }

    /* 「最近打开」行：自动记录，已固定/剪贴板置顶的不重复出现。 */
    const recent: PaletteHit[] = [];
    for (const id of recentIds) {
      if (id === pinnedId || fixedIds.has(id)) continue;
      const c = byId.get(id);
      if (!c) continue;
      recent.push({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source, kind: 'recent', groupName: c.groupName });
      if (recent.length >= sectionMax) break;
    }
    if (recent.length > 0) return [...pinned, ...fixed, ...recent];

    /* 一条最近记录都没有：固定行之后回退展示当前范围前几条。
       kind 保持 result（不贴「最近打开」标签）——标签必须如实描述这批结果是什么。 */
    const fallback = searchPool
      .filter((c) => c.entry.id !== pinnedId && !fixedIds.has(c.entry.id))
      .slice(0, sectionMax)
      .map((c) => ({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source, groupName: c.groupName }));
    return [...pinned, ...fixed, ...fallback];
  }

  const scored = searchPool
    .filter((c) => c.entry.id !== pinnedId)
    .map((c) => ({ c, score: matches(c.entry, c.groupName, q) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || (a.c.source === '团队' ? -1 : 1));
  const rows = scored
    .slice(0, Math.max(0, maxRows - pinned.length))
    .map((x) => ({
      entry: x.c.entry,
      subtitle: `${targetSummary(x.c.entry)} · ${x.c.groupName}`,
      source: x.c.source,
      groupName: x.c.groupName,
    }));

  /* 入口结果与程序结果去重：只有**本次查询实际显示出来的入口**才隐藏同目标的程序行。
     入口没命中（例如用拼音搜中文名）或命中但被截掉时，程序行必须保留，
     否则用户会看到"有结果却一条都没显示"。 */
  const matchedEntryPaths = new Set<string>();
  for (const r of rows) {
    const e = r.entry;
    if (e.type !== 'app') continue;
    matchedEntryPaths.add(normalizeProgramPath(e.target));
    if (e.sourcePath) matchedEntryPaths.add(normalizeProgramPath(e.sourcePath));
  }
  const programsToShow = programHits.filter((h) => {
    const e = h.entry;
    if (e.type !== 'app') return true;
    if (matchedEntryPaths.has(normalizeProgramPath(e.target))) return false;
    return !(e.sourcePath && matchedEntryPaths.has(normalizeProgramPath(e.sourcePath)));
  });

  return [...pinned, ...rows, ...programsToShow];
}

/** 空查询的快速打开：固定 + 最近打开（没有最近记录时回退当前范围前几条）。 */
export function buildQuickAccess(
  input: Omit<BuildHitsInput, 'query' | 'programHits' | 'scope'>,
): PaletteHit[] {
  return buildHits({ ...input, query: '', programHits: [], scope: 'entries' });
}
