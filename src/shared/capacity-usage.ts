/**
 * src/shared/capacity-usage.ts —— 容量占用的唯一统计口径
 *
 * 为什么必须是 shared 的：个人入口（渲染层「还可添加几个」、服务端导入闸）
 * 与团队配置（`PUT /config` 的 413 闸）数的是同一件事。统计口径一旦有两份，
 * 就会出现"界面说还剩 5 个、提交时报超了"——用户只会觉得软件在骗人，
 * 而且他没有任何办法自己核对到底哪个是对的。
 *
 * 为什么从 `services/capacity.service.ts` 挪出来：
 * `src/shared/**` 只能向下依赖 schema，不能反向依赖 services。
 * 否则渲染层为了拿一个计数函数就得把服务层拖进浏览器包里，
 * 而"渲染层不得依赖主进程服务层"是这条链路的前提。
 *
 * 本文件不 import electron、不落盘、不读时钟（守卫覆盖 src/shared）。
 */

import { CAPACITY } from './schema/common.ts';

export interface CapacityUsage {
  groups: number;
  entries: number;
}

/**
 * 从解析后的对象上统计占用。groups 缺失按 0 处理，由 schema 去报错——
 * 这里不重复报"结构不对"，否则同一个错误会在两处各说一遍且措辞不同。
 */
export function measure(config: unknown): CapacityUsage {
  if (config === null || typeof config !== 'object') return { groups: 0, entries: 0 };
  const groups = (config as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return { groups: 0, entries: 0 };
  let entries = 0;
  for (const group of groups) {
    const list = (group as { entries?: unknown })?.entries;
    if (Array.isArray(list)) entries += list.length;
  }
  return { groups: groups.length, entries };
}

/**
 * 是否在上限内。**全项目只有这一处比较**。
 *
 * 把 `>` 写散到每一处闸门，就会出现"预览放行了、提交才被拦"（或反过来），
 * 而这两处任一出错用户都察觉不到——他看不见内部有两次判断。
 */
export function withinCapacity(usage: CapacityUsage): boolean {
  return usage.groups <= CAPACITY.MAX_GROUPS && usage.entries <= CAPACITY.MAX_ENTRIES;
}
