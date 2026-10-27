/**
 * V-03 迷你唤起面板的视图层：本机内存索引 + 120ms 防抖 + 键盘导航 + 剪贴板候选行。
 *
 * 本视图 **100% 本地**，不发起任何网络请求；出现"正在同步"字样即为实现错误。
 * 结果排序与 V-04 同一套：名称前缀 > 关键词 > 分组名 > 路径末级/域名。
 *
 * 空查询时自上而下：
 *   ① 剪贴板候选行（唤起时读一次剪贴板；**只认整段就是一个网址/路径的单条内容**）
 *   ② 最近打开（真实记录，最多 7 条；没有记录时回退清单前几条，此时不贴「最近打开」标签）
 *   ③ 清单为空 → 不给列表，只给一句"去哪里添加"的提示（S12）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../bridge/index.ts';
import { MiniPalette, type PaletteHit } from '../components/organisms/MiniPalette.tsx';
import { useEntryIcons } from '../hooks/useEntryIcons.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { matches, subtitleOf, targetSummary } from '../lib/entry.ts';
import { programSubtitle, systemEntry, usePrograms } from '../lib/programs.ts';
import { normalizeProgramPath } from '../../shared/program-filter.ts';
import { scoreProgram } from '../../shared/program-match.ts';
import { useRecentOpenIds } from '../lib/recentOpens.ts';
import { togglePinnedEntry, usePinnedEntryIds } from '../lib/pinnedEntries.ts';
import { findEntryIndex, type EntryProbe } from '../../shared/entry-match.ts';
import { usePersonal } from '../store/personalStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { syncPresentation } from '../services/syncCopy.ts';
import type { Entry } from '../../shared/schema/entry.ts';
import type { IdentifyResult } from '../bridge/types.ts';

interface Candidate {
  entry: Entry;
  groupName: string;
  source: '团队' | '本机';
}

const MAX_ROWS = 7;
/** 入口搜索时本机程序最多显示几条（再多就滚动，不把入口结果挤没）。 */
const MAX_PROGRAM_ROWS = 8;
/** Ctrl+Alt+F 的程序专用范围：没有入口结果竞争，可以多显示一些。 */
const MAX_PROGRAM_SCOPE_ROWS = 12;
/** 「固定」与「最近打开」各占一行图标格：一行放得下 6 个 86px 格子。 */
const SECTION_MAX = 6;
/** 剪贴板文本长度上限：再长就不是"一个网址/一条路径"了。 */
const CLIP_MAX = 4096;

type Identified = Exclude<IdentifyResult, { kind: 'none' }>;

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

