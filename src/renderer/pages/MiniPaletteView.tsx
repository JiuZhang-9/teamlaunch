/**
 * V-03 迷你唤起面板的视图层：本机内存索引 + 120ms 防抖 + 键盘导航。
 *
 * 本视图 **100% 本地**，不发起任何网络请求；出现"正在同步"字样即为实现错误。
 * 结果排序与 V-04 同一套：名称前缀 > 关键词 > 分组名 > 路径末级/域名。
 */
import { useEffect, useMemo, useState } from 'react';
import { MiniPalette, type PaletteHit } from '../components/organisms/MiniPalette.tsx';
import { useEntryIcons } from '../hooks/useEntryIcons.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { matches, subtitleOf, targetSummary } from '../lib/entry.ts';
import { usePersonal } from '../store/personalStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { syncPresentation } from '../services/syncCopy.ts';
import type { Entry } from '../../shared/schema/entry.ts';

interface Candidate {
  entry: Entry;
  groupName: string;
  source: '团队' | '本机';
}

const MAX_ROWS = 7;

export function MiniPaletteView({ open, onClose, docked = false }: { open: boolean; onClose(): void; docked?: boolean }) {
  const { snapshot } = useSync();
  const { config: personal } = usePersonal();
  const { openEntry } = useWorkbench();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const debounced = useDebouncedValue(query, 120);

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
  const icons = useEntryIcons(items);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelected(0);
    }
  }, [open]);

  const hits = useMemo<PaletteHit[]>(() => {
    const q = debounced.trim();
    const scored = candidates
      .map((c) => ({ c, score: matches(c.entry, c.groupName, q) }))
      .filter((x) => x.score > 0);
    if (q.length === 0) {
      // 空查询 = 最近打开（演示取前 7 条，真实实现按最近打开时间）
      return candidates.slice(0, MAX_ROWS).map((c) => ({
        entry: c.entry,
        subtitle: subtitleOf(c.entry),
        source: c.source,
      }));
    }
    scored.sort((a, b) => b.score - a.score || (a.c.source === '团队' ? -1 : 1));
    return scored.slice(0, MAX_ROWS).map((x) => ({
      entry: x.c.entry,
      subtitle: `${targetSummary(x.c.entry)} · ${x.c.groupName}`,
      source: x.c.source,
    }));
  }, [candidates, debounced]);

  useEffect(() => {
    if (selected > hits.length - 1) setSelected(0);
  }, [hits.length, selected]);

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
      onClose={onClose}
      onOpen={(hit) => {
        // Enter 后立刻关闭面板，不等待打开结果
        onClose();
        void openEntry(hit.entry);
      }}
    />
  );
}
