/**
 * 入口图标的批量解析。
 *
 * 两条约束：
 *  - K-06：图标提取只在需要显示时发起，渲染期不做任何 stat / 文件预检查；
 *  - 缓存键 = 入口 id + 图标引用（2026-10-07）：换表情/重新定位后自动重新提取，
 *    不再吃旧缓存。表情图标在卡片上直接内联渲染，不经过本 hook。
 *
 * 2026-10-21（用户反馈"快捷搜索栏一些图标显示没了，主窗口正常"）：
 *  - **限并发 4**：面板一次要给整份清单取图标，几百条并发把主进程的 shell 图标链打满，
 *    部分请求超时→ null，且本 hook 此前不会重试，于是一整次会话里都缺图标；
 *  - **失败重试**：首轮失败的隔 600ms 再试一次（主进程只缓存成功值，重试是真重取）；
 *  - **enabled**：面板窗口是常驻预热的，关着的时候不必替整份清单预取。
 *    打开时再取，主进程已有结果缓存的条目立刻返回。
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../bridge/index.ts';
import type { Entry, IconRef } from '../../shared/schema/entry.ts';

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

/** 一次同时取几个图标：大于 4 反而更容易让 shell 侧超时。 */
const CONCURRENCY = 4;
/** 失败的条目等多久再试一次（首轮失败多半是瞬时/拥塞，不是路径不存在）。 */
const RETRY_DELAY_MS = 600;

function iconKey(id: string, icon?: IconRef): string {
  return icon && icon.kind === 'emoji' && icon.char ? `${id}:emoji:${icon.char}` : id;
}

function resolve(entry: Entry, key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = api.entries
    .icon(entry)
    .then((url) => {
      // 只缓存成功值：失败（null）下次重试。getFileIcon 对个别 exe 会瞬时失败，
      // 永久缓存 null 会让卡片永远停在字母占位——"图标丑"的主因。
      if (url) cache.set(key, url);
      inflight.delete(key);
      return url;
    })
    .catch(() => {
      inflight.delete(key);
      return null;
    });
  inflight.set(key, task);
  return task;
}

interface Item {
  entry: Entry;
  id: string;
  key: string;
}

/** 限并发的取图标：每取到一个就回调（界面不必等整批）。返回失败清单。 */
async function resolveAll(items: Item[], onOne: (id: string, url: string) => void, alive: () => boolean): Promise<Item[]> {
  const queue = [...items];
  const failed: Item[] = [];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const it = queue.shift();
        if (!it) return;
        const url = await resolve(it.entry, it.key);
        if (!alive()) return;
        if (url) onOne(it.id, url);
        else failed.push(it);
      }
    }),
  );
  return failed;
}

export function useEntryIcons(entries: Entry[], enabled = true): Record<string, string | null> {
  const [map, setMap] = useState<Record<string, string | null>>({});
  const items = useMemo(
    () => entries.map((e) => ({ entry: e, id: e.id, key: iconKey(e.id, e.icon) })),
    [entries],
  );
  const key = items.map((it) => it.key).join('|');

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const isAlive = () => alive;
    const known: Record<string, string | null> = {};
    const todo: Item[] = [];
    for (const it of items) {
      const hit = cache.get(it.key);
      if (hit === undefined) todo.push(it);
      else known[it.id] = hit;
    }
    setMap(known);
    if (todo.length === 0) return;

    // 取到一个就先画一个：面板打开时用户能马上看到已解析的图标，而不是整批等完。
    const onOne = (id: string, url: string) => {
      setMap((prev) => ({ ...prev, [id]: url }));
    };

    void (async () => {
      const failed = await resolveAll(todo, onOne, isAlive);
      if (!alive || failed.length === 0) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, RETRY_DELAY_MS));
      if (!alive) return;
      const stillFailed = await resolveAll(failed, onOne, isAlive);
      if (!alive) return;
      // 两轮都失败：如实落到"没有图标"（调用方显示类型字形/首字母），下次挂载仍会重试。
      if (stillFailed.length > 0) {
        setMap((prev) => {
          const next = { ...prev };
          for (const it of stillFailed) next[it.id] = cache.get(it.key) ?? null;
          return next;
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [key, enabled]);

  return map;
}
