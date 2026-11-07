/**
 * src/repositories/personal.repository.ts —— personal.json（个人入口，本机独占）
 *
 * 与团队配置的两点根本差异，决定了这里的形状：
 *   1. **永不进网**：个人入口不出现在任何发布版本、不进管理员历史、不出现在别的设备上
 *      （PRD AC-14）。因此它不需要 revision / contentHash / ETag 那套同步语义。
 *   2. **损坏时不许自愈式覆盖**：文件坏了就如实上报，由用户决定是修文件还是导入备份。
 *      悄悄写成空配置 = 把"数据坏了"变成"数据没了"，是最坏的一种静默事故。
 *
 * 字段默认值一律由 `PersonalConfigSchema` 驱动，本文件不写第二份（两处写必分叉）。
 */

import { PersonalConfigSchema } from '../shared/schema/local.ts';
import type { PersonalConfig } from '../shared/schema/local.ts';
import { readTextFile, writeJsonAtomic } from './atomic-json.ts';
import type { StoragePaths } from './paths.ts';

export interface LoadedPersonalConfig {
  config: PersonalConfig | null;
  /** 文件存在但解析/校验失败。此时 config 为 null，绝不是"空配置"。 */
  corrupt: boolean;
  reason?: string;
}

/**
 * 一次性改名（2026-11-07 用户要求：「我的入口」→「个人入口」）。
 *
 * 只改**第一个**旧名分组，且仅当还不存在新名分组时才动：
 * 老用户升级后侧栏不会突然出现两个「个人入口」，用户自己起的同名分组也不会被连带改掉。
 * 纯改名，不动 id / 入口 / 顺序；写盘失败就按原文返回（下次启动再试），绝不覆盖用户数据。
 */
const LEGACY_GROUP_NAME = '我的入口';
const DEFAULT_GROUP_NAME = '个人入口';

function migrateGroupName(config: PersonalConfig): PersonalConfig {
  if (config.groups.some((group) => group.name === DEFAULT_GROUP_NAME)) return config;
  const index = config.groups.findIndex((group) => group.name === LEGACY_GROUP_NAME);
  if (index < 0) return config;
  return {
    ...config,
    groups: config.groups.map((group, i) => (i === index ? { ...group, name: DEFAULT_GROUP_NAME } : group)),
  };
}

export class PersonalRepository {
  constructor(private readonly paths: StoragePaths) {}

  async load(): Promise<LoadedPersonalConfig> {
    const text = await readTextFile(this.paths.personal);
    if (text === null) return { config: null, corrupt: false };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { config: null, corrupt: true, reason: '不是合法 JSON' };
    }
    const parsed = PersonalConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return { config: null, corrupt: true, reason: 'schema 校验未通过' };
    }
    const migrated = migrateGroupName(parsed.data);
    if (migrated === parsed.data) return { config: parsed.data, corrupt: false };
    try {
      await this.save(migrated);
    } catch (error) {
      /* 改名只是文案迁移：写盘失败时按原文返回，让用户继续用；下次读取会再试一次。 */
      console.error('[personal] 默认分组改名落盘失败', error);
      return { config: parsed.data, corrupt: false };
    }
    return { config: migrated, corrupt: false };
  }

  /** 原子替换。任何中断都不留半截 JSON（ADR-005）。 */
  async save(config: PersonalConfig): Promise<void> {
    await writeJsonAtomic(this.paths.personal, PersonalConfigSchema.parse(config));
  }
}
