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
import { toWindowsPath } from './format.ts';

export type EntryTypeKey = Entry['type'];

interface TypeMeta {
  label: string;
  icon: LucideIcon;
  /** 容器 tint：软件刻意保持中性（真实应用图标自带颜色，叠 tint 会打架） */
  tint: string;
  /** 图标容器形状（2026-11-08 B）：app 圆角方块 / folder 带标签缺口 / web 带浏览器顶栏 */
  shape: EntryTypeKey;
  /** 类型识别边（卡片左缘 2px）；与 tint 分开，tint 太浅不能当线条 */
  accent: string;
  /** 类型水印基色（2026-11-08 G1）：面积大、10% 透明度，需要比 2px 识别边更亮/更有对比 */
  watermark: string;
}

export const TYPE_META: Record<EntryTypeKey, TypeMeta> = {
  app: { label: '桌面应用', icon: AppWindow, tint: 'var(--type-app-container)', shape: 'app', accent: 'var(--type-app-accent)', watermark: 'var(--type-app-watermark)' },
  folder: { label: '文件夹', icon: Folder, tint: 'var(--type-folder-tint)', shape: 'folder', accent: 'var(--type-folder-accent)', watermark: 'var(--type-folder-watermark)' },
  web: { label: '网页', icon: Globe, tint: 'var(--type-link-tint)', shape: 'web', accent: 'var(--type-web-accent)', watermark: 'var(--type-web-watermark)' },
};

/**
 * 类型标签的**选择语域**（编译器单选 / 批量识别结果标签 / 类型筛选）：口语化的「软件」。
 *
 * 与显示语域 `TYPE_META`（「桌面应用」，卡片角标与统计条用）并存——两个语域都是刻意的
 * （选项里说"软件"更顺口，标签上写全称更准确），但**字面量只能有这一处**：
 * 此前 EntryEditDialog / BatchAddDialogView / TypeFilterButton 各写了一份，改一处必漏两处。
 */
export const TYPE_CHOICE_LABEL: Record<EntryTypeKey, string> = {
  app: '软件',
  folder: '文件夹',
  web: '网页',
};

/** 原本/target/url 的可读摘要：卡片 Display 用。 */
/**
 * 路径尾（2026-11-08 A）：只露能区分的那一段。
 *
 * 旧实现显示完整路径、由 DOM 截尾，结果两张卡都只剩 `C:\Windows\S...`——
 * 类型一样、前缀一样，真正不同的文件名被截掉了。现在直接取最后一级；
 * 如果入口名本身就是最后一级（用户按文件夹名命名），则带上父级。
 */
function pathTail(rawPath: string, name: string): string {
  const normalized = toWindowsPath(rawPath).replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return normalized;
  const last = parts[parts.length - 1];
  const parent = parts.length >= 2 ? parts[parts.length - 2] : '';
  const sameAsName = last.toLowerCase() === name.trim().toLowerCase();
  return sameAsName && parent ? `${parent}\\${last}` : last;
}

/** 网页：域名 + 路径尾；同域名不同页面也能分开（查询串不参与，避免卡片噪声）。 */
function urlTail(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.host.replace(/^www\./i, '');
    const path = u.pathname.replace(/\/+$/, '');
    return path.length > 0 ? `${host}${path}` : host;
  } catch {
    return rawUrl;
  }
}

/** target/url 的可读摘要：卡片 Display 用（完整值仍在 title 里）。 */
export function targetSummary(entry: Entry): string {
  switch (entry.type) {
    case 'app':
    case 'folder':
      return pathTail(entry.target, entry.name);
    case 'web':
      return urlTail(entry.url);
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

/** 副标签 = 类型文字前缀 + 可区分的目标尾部。这是 AC-03 的第二通道。 */
export function subtitleOf(entry: Entry, opts: { withGroup?: string } = {}): string {
  const head = TYPE_META[entry.type].label;
  const tail = opts.withGroup ? ` · ${opts.withGroup}` : '';
  return `${head} · ${targetSummary(entry)}${tail}`;
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
