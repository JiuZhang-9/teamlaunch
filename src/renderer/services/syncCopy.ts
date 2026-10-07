/**
 * SyncIndicator / Banner 的「枚举 → 视觉」映射表。
 *
 * 【红线】本文档是 components/sync-indicator.md §2 的**代码化抄表**。
 *    UI 不得自行推导状态：不得因为 fetch 抛错就判离线，不得用本地时钟判版本先后，
 *    不得沿用上一轮状态。这里只有「状态键 → 图标 / 点形态 / 配色 / 文案」。
 */
import {
  CircleX,
  Cloud,
  CloudOff,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { OfflineReason, SyncSnapshot, SyncState } from '../bridge/types.ts';
import { formatStamp } from '../lib/format.ts';

export type DotKind = 'hollow' | 'static' | 'breathe';
export type ToneKey = 'neutral' | 'busy' | 'ok' | 'warn' | 'danger';

export interface SyncPresentation {
  icon: LucideIcon;
  dot: DotKind;
  tone: ToneKey;
  line1: string;
  line2: string | null;
  refreshEnabled: boolean;
  /** 内容区是否有可渲染的缓存卡片（OFFLINE_CACHED / SYNC_DATA_REJECTED 有缓存时为 true） */
  renderable: boolean;
}

const TONE_VAR: Record<ToneKey, { fg: string; dot: string }> = {
  neutral: { fg: 'var(--sync-fg-neutral)', dot: 'var(--sync-dot-neutral)' },
  busy: { fg: 'var(--sync-fg-busy)', dot: 'var(--sync-dot-busy)' },
  ok: { fg: 'var(--sync-fg-ok)', dot: 'var(--sync-dot-ok)' },
  warn: { fg: 'var(--sync-fg-warn)', dot: 'var(--sync-dot-warn)' },
  danger: { fg: 'var(--sync-fg-danger)', dot: 'var(--sync-dot-danger)' },
};

/** offlineReason → 第二行。四值视觉权重完全相同，均自带下一步动作。 */
export const REASON_LINE: Record<OfflineReason, string> = {
  SERVICE_NOT_FOUND: '管理员电脑未开机或未连接网络。稍后会自动重试，你也可以手动刷新。',
  NETWORK_UNREACHABLE: '这台电脑连不上内网。检查网络后会自动重试，你也可以手动刷新。',
  UNKNOWN: '暂时连不上管理员电脑，稍后会自动重试。你也可以先使用我的入口。',
  CONNECTION_BLOCKED: '连接被安全软件或网络策略拦截。可手动刷新，仍不行请联系管理员或 IT。',
};

/** 未识别的原因一律回落 UNKNOWN，UI 不认识的原因不得直接渲染。 */
export function reasonLineOf(reason: OfflineReason | null): string {
  return REASON_LINE[reason ?? 'UNKNOWN'] ?? REASON_LINE.UNKNOWN;
}

export const STATE_LABEL: Record<SyncState, string> = {
  NEVER_SYNCED: '尚未获取团队入口',
  SYNCING: '正在同步…',
  ONLINE_LATEST: '已同步',
  ONLINE_UPDATE_PENDING: '正在应用更新',
  OFFLINE_CACHED: '离线',
  OFFLINE_EMPTY: '暂时无法获取团队入口',
  SYNC_DATA_REJECTED: '更新未完成',
  SYNC_FAILED_UNKNOWN: '同步未完成',
};

export function syncPresentation(s: SyncSnapshot): SyncPresentation {
  const stamp = formatStamp(s.lastSyncedAt);
  switch (s.state) {
    case 'NEVER_SYNCED':
      return {
        icon: CloudOff,
        dot: 'hollow',
        tone: 'neutral',
        line1: '尚未获取团队入口',
        line2: null,
        refreshEnabled: true,
        renderable: false,
      };
    case 'SYNCING':
      return {
        icon: LoaderCircle,
        dot: 'breathe',
        tone: 'busy',
        line1: '正在同步…',
        line2: null,
        refreshEnabled: false,
        renderable: s.hasCache,
      };
    case 'ONLINE_LATEST':
      return {
        icon: Cloud,
        dot: 'static',
        tone: 'ok',
        // 管理员本机即权威源、还没发布过时 lastSyncedAt 为 null——
        // 此时只说"已同步"，不能拼出"已同步 · 从未成功同步"这种自相矛盾的句子。
        line1: s.lastSyncedAt ? `已同步 · ${stamp}` : '已同步',
        line2: null,
        refreshEnabled: true,
        renderable: true,
      };
    case 'ONLINE_UPDATE_PENDING':
      return {
        icon: RefreshCw,
        dot: 'breathe',
        tone: 'busy',
        line1: `正在应用更新 v${s.revision ?? '—'}…`,
        line2: null,
        refreshEnabled: false,
        renderable: true,
      };
    case 'OFFLINE_CACHED':
      return {
        icon: CloudOff,
        dot: 'breathe',
        tone: 'warn',
        line1: `离线 · 数据时间 ${stamp}`,
        line2: reasonLineOf(s.offlineReason),
        refreshEnabled: true,
        renderable: true,
      };
    case 'OFFLINE_EMPTY':
      return {
        icon: CloudOff,
        dot: 'breathe',
        tone: 'warn',
        line1: '暂时无法获取团队入口',
        line2: reasonLineOf(s.offlineReason),
        refreshEnabled: true,
        renderable: false,
      };
    case 'SYNC_DATA_REJECTED':
      return {
        icon: TriangleAlert,
        dot: 'breathe',
        tone: 'warn',
        line1: s.hasCache ? `更新未完成 · 仍使用 ${stamp} 的数据` : '更新未完成',
        line2: s.hasCache
          ? '返回数据校验失败，仍使用上一版本。你可以手动刷新再试。'
          : '返回数据校验失败。你可以手动刷新再试。',
        refreshEnabled: true,
        renderable: s.hasCache,
      };
    case 'SYNC_FAILED_UNKNOWN':
      return {
        icon: CircleX,
        dot: 'breathe',
        tone: 'danger',
        line1: `同步未完成 · 数据时间 ${stamp}`,
        line2: reasonLineOf(s.offlineReason),
        refreshEnabled: true,
        renderable: s.hasCache,
      };
  }
}

export function toneVars(tone: ToneKey): { fg: string; dot: string } {
  return TONE_VAR[tone];
}
