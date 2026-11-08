/**
 * 本机图标提取（icon.kind=local 与 emoji）。
 *
 * K-06：渲染期禁止对 target 做存在性预检查 —— 这里只在卡片进入视野后**按需**请求图标，
 * 且结果进内存缓存，不会在首屏对 200 个入口发起任何 IO。
 * 缓存键 = 入口 id + 图标引用：换表情/重新定位后自动重新提取，不再吃旧缓存。
 * 请求直传入口对象（2026-10-07）：团队入口的编辑草稿/未发布改动主进程按 id 反查
 * 不到（只认已发布配置与个人落盘），按 id 请求会拿到旧图标——团队入口换图标
 * 永远"不生效"、草稿新建入口没图标，根因都在这。表情图标不走本 hook（卡片内联渲染）。
 */
import { useEffect, useState } from 'react';
import { api } from '../bridge/index.ts';
import type { Entry } from '../../shared/schema/entry.ts';

const cache = new Map<string, string | null>();

function iconKey(entry: Entry): string {
  if (entry.icon.kind === 'emoji' && entry.icon.char) return `${entry.id}:emoji:${entry.icon.char}`;
  /* 网页的图标取决于 URL（favicon 按站点取）：换网址必须换缓存键，否则永远吃旧图。 */
  if (entry.type === 'web') return `${entry.id}:web:${entry.url}`;
  return entry.id;
}

/**
 * 这张卡是否需要向主进程要图标：
 *  - local：本机 exe/lnk 提取；
 *  - web（非表情）：主进程按 URL 尝试 favicon，取不到回退首字方块；
 *  - emoji：卡片内联渲染，不走 IO。
 */
export function wantsEntryIcon(entry: Entry): boolean {
  if (entry.icon.kind === 'emoji') return false;
  if (entry.type === 'web') return true;
  return entry.icon.kind === 'local';
}

export function useEntryIcon(entry: Entry, enabled = true): string | null {
  const key = iconKey(entry);
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!enabled) return;
    if (cache.has(key)) {
      setUrl(cache.get(key) ?? null);
      return;
    }
    let alive = true;
    void api.entries.icon(entry).then((u) => {
      // 只缓存成功值：失败（null）不缓存，下次挂载重试（首次提取可能瞬时失败）。
      if (u) cache.set(key, u);
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [key, enabled, entry]);

  return url;
}
