/**
 * 发布变更摘要与校验（AC-06 / AC-07）。
 *
 * 两条硬要求：
 *  1. 摘要必须落到「具体哪个入口」，不能只给数量；
 *  2. 校验失败必须精确到字段原因，且不得清空草稿（由调用方保证）。
 */
import type { Entry } from '../../shared/schema/entry.ts';
import type { TeamConfig } from '../../shared/schema/config.ts';
import { TYPE_META } from './entry.ts';
import { canonicalJson } from '../../shared/canonical.ts';

export interface ChangeSet {
  added: Entry[];
  modified: Entry[];
  removed: Entry[];
}

const compact = (e: Entry): string =>
  JSON.stringify([
    e.id,
    e.type,
    e.name,
    e.sort,
    'target' in e ? e.target : null,
    'url' in e ? e.url : null,
    e.icon,
    e.keywords ?? null,
    e.description ?? null,
  ]);

export function diffTeamConfig(published: TeamConfig, draft: TeamConfig): ChangeSet {
  const prev = new Map(published.groups.flatMap((g) => g.entries).map((e) => [e.id, e]));
  const next = new Map(draft.groups.flatMap((g) => g.entries).map((e) => [e.id, e]));

  const added: Entry[] = [];
  const modified: Entry[] = [];
  const removed: Entry[] = [];

  for (const [id, e] of next) {
    const before = prev.get(id);
    if (!before) added.push(e);
    else if (compact(before) !== compact(e)) modified.push(e);
  }
  for (const [id, e] of prev) {
    if (!next.has(id)) removed.push(e);
  }

  // 公告纳入变更计数（2026-10-05 主页模块）：否则"只改公告"时变更数为 0，
  // 发布按钮永远禁用，公告发不出去。以一条合成的"主页公告"修改项呈现，
  // 发布对话框里可见；真正的发布载荷仍是完整草稿。
  if (canonicalJson(published.announcements ?? []) !== canonicalJson(draft.announcements ?? [])) {
    modified.push({
      id: '__announcements__',
      name: '主页公告',
      sort: 0,
      type: 'web',
      url: '',
      icon: { kind: 'fallback' },
      updatedAt: new Date(0).toISOString(),
    });
  }
  return { added, modified, removed };
}

export const changeLabel = (e: Entry): string => `${e.name || '未命名入口'}（${TYPE_META[e.type].label}）`;

export const changeCount = (c: ChangeSet): number => c.added.length + c.modified.length + c.removed.length;

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

export interface PublishIssue {
  entryId: string;
  entryName: string;
  field: '名称' | '目标路径' | '网址' | '关键词';
  reason: string;
}

const BLANK_NAME_MSG = '名称不能为空，请填写一个能认出它的名字';
const BLANK_TARGET_MSG = '目标路径为空，请选择本机上的文件或文件夹';
const BAD_URL_MSG = (url: string) => `${url} 不是有效的网址（示例：https:// 开头）`;

export function validateDraft(draft: TeamConfig): PublishIssue[] {
  const issues: PublishIssue[] = [];
  for (const e of draft.groups.flatMap((g) => g.entries)) {
    if (!e.name.trim()) {
      issues.push({
        entryId: e.id,
        entryName: '未命名入口',
        field: '名称',
        reason: BLANK_NAME_MSG,
      });
    }
    if (e.type === 'app' || e.type === 'folder') {
      if (!('target' in e) || !e.target.trim()) {
        issues.push({
          entryId: e.id,
          entryName: e.name || '未命名入口',
          field: '目标路径',
          reason: BLANK_TARGET_MSG,
        });
      }
    }
    if (e.type === 'web') {
      const ok = /^https?:\/\/[^\s]+\.[^\s]+/.test(e.url ?? '');
      if (!ok) {
        issues.push({
          entryId: e.id,
          entryName: e.name || '未命名入口',
          field: '网址',
          reason: BAD_URL_MSG(e.url || '(空)'),
        });
      }
    }
    const tooLong = (e.keywords ?? []).find((k) => k.length > 20);
    if (tooLong) {
      issues.push({
        entryId: e.id,
        entryName: e.name,
        field: '关键词',
        reason: `关键词「${tooLong}」超过 20 个字`,
      });
    }
  }
  return issues;
}
