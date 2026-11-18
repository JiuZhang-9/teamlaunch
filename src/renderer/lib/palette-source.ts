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
import {
  probeOfRecent,
  recentDisplayId,
  recentDisplayName,
  recentPathBase,
  type RecentRecord,
} from '../../shared/recent.ts';
import { CAPACITY } from '../../shared/schema/common.ts';
import type { Entry } from '../../shared/schema/entry.ts';
import type { Group } from '../../shared/schema/group.ts';
import type { ProgramIndexSnapshot } from '../../shared/schema/programs.ts';
import { defaultWebName } from '../../shared/web-name.ts';
import type { IdentifyResult } from '../bridge/types.ts';

/** 行的种类（默认 result）。 */
export type PaletteHitKind = 'result' | 'system' | 'clip-new' | 'clip-existing' | 'favorite' | 'recent' | 'chain';

export interface PaletteHit {
  entry: Entry;
  subtitle: string;
  source: '团队' | '本机' | '程序';
  kind?: PaletteHitKind;
  /** 入口结果所属分组（主窗口副标题用；程序/剪贴板新条目没有）。 */
  groupName?: string;
  /** 连锁命中（kind='chain' 或最近打开里的连锁）时的步数（副标题与徽标用）。 */
  chainSteps?: number;
  /** 未加入入口的合成项（最近打开里的程序/文件夹/网页）：打开时不要再记成入口 id。 */
  unlisted?: true;
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
/** 「收藏」与「最近打开」各占一行图标格：面板 720px 下 7 列，主窗口方格 86px 下 8 列（1.9.0）。 */
export const SECTION_MAX = 6;
export const PALETTE_SECTION_MAX = 7;
export const WINDOW_SECTION_MAX = 8;
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
  /** 全部候选（团队 + 本机）：收藏/最近/剪贴板去重用。 */
  candidates: Candidate[];
  /** 查询结果用的候选；默认 = candidates。主窗口传当前 Tab，保证"搜索只作用于当前页"。 */
  searchCandidates?: Candidate[];
  clip: ClipboardCandidate | null;
  query: string;
  /** 收藏 id，最近收藏的在前。收藏的连锁带 `chain:` 前缀（1.9.0），用 chains 解析。 */
  favoriteIds: string[];
  /** 最近打开记录（最新在前）：入口 id + 未加入入口的程序/文件夹/网页/连锁。 */
  recent: RecentRecord[];
  /** 是否显示未加入入口的记录（settings.recentIncludeUnlisted）。 */
  recentIncludeUnlisted: boolean;
  programHits: PaletteHit[];
  /** 本机已存的连锁（1.9.0 连锁可收藏）：收藏行、最近打开的连锁、按名搜索都从这里出。 */
  chains?: PaletteChainRef[];
  /** entries=入口搜索（默认）；programs=Ctrl+Alt+F 的程序专用范围。 */
  scope?: 'entries' | 'programs';
  /** 入口结果最多显示几条。 */
  maxRows?: number;
  /** 收藏/最近打开各显示几个（面板 7、主窗口 8——方格一行能放下）。 */
  sectionMax?: number;
}

/** 收藏里的连锁引用（只带渲染需要的字段，避免 palette-source 依赖 chainStore）。 */
export interface PaletteChainRef {
  id: string;
  name: string;
  steps: number;
}

/** 收藏列表里的连锁 id 前缀（favorites.json 与入口 id 同列表存，前缀区分）。 */
export const CHAIN_FAV_PREFIX = 'chain:';

/** 连锁的合成入口：只为渲染（稳定身份色 + 首字），不走图标提取；打开走连锁启动链路。 */
function chainEntryOf(c: PaletteChainRef): Entry {
  const now = new Date().toISOString();
    return {
      id: `${CHAIN_FAV_PREFIX}${c.id}`,
      name: c.name,
      type: 'app',
      target: '',
      args: '',
      cwd: '',
      expandEnv: true,
      sort: 0,
      description: null,
      icon: { kind: 'fallback' },
      iconAssetHash: null,
      updatedAt: now,
    };
}

