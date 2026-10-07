/**
 * src/repositories/paths.ts —— 存储根下的全部路径常量
 *
 * 存储根目录由调用方注入（Electron 侧传 app.getPath('userData')），
 * 本文件因此不 import electron —— 这是 src/server/** 可独立拉起的前提（T8）。
 *
 * 布局对齐 ADR-005 §文件布局。
 */

import { join } from 'node:path';

export interface StoragePaths {
  /** 存储根。 */
  root: string;
  settings: string;
  identity: string;
  /** 仅管理员：scrypt 参数与 verifier。 */
  credential: string;
  /** 服务身份：serviceId + instanceId（团队数据源标识）。 */
  service: string;
  /** 团队配置。员工端是缓存，管理员端是权威源。 */
  teamCurrent: string;
  /**
   * 员工端缓存**配套元数据**：目前只有服务端下发的 ETag。
   *
   * 为什么不把 ETag 塞进 team-current.json：那份文件的格式是 `TeamConfigSchema`
   * （管理员端也按这个格式读写），多一个字段会被校验静默剥掉，等于"存了又没了"。
   * ETag 是服务端签发的强校验器，只能原样存、原样回，绝不许本地拼（backend-2 契约第 3 条）。
   */
  teamMeta: string;
  /** 员工端待发送反馈队列（ADR-005：outbox/feedback.jsonl，≤200 条 / 30 天）。 */
  feedbackOutbox: string;
  personal: string;
  revisionsDir: string;
  revisionIndex: string;
  assetsDir: string;
  /** 服务端收到的失效反馈。 */
  feedbackFile: string;
  /** 服务端遥测聚合（只含匿名设备 ID 去重集合与计数）。 */
  telemetryDir: string;
  telemetryAggregate: string;
  /** 客户端侧发现缓存：上次成功的端点与上次网段扫描时间。 */
  discovery: string;
  logsDir: string;
}

export function resolvePaths(root: string): StoragePaths {
  const revisionsDir = join(root, 'revisions');
  const assetsDir = join(root, 'assets');
  const telemetryDir = join(root, 'telemetry');
  return {
    root,
    settings: join(root, 'settings.json'),
    identity: join(root, 'identity.json'),
    credential: join(root, 'credential.json'),
    service: join(root, 'service.json'),
    teamCurrent: join(root, 'cache', 'team-current.json'),
    teamMeta: join(root, 'cache', 'team-meta.json'),
    feedbackOutbox: join(root, 'outbox', 'feedback.jsonl'),
    personal: join(root, 'config', 'personal.json'),
    revisionsDir,
    revisionIndex: join(revisionsDir, 'index.jsonl'),
    assetsDir,
    feedbackFile: join(root, 'feedback', 'received.jsonl'),
    telemetryDir,
    telemetryAggregate: join(telemetryDir, 'aggregate.json'),
    discovery: join(root, 'discovery.json'),
    logsDir: join(root, 'logs'),
  };
}

/** 快照文件名：固定 9 位零填充，保证字典序等于版本序（滚动清理依赖这一点）。 */
export function revisionSnapshotName(revision: number): string {
  return `${String(revision).padStart(9, '0')}.json`;
}

export function revisionSnapshotPath(paths: StoragePaths, revision: number): string {
  return join(paths.revisionsDir, revisionSnapshotName(revision));
}

const DIRECTORIES = [
  'cache',
  'config',
  'revisions',
  'assets',
  'feedback',
  'outbox',
  'telemetry',
  'logs',
] as const;

/** 首次运行建目录。全部异步（K-05：禁止一切 *Sync IO）。 */
export async function ensureDirectories(paths: StoragePaths): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(paths.root, { recursive: true });
  for (const dir of DIRECTORIES) {
    await mkdir(join(paths.root, dir), { recursive: true });
  }
}
