/**
 * src/repositories/team-config.repository.ts —— 团队配置的读写
 *
 * 员工端：这份文件是缓存（只读）。管理员端：它是权威源。
 * 落盘一律原子替换（ADR-005），任何中断都不留半截 JSON。
 *
 * 读取失败的处理是刻意设计的：不抛错、返回 `corrupt: true`，
 * 由上层决定降级（诊断项 DATA_INTEGRITY 会因此报红）。
 * 抛错会让服务起不来——而管理员此时最需要的恰恰是能起来、能看诊断页。
 */

import { TeamConfigSchema } from '../shared/schema/config.ts';
import type { TeamConfig } from '../shared/schema/config.ts';
import { readTextFile, writeJsonAtomic } from './atomic-json.ts';
import type { StoragePaths } from './paths.ts';

export interface LoadedTeamConfig {
  config: TeamConfig | null;
  /** 文件存在但解析/校验失败。此时 config 为 null，绝不是"空配置"。 */
  corrupt: boolean;
  reason?: string;
}

export class TeamConfigRepository {
  constructor(private readonly paths: StoragePaths) {}

  async load(): Promise<LoadedTeamConfig> {
    const text = await readTextFile(this.paths.teamCurrent);
    if (text === null) return { config: null, corrupt: false };
    try {
      const parsed = TeamConfigSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        return { config: null, corrupt: true, reason: 'schema 校验未通过' };
      }
      return { config: parsed.data, corrupt: false };
    } catch {
      return { config: null, corrupt: true, reason: '不是合法 JSON' };
    }
  }

  async save(config: TeamConfig): Promise<void> {
    await writeJsonAtomic(this.paths.teamCurrent, config);
  }
}