/** 最近打开里的未加入入口记录 → 临时 Entry（只为渲染/打开，不落库、不参与同步）。 */
function directRecentEntry(record: RecentRecord): Entry | null {
  if (record.kind === 'entry' || record.kind === 'chain') return null;
  const name = (recentDisplayName(record).trim() || '未命名').slice(0, CAPACITY.MAX_NAME_LEN);
  if (record.kind === 'app') {
    return {
      id: recentDisplayId(record),
      name,
      type: 'app',
      target: record.target,
      sourcePath: record.sourcePath,
      args: record.args,
      cwd: record.cwd,
      expandEnv: true,
      sort: 0,
      description: null,
      icon: { kind: 'local' },
      iconAssetHash: null,
      updatedAt: record.at,
    };
  }
  if (record.kind === 'folder') {
    return {
      id: recentDisplayId(record),
      name,
      type: 'folder',
      target: record.target,
      sort: 0,
      description: null,
      icon: { kind: 'local' },
      iconAssetHash: null,
      updatedAt: record.at,
    };
  }
  return {
    id: recentDisplayId(record),
    name,
    type: 'web',
    url: record.url,
    sort: 0,
    description: null,
    icon: { kind: 'fallback' },
    iconAssetHash: null,
    updatedAt: record.at,
  };
}

/** 未加入入口项的副标题：程序 exe / 文件夹路径 / 网页域名（连锁另有步数）。 */
function recentSubtitle(record: RecentRecord): string {
  if (record.kind === 'app') return `程序 · ${recentPathBase(record.target)}`;
  if (record.kind === 'folder') return `文件夹 · ${record.target}`;
  if (record.kind === 'web') return `网页 · ${defaultWebName(record.url) ?? record.url}`;
  return '连锁';
}

/** 剪贴板置顶行（旧名 isPinnedHit 容易和收藏混淆，1.7.0 改名）。 */
export function isClipboardHit(hit: PaletteHit | undefined): boolean {
  return hit?.kind === 'clip-new' || hit?.kind === 'clip-existing';
}

