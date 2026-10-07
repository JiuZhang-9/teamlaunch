/**
 * 入口（Entry）的显示层派生 —— 类型文字 / 副标签 / 图标 / 失效文案。
 *
 * AC-03 要求「类型图标 + 类型文字」双重通道：本文件是所有类型文字的唯一出处，
 * 任何页面都不得另写一份"桌面应用/文件夹/网页"。
 */
import {
  AppWindow,
  Folder,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import type { Entry } from '../../shared/schema/entry.ts';
import type { OpenFailure } from '../bridge/types.ts';
import { hostnameOf, toWindowsPath } from './format.ts';

export type EntryTypeKey = Entry['type'];

interface TypeMeta {
  label: string;
  icon: LucideIcon;
  /** 容器 tint：软件刻意保持中性（真实应用图标自带颜色，叠 tint 会打架） */
  tint: string;
}

export const TYPE_META: Record<EntryTypeKey, TypeMeta> = {
  app: { label: '桌面应用', icon: AppWindow, tint: 'var(--type-app-container)' },
  folder: { label: '文件夹', icon: Folder, tint: 'var(--type-folder-tint)' },
  web: { label: '网页', icon: Globe, tint: 'var(--type-link-tint)' },
};

/** 原本/target/url 的可读摘要：卡片 Display 用。 */
export function targetSummary(entry: Entry): string {
  switch (entry.type) {
    case 'app':
      return toWindowsPath(entry.target);
    case 'folder':
      return toWindowsPath(entry.target);
    case 'web':
      return hostnameOf(entry.url);
  }
}

export function targetFull(entry: Entry): string {
  switch (entry.type) {
    case 'app':
    case 'folder':
      return toWindowsPath(entry.target);
    case 'web':
      return entry.url;
  }
}

/** 使用痕迹（今天用过 / 3 天前）—— 只对软件派有意义的副信息。 */
const USAGE: Record<string, string> = {
  'e-wxwork': '今天用过',
  'e-feishu': '3 天前',
  'e-review': '上周用过',
  'e-prototype': '本月用过',
  'p-snipaste': '今天用过',
};

/** 副标签 = 类型文字前缀 + 内容。这是 AC-03 的第二通道。 */
export function subtitleOf(entry: Entry, opts: { withGroup?: string } = {}): string {
  const head = TYPE_META[entry.type].label;
  const body =
    entry.type === 'app'
      ? USAGE[entry.id] ?? targetSummary(entry)
      : targetSummary(entry);
  const tail = opts.withGroup ? ` · ${opts.withGroup}` : '';
  return `${head} · ${body}${tail}`;
}

/** 失效副标签（AC-12）。三句文案由规格锁定，不外推；UNKNOWN 必须说实话而不是套类型文案。 */
const FAILURE_SUBTITLE: Record<EntryTypeKey, string> = {
  app: '本机未找到该软件',
  folder: '文件夹不存在或当前无权限',
  web: '链接格式无效',
};

export function failureSubtitleOf(entry: Entry, failure?: OpenFailure): string {
  // UNKNOWN = 连目标都没解析到（比如入口刚被移除/草稿已失效），
  // 此时说"本机未找到该软件"是在编造一个本可避免的误导结论。
  if (failure === 'UNKNOWN') return '该入口当前无法打开';
  return FAILURE_SUBTITLE[entry.type];
}

/** 打开失败的人话解释（Toast 第二行，员工可见；禁止端口/IP/错误码）。 */
export const FAILURE_DETAIL: Record<OpenFailure, string> = {
  NOT_INSTALLED: '这台电脑上没装这个软件，或安装位置已经变了。',
  PATH_MISSING: '文件夹不在原来的位置，可能是共享盘没连上。',
  NO_PERMISSION: '当前账号没有打开这个位置的权限。',
  INVALID_URL: '链接格式不对，发不了到浏览器。',
  LINK_UNAVAILABLE: '网页暂时打不开，可能是内网没连上。',
  UNKNOWN: '没能打开目标，原因还不确定。',
};

/** 搜索匹配字段：标题 / 关键词 / 分组名 / 路径末级或域名（P0-06）。 */
export function matches(entry: Entry, groupName: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = entry.name.toLowerCase();
  if (name.startsWith(q)) return 4;
  if (name.includes(q)) return 3;
  if ((entry.keywords ?? []).some((k) => k.toLowerCase().includes(q))) return 3;
  if (groupName.toLowerCase().includes(q)) return 2;
  const tail = targetSummary(entry).toLowerCase();
  if (tail.includes(q)) return 1;
  return 0;
}

export function firstLetterOf(name: string): string {
  const ch = name.trim().charAt(0);
  return ch || '?';
}
