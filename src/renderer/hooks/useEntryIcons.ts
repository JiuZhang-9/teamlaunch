/**
 * 入口图标的批量解析。
 *
 * 两条约束：
 *  - K-06：图标提取只在需要显示时发起，渲染期不做任何 stat / 文件预检查；
 *  - 缓存键 = 入口 id + 图标引用（2026-10-07）：换表情/重新定位后自动重新提取，
 *    不再吃旧缓存。表情图标在卡片上直接内联渲染，不经过本 hook。
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../bridge/index.ts';
import type { Entry, IconRef } from '../../shared/schema/entry.ts';

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

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
      // 只缓存成功值：失败（null）下次挂载重试。getFileIcon 对个别 exe 会瞬时失败，
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

export function useEntryIcons(entries: Entry[]): Record<string, string | null> {
  const [map, setMap] = useState<Record<string, string | null>>({});
  const items = useMemo(
    () => entries.map((e) => ({ entry: e, id: e.id, key: iconKey(e.id, e.icon) })),
    [entries],
  );
  const key = items.map((it) => it.key).join('|');

  useEffect(() => {
    let alive = true;
    const known: Record<string, string | null> = {};
    const todo: Array<{ entry: Entry; id: string; key: string }> = [];
    for (const it of items) {
      const hit = cache.get(it.key);
      if (hit === undefined) todo.push(it);
      else known[it.id] = hit;
    }
    if (todo.length === 0) {
      setMap(known);
      return;
    }
    Promise.all(todo.map((it) => resolve(it.entry, it.key))).then(() => {
      if (!alive) return;
      const next: Record<string, string | null> = { ...known };
      for (const it of todo) next[it.id] = cache.get(it.key) ?? null;
      setMap(next);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  return map;
}
