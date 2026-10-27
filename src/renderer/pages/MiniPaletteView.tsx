/**
 * V-03 迷你唤起面板的视图层：本机内存索引 + 120ms 防抖 + 键盘导航 + 剪贴板候选行。
 *
 * 本视图 **100% 本地**，不发起任何网络请求；出现"正在同步"字样即为实现错误。
 * 结果排序与 V-04 同一套：名称前缀 > 关键词 > 分组名 > 路径末级/域名。
 *
 * 空查询时自上而下：
 *   ① 剪贴板候选行（唤起时读一次剪贴板；**只认整段就是一个网址/路径的单条内容**）
 *   ② 固定行（用户手动钉住）
 *   ③ 最近打开（真实记录，最多 6 条；没有记录时回退清单前几条）
 *   ④ 清单为空 → 不给列表，只给一句"去哪里添加"的提示（S12）
 *
 * 1.4.0：候选构造/打分/去重全部搬进 `lib/palette-source.ts`，与主窗口搜索共用。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../bridge/index.ts';
import { MiniPalette } from '../components/organisms/MiniPalette.tsx';
import { useEntryIcons } from '../hooks/useEntryIcons.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import {
  MAX_PROGRAM_ROWS,
  MAX_PROGRAM_SCOPE_ROWS,
  buildCandidates,
  buildHits,
  buildProgramHits,
  readClipboardCandidate,
  type ClipboardCandidate,
} from '../lib/palette-source.ts';
import { usePrograms } from '../lib/programs.ts';
import { useRecentOpenIds } from '../lib/recentOpens.ts';
import { togglePinnedEntry, usePinnedEntryIds } from '../lib/pinnedEntries.ts';
import { usePersonal } from '../store/personalStore.tsx';
import { useSync } from '../store/syncStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { syncPresentation } from '../services/syncCopy.ts';

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
  const [clip, setClip] = useState<ClipboardCandidate | null>(null);
  const debounced = useDebouncedValue(query, 120);
  /** 固定与最近打开都是本机记忆：面板开着时被主窗口更新，也要立刻跟着变。 */
  const pinnedIds = usePinnedEntryIds();
  const recentIds = useRecentOpenIds();

  const presentation = syncPresentation(snapshot);
  const teamGroups = presentation.renderable ? (snapshot.config?.groups ?? []) : [];

  const candidates = useMemo(() => buildCandidates(teamGroups, personal.groups), [teamGroups, personal.groups]);

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
    void readClipboardCandidate().then((c) => {
      if (!cancelled) setClip(c);
    });
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  /** 本机程序结果：**不按"已添加入口"预先过滤**（入口搜索不支持拼音，过滤后会什么都搜不到）。 */
  const programHits = useMemo(
    () => buildProgramHits(programs, debounced, scope === 'programs' ? MAX_PROGRAM_SCOPE_ROWS : MAX_PROGRAM_ROWS),
    [programs, debounced, scope],
  );

  const hits = useMemo(
    () => buildHits({ candidates, clip, query: debounced, pinnedIds, recentIds, programHits, scope }),
    [candidates, clip, debounced, pinnedIds, recentIds, programHits, scope],
  );

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
