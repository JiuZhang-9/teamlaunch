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
      sourcePath: id.sourcePath, args: id.args ?? '', cwd: '', expandEnv: true,
      sort: 0, description: null, icon: { kind: 'local' }, iconAssetHash: null, updatedAt: now,
    };
  }
  return {
    id: 'clipboard-candidate', name: id.name, type: 'folder', target: id.target,
    sort: 0, description: null, icon: { kind: 'local' }, iconAssetHash: null, updatedAt: now,
  };
}

export function MiniPaletteView({ open, onClose, docked = false }: { open: boolean; onClose(): void; docked?: boolean }) {
  const { snapshot } = useSync();
  const { config: personal } = usePersonal();
  const { openEntry, quickAddFromText } = useWorkbench();
  const { push } = useToasts();
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
  }, [open]);

  const hits = useMemo<PaletteHit[]>(() => {
    const q = debounced.trim();
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
    return [...pinned, ...rows];
  }, [candidates, items, clip, debounced, pinnedIds, recentIds]);

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
        void openEntry(hit.entry);
      }}
      onAddToPersonal={() => {
        /* 加为入口是**第二个动作**（Ctrl+回车 / 行尾按钮），和回车分开，避免误触编辑器。 */
        const text = clip?.text ?? '';
        if (text.length === 0) return;
        if (!docked) {
          // 主窗口内的浮层：本窗口就能渲染编辑器（外壳的 EntryEditDialogView），直接走本地流程
          onClose();
          void quickAddFromText(text);
          return;
        }        // 独立面板窗口装不下编辑器：主进程收起面板、唤起并聚焦主窗口，由它跑同一套流程。
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