export function buildHits(input: BuildHitsInput): PaletteHit[] {
  const {
    candidates,
    clip,
    query,
    favoriteIds,
    recent: recentRecords,
    recentIncludeUnlisted,
    programHits,
    scope = 'entries',
  } = input;
  const searchPool = input.searchCandidates ?? candidates;
  const maxRows = input.maxRows ?? MAX_ROWS;
  const sectionMax = input.sectionMax ?? SECTION_MAX;
  const q = query.trim();

  /* 程序专用范围（Ctrl+Alt+F）：只搜本机程序。空查询不铺列表——
     几百个程序铺出来既慢又没法选，给一句"输入程序名"的提示更有用。 */
  if (scope === 'programs') return q.length === 0 ? [] : programHits;

  const items = candidates.map((c) => c.entry);

  /** 剪贴板置顶行：新内容可直接打开/加为入口；已在清单里的则把那条真实入口置顶。 */
  const clipRows: PaletteHit[] = [];
  if (clip) {
    const idx = findEntryIndex(items, clip.probe);
    if (idx >= 0) {
      clipRows.push({
        entry: items[idx],
        subtitle: `剪贴板内容 · ${targetSummary(items[idx])}`,
        source: candidates[idx].source,
        kind: 'clip-existing',
        groupName: candidates[idx].groupName,
      });
    } else {
      clipRows.push({
        entry: clip.draft,
        subtitle: `剪贴板内容 · ${targetSummary(clip.draft)}`,
        source: '本机',
        kind: 'clip-new',
      });
    }
  }
  const clipId = clipRows[0]?.entry.id ?? null;

  if (q.length === 0) {
    const byId = new Map(candidates.map((c) => [c.entry.id, c]));

    /* 「收藏」行：用户主动收藏的入口 + 收藏的连锁（chain: 前缀，1.9.0），一行放得下 7/8 个。
       favoriteIds 已经是最近收藏在前；超过一行时只显示最近的，刚收藏完立刻能看到。 */
    const favoriteHits: PaletteHit[] = [];
    const favoriteIdSet = new Set<string>();
    for (const id of favoriteIds) {
      if (id === clipId || favoriteIdSet.has(id)) continue;
      if (id.startsWith(CHAIN_FAV_PREFIX)) {
        const c = (input.chains ?? []).find((x) => `${CHAIN_FAV_PREFIX}${x.id}` === id);
        if (!c) continue;
        favoriteIdSet.add(id);
        favoriteHits.push({
          entry: chainEntryOf(c),
          subtitle: `连锁 · ${c.steps} 步`,
          source: '本机',
          kind: 'chain',
          chainSteps: c.steps,
        });
        if (favoriteHits.length >= sectionMax) break;
        continue;
      }
      const c = byId.get(id);
      if (!c) continue;
      favoriteIdSet.add(id);
      favoriteHits.push({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source, kind: 'favorite', groupName: c.groupName });
      if (favoriteHits.length >= sectionMax) break;
    }

    /* 「最近打开」行（2026-11-18 扩展）：入口记录按 id 解析；未加入入口的程序/文件夹/网页/
       连锁构造临时行。已收藏/剪贴板置顶/同一目标已出现的都不重复。
       某条直接项后来被加为入口时，按 target/url 命中真实入口并合并成一条（入口名优先）。 */
    const recent: PaletteHit[] = [];
    const seenRecent = new Set<string>();
    const candidateEntries = candidates.map((c) => c.entry);
    for (const record of recentRecords) {
      if (recent.length >= sectionMax) break;
      if (!recentIncludeUnlisted && record.kind !== 'entry') continue;

      let hit: PaletteHit;
      if (record.kind === 'entry') {
        const c = byId.get(record.entryId);
        if (!c) continue;
        hit = {
          entry: c.entry,
          subtitle: subtitleOf(c.entry),
          source: c.source,
          kind: 'recent',
          groupName: c.groupName,
        };
      } else if (record.kind === 'chain') {
        const ref = (input.chains ?? []).find((x) => x.id === record.chainId);
        if (!ref) continue;
        hit = {
          entry: chainEntryOf(ref),
          subtitle: `连锁 · ${ref.steps} 步`,
          source: '本机',
          kind: 'recent',
          chainSteps: ref.steps,
        };
      } else {
        const probe = probeOfRecent(record);
        if (probe === null) continue;
        const idx = findEntryIndex(candidateEntries, probe);
        if (idx >= 0) {
          const c = candidates[idx];
          hit = {
            entry: c.entry,
            subtitle: subtitleOf(c.entry),
            source: c.source,
            kind: 'recent',
            groupName: c.groupName,
          };
        } else {
          const entry = directRecentEntry(record);
          if (entry === null) continue;
          hit = {
            entry,
            subtitle: recentSubtitle(record),
            source: record.kind === 'app' ? '程序' : '本机',
            kind: 'recent',
            unlisted: true,
          };
        }
      }

      if (hit.entry.id === clipId || favoriteIdSet.has(hit.entry.id) || seenRecent.has(hit.entry.id)) continue;
      seenRecent.add(hit.entry.id);
      recent.push(hit);
    }
    if (recent.length > 0) return [...clipRows, ...favoriteHits, ...recent];

    /* 有记录但全部被开关隐藏/已失效：不再回退"清单前几条"——
       那批结果会被误读成最近打开。视图会保留标题行与"已隐藏"提示。 */
    if (recentRecords.length > 0) return [...clipRows, ...favoriteHits];

    /* 一条最近记录都没有：收藏行之后回退展示当前范围前几条。
       kind 保持 result（不贴「最近打开」标签）——标签必须如实描述这批结果是什么。 */
    const fallback = searchPool
      .filter((c) => c.entry.id !== clipId && !favoriteIdSet.has(c.entry.id))
      .slice(0, sectionMax)
      .map((c) => ({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source, groupName: c.groupName }));
    return [...clipRows, ...favoriteHits, ...fallback];
  }

  const scored = searchPool
    .filter((c) => c.entry.id !== clipId)
    .map((c) => ({ c, score: matches(c.entry, c.groupName, q) }))
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || (a.c.source === '团队' ? -1 : 1));
  const rows = scored
    .slice(0, Math.max(0, maxRows - clipRows.length))
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

  /* 收藏的连锁按名参与搜索（1.9.0）：排在入口结果之后、本机程序之前——
     连锁是用户手工攒的组合，优先级理应高于自动索引的程序。 */
  const chainHits: PaletteHit[] = (input.chains ?? [])
    .map((c) => ({ c, score: matches(chainEntryOf(c), '', q) }))
    .filter((x) => x.score > 0)
    .slice(0, 3)
    .map((x) => ({
      entry: chainEntryOf(x.c),
      subtitle: `连锁 · ${x.c.steps} 步`,
      source: '本机' as const,
      kind: 'chain' as const,
      chainSteps: x.c.steps,
    }));

  return [...clipRows, ...rows, ...chainHits, ...programsToShow];
}

/** 空查询的快速打开：收藏 + 最近打开（没有最近记录时回退当前范围前几条）。 */
export function buildQuickAccess(
  input: Omit<BuildHitsInput, 'query' | 'programHits' | 'scope'>,
): PaletteHit[] {
  return buildHits({ ...input, query: '', programHits: [], scope: 'entries' });
}