export function MiniPaletteView({
  open,
  onClose,
  docked = false,
  scope = 'entries',
}: {
  open: boolean;
  onClose(): void;
  docked?: boolean;
  /** entries=入口搜索（默认）；programs=Ctrl+Alt+F 打开的本机程序专用搜索。 */
  scope?: 'entries' | 'programs';
}) {
  const { snapshot } = useSync();
  const { config: personal } = usePersonal();
  const { openEntry, quickAddFromText } = useWorkbench();
  const { push } = useToasts();
  const programs = usePrograms();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  /** 剪贴板候选：唤起时识别一次；「已是清单里的一条」在渲染时按当前清单判定。
      text 留着原样转给"加为入口"——重新识别一遍比在这里拼 target 更可靠（.lnk 会丢原始路径）。 */
  const [clip, setClip] = useState<{ probe: EntryProbe; draft: Entry; text: string } | null>(null);
  const debounced = useDebouncedValue(query, 120);
  /** 固定与最近打开都是本机记忆：面板开着时被主窗口更新，也要立刻跟着变。 */
  const pinnedIds = usePinnedEntryIds();
  const recentIds = useRecentOpenIds();

  const presentation = syncPresentation(snapshot);
  const teamGroups = presentation.renderable ? (snapshot.config?.groups ?? []) : [];

  const candidates = useMemo<Candidate[]>(() => {
    const list: Candidate[] = [];
    for (const g of teamGroups) {
      for (const e of g.entries) list.push({ entry: e, groupName: g.name, source: '团队' });
    }
    for (const g of personal.groups) {
      for (const e of g.entries) list.push({ entry: e, groupName: g.name, source: '本机' });
    }
    return list;
  }, [teamGroups, personal.groups]);

  const items = useMemo(() => candidates.map((c) => c.entry), [candidates]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelected(0);
      setClip(null);
      return;
    }
    // 程序专用范围不参与剪贴板候选：用户此刻要搜的是本机程序，不是粘贴内容。
    if (scope === 'programs') {
      setClip(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const text = String((await api.clipboard.read()) ?? '').trim();
        /* 只认"整段就是一个条目"的剪贴板：含换行、超长一律不识别。
           把一段聊天记录/一串路径拆开去猜，最后只会变成一堆歧义（用户明确要求不做批量匹配）。 */
        if (text.length === 0 || text.length > CLIP_MAX || /[\r\n]/.test(text)) return;
        const identified = await api.entries.identify(text);
        if (cancelled || identified.kind === 'none') return;
        setClip({ probe: probeOf(identified), draft: draftOf(identified), text });
      } catch {
        // 剪贴板读不到（被别的程序占住等）：静默——剪贴板候选是加分项，坏了不该打扰用户
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  /** 本机程序结果：**不按"已添加入口"预先过滤**。
   *
   * 原因（2026-10-24）：入口搜索只做名称/关键词子串匹配，不支持拼音；如果"微信"已经是入口，
   * 用户输入 `wx` 时入口不会命中——此时若把程序结果也按"已添加"过滤掉，就什么都搜不到。
   * 去重放在 hits 层：只有**入口结果也命中同一目标**时才隐藏程序行（见下方 matchedEntryPaths）。
   */
  const programHits = useMemo<PaletteHit[]>(() => {
    const q = debounced.trim();
    if (q.length === 0 || programs.items.length === 0) return [];
    const limit = scope === 'programs' ? MAX_PROGRAM_SCOPE_ROWS : MAX_PROGRAM_ROWS;
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
  }, [debounced, programs.items, programs.scannedAt, scope]);

  const hits = useMemo<PaletteHit[]>(() => {
    const q = debounced.trim();
    /* 程序专用范围（Ctrl+Alt+F）：只搜本机程序。空查询不铺列表——
       几百个程序铺出来既慢又没法选，给一句"输入程序名"的提示更有用。 */
    if (scope === 'programs') return q.length === 0 ? [] : programHits;
    /** 剪贴板置顶行：新内容可直接打开/加为入口；已在清单里的则把那条真实入口置顶（快捷进入）。 */
    const pinned: PaletteHit[] = [];
    if (clip) {
      const idx = findEntryIndex(items, clip.probe);
      if (idx >= 0) {
        pinned.push({
          entry: items[idx],
          subtitle: `剪贴板内容 · ${targetSummary(items[idx])}`,
          source: candidates[idx].source,
          kind: 'clip-existing',
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

      /* 「固定」行（2026-10-21 用户要求）：用户手动钉住的入口，一行放得下 6 个。
         超过 6 个时显示**最近固定的 6 个**——刚固定完立刻能看到，而不是被旧固定挤出去。
         已删除/未同步的自动跳过；与剪贴板置顶行重复时不重复插。 */
      const fixed: PaletteHit[] = [];
      const fixedIds = new Set<string>();
      for (const id of [...pinnedIds].reverse()) {
        if (id === pinnedId || fixedIds.has(id)) continue;
        const c = byId.get(id);
        if (!c) continue;
        fixedIds.add(id);
        fixed.push({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source, kind: 'pinned' });
        if (fixed.length >= SECTION_MAX) break;
      }

      /* 「最近打开」行：自动记录，已固定/剪贴板置顶的不重复出现。 */
      const recent: PaletteHit[] = [];
      for (const id of recentIds) {
        if (id === pinnedId || fixedIds.has(id)) continue;
        const c = byId.get(id);
        if (!c) continue;
        recent.push({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source, kind: 'recent' });
        if (recent.length >= SECTION_MAX) break;
      }
      if (recent.length > 0) return [...pinned, ...fixed, ...recent];

      /* 一条最近记录都没有：固定行之后回退展示清单前几条。
         kind 保持 result（不贴「最近打开」标签）——标签必须如实描述这批结果是什么。 */
      const fallback = candidates
        .filter((c) => c.entry.id !== pinnedId && !fixedIds.has(c.entry.id))
        .slice(0, SECTION_MAX)
        .map((c) => ({ entry: c.entry, subtitle: subtitleOf(c.entry), source: c.source }));
      return [...pinned, ...fixed, ...fallback];
    }

    const scored = candidates
      .filter((c) => c.entry.id !== pinnedId)
      .map((c) => ({ c, score: matches(c.entry, c.groupName, q) }))
      .filter((x) => x.score > 0);
    scored.sort((a, b) => b.score - a.score || (a.c.source === '团队' ? -1 : 1));
    const rows = scored
      .slice(0, Math.max(0, MAX_ROWS - pinned.length))
      .map((x) => ({
        entry: x.c.entry,
        subtitle: `${targetSummary(x.c.entry)} · ${x.c.groupName}`,
        source: x.c.source,
      }));

    /* 入口结果与程序结果去重：只有**本次查询实际显示出来的入口**才隐藏同目标的程序行。
       入口没命中（例如用拼音搜中文名）或命中但被 MAX_ROWS 截掉时，程序行必须保留，
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
  }, [candidates, items, clip, debounced, pinnedIds, recentIds, programHits, scope]);

  /* 图标只为**当前可见的命中**取（面板窗口常驻预热：关着时不取、也不为整份清单预取——
     那会和主窗口抢 shell 图标链，反而把可见图标挤成 null）。 */
  const iconEntries = useMemo(
    () => hits.filter((h) => h.kind !== 'clip-new').map((h) => h.entry),
    [hits],
  );
  const icons = useEntryIcons(iconEntries, open);

  useEffect(() => {
    if (selected > hits.length - 1) setSelected(0);
  }, [hits.length, selected]);

  /* 范围切换（Ctrl+Alt+F 打开程序搜索 / 下次普通唤起回到入口搜索）时清空输入：
     上一次的查询词属于另一个范围，留着会让用户以为程序搜索没结果。 */
  useEffect(() => {
    setQuery('');
    setSelected(0);
  }, [scope]);

  /* 开始打字 = 意图是搜索：高亮交给第一条搜索结果（有剪贴板置顶行时往后挪一位）；
     清空输入则回到第一行（也就是剪贴板候选行）。 */
  const wasSearching = useRef(false);
  useEffect(() => {
    const searching = debounced.trim().length > 0;
    if (searching === wasSearching.current) return;
    wasSearching.current = searching;
    setSelected(searching && clip ? 1 : 0);
  }, [debounced, clip]);

  return (
    <MiniPalette
      open={open}
      docked={docked}
      scope={scope}
      programScanning={programs.scanning}
      programError={programs.error}
      query={query}
      onQueryChange={setQuery}
      hits={hits}
      selectedIndex={selected}
      onSelectIndex={setSelected}
      iconFor={(id) => icons[id] ?? null}
      teamUnavailable={!presentation.renderable && candidates.some((c) => c.source === '本机')}
      onTogglePin={(entryId) => togglePinnedEntry(entryId)}
      onClose={onClose}
      onOpen={(hit) => {
        // Enter 后立刻关闭面板，不等待打开结果
        onClose();
        if (hit.kind === 'system') {
          /* 系统程序直接开（用户拍板：未添加的程序也直接启动）。
             失败必须说出来——被卸载/没有权限时不能表现成"点了没反应"。 */
          void api.entries.openObject(hit.entry).then((r) => {
            if (!r.ok) {
              push({
                title: `没能打开「${hit.entry.name}」，可能已被卸载或没有权限`,
                tone: 'danger',
                duration: 6000,
              });
            }
          });
          return;
        }
        void openEntry(hit.entry);
      }}
      onAddToPersonal={(hit) => {
        /* 加为入口是**第二个动作**（Ctrl+回车 / 行尾按钮），和回车分开，避免误触编辑器。
           系统程序把 .lnk 路径交给既有识别流程：target/args 由主进程重新解析，
           与「粘贴快捷添加」走同一条落库链路。 */
        const text =
          hit.kind === 'system'
            ? hit.entry.type === 'app'
              ? (hit.entry.sourcePath ?? hit.entry.target)
              : ''
            : (clip?.text ?? '');
        if (text.length === 0) return;
        if (!docked) {
          // 主窗口内的浮层：本窗口就能渲染编辑器（外壳的 EntryEditDialogView），直接走本地流程
          onClose();
          void quickAddFromText(text);
          return;
        }
        // 独立面板窗口装不下编辑器：主进程收起面板、唤起并聚焦主窗口，由它跑同一套流程。
        void api.palette.quickAdd(text).then((ok) => {
          if (!ok) push({ title: '没能唤起主窗口，请手动打开 TeamLaunch 再试', tone: 'warn' });
        });
      }}
      /* Ctrl+M（2026-10-18 用户要求）：收起面板 → 主窗口拿到前台。面板在主窗口内是浮层，
         这时直接把浮层关掉即可（不需要跨窗口唤起）。 */
      onEnterMain={() => {
        if (!docked) {
          onClose();
          return;
        }
        void api.palette.openMain().then((ok) => {
          if (!ok) push({ title: '没能唤起主窗口，请手动打开 TeamLaunch 再试', tone: 'warn' });
        });
      }}
    />
  );
}
