/**
 * 最近打开 —— 本机记忆（localStorage），面板空查询时的「最近打开」列表。
 *
 * 2026-11-18 扩展：不再只记入口 id，而是记"通过 TeamLaunch 打开成功"的任何对象——
 * 入口（仍只存 id，重命名跟随）、本机程序、文件夹、网页、整条连锁（一条记录，不拆步骤）。
 * 未加入入口的直接项只用于最近打开显示，**永不写入 personal.json / 团队配置**。
 *
 * 三条口径：
 *  - **独立快捷区**：不改任何入口的官方排序，只影响面板空查询时先显示什么；
 *  - 只记这台机器的（不参与同步）；上限 20 条、同目标去重、最新在前；
 *  - 开关 recentIncludeUnlisted 关闭时：入口记录照记，直接项/连锁不再新增且不显示
 *    （已存记录保留，重新开启后恢复）。
 *
 * 注意：Chromium 对 localStorage 的落盘有延迟（实测数秒），
 * 强杀进程可能丢掉最后一次记录——这只是少一条"最近打开"，不影响别的功能。
 */
import { useEffect, useState } from 'react';
import { api } from '../bridge/index.ts';
import type { Entry } from '../../shared/schema/entry.ts';
import { CAPACITY } from '../../shared/schema/common.ts';
import { defaultWebName } from '../../shared/web-name.ts';
import {
  RECENT_LIMIT,
  directRecentInput,
  makeRecent,
  parseRecentRecords,
  recentKey,
  renameRecentTitle,
  upsertRecent,
  type RecentInput,
  type RecentRecord,
} from '../../shared/recent.ts';
import { readMemoryString, subscribeMemory, writeMemoryString } from './localMemory.ts';

const KEY = 'recentOpens';

function readAll(): RecentRecord[] {
  return parseRecentRecords(readMemoryString(KEY));
}

function writeAll(list: RecentRecord[]): void {
  writeMemoryString(KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
}

function pushInput(input: RecentInput): void {
  writeAll(upsertRecent(readAll(), makeRecent(input)));
}

/** 真实入口打开成功：只记 id，显示时按当前清单解析（重命名跟随、删除即消失）。 */
export function recordEntryOpen(entryId: string): void {
  if (entryId.length === 0) return;
  pushInput({ kind: 'entry', entryId });
}

/**
 * 未加入入口的直接项打开成功：程序 / 文件夹 / 网页。
 * 开关关闭时不再新增（已存记录保留，展示层也会过滤）。
 */
export function recordDirectOpen(entry: Entry, enabled: boolean): void {
  if (!enabled) return;
  const input = directRecentInput(entry);
  if (input === null) return;
  pushInput(input);

  /* 网页标题与"添加入口"同一逻辑：只在名称还是域名默认值时取一次标题；
     失败静默保持域名（不打扰打开本身）。取到后按 key 回写，不覆盖后来解析出的入口名。 */
  if (input.kind !== 'web') return;
  const host = defaultWebName(input.url);
  if (host === null) return;
  if (input.name !== host.slice(0, CAPACITY.MAX_NAME_LEN)) return;
  const key = recentKey(makeRecent(input));
  void api.entries
    .pageTitle(input.url)
    .then((title) => {
      if (title === null) return;
      const current = readAll();
      if (!current.some((r) => r.kind === 'web' && recentKey(r) === key)) return;
      writeAll(renameRecentTitle(current, key, title));
    })
    .catch(() => undefined);
}

/** 已保存连锁启动：整条只记一条，不把每一步塞进最近打开。 */
export function recordChainOpen(chainId: string, enabled: boolean): void {
  if (!enabled || chainId.length === 0) return;
  pushInput({ kind: 'chain', chainId });
}

/** 最近打开的可订阅视图：主窗口写入、面板窗口展示，跨窗口立即更新。 */
export function useRecentOpens(): RecentRecord[] {
  const [records, setRecords] = useState<RecentRecord[]>(readAll);
  useEffect(() => subscribeMemory(KEY, () => setRecords(readAll())), []);
  return records;
}
