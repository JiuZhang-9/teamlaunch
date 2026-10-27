/**
 * 本机程序索引在渲染层的使用层（2026-10-24）。
 *
 * 两件事：
 *  1. `usePrograms` 订阅主进程推来的索引快照（preload 已缓存，首帧即可用）；
 *  2. 把一条索引记录合成**临时 Entry**——打开走既有 `entries.openObject`，
 *     图标走既有 `entries.icon`，不必为系统程序另造一套打开/取图链路。
 *
 * 合成的 Entry 不落库、不进最近打开、不参与同步；用户按 Ctrl+回车添加时，
 * 走的是既有「粘贴快捷添加」流程（把 .lnk 路径交给 identify 重新解析）。
 */
import { useEffect, useState } from 'react';
import type { Entry } from '../../shared/schema/entry.ts';
import type { ProgramIndexSnapshot, ProgramItem } from '../../shared/schema/programs.ts';
import { api } from '../bridge/index.ts';

export function usePrograms(): ProgramIndexSnapshot {
  const [snapshot, setSnapshot] = useState<ProgramIndexSnapshot>(() => api.programs.snapshot());
  useEffect(() => api.programs.subscribe(setSnapshot), []);
  return snapshot;
}

/** 索引记录 → 可直接交给 openObject / icon 的临时入口。 */
export function systemEntry(item: ProgramItem, scannedAt: string | null): Entry {
  return {
    id: item.id,
    name: item.name,
    type: 'app',
    target: item.target,
    sourcePath: item.sourcePath,
    args: item.args,
    cwd: item.cwd,
    expandEnv: true,
    sort: 0,
    description: null,
    icon: { kind: 'local' },
    iconAssetHash: null,
    updatedAt: scannedAt ?? new Date().toISOString(),
  };
}

/** 结果行副标题：来源 + exe 名（完整路径太长，面板只有 560px）。 */
export function programSubtitle(item: ProgramItem): string {
  const exe = item.target.replace(/^.*[\\/]/, '');
  return `${item.source} · ${exe}`;
}
