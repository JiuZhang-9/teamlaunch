/**
 * src/repositories/settings.repository.ts —— settings.json（用户意图）
 *
 * 字段集合以 `src/shared/schema/local.ts` 的 SettingsSchema 为准（ARCHITECTURE §5.2
 * 的机器可执行版本），本文件不做任何字段级默认值判断——默认值在 schema 里，
 * 两处都写就会分叉。
 *
 * 三条纪律：
 *   1. **这里只放用户意图**。「上次成功的端点」归 discovery.json（高频、机器维护），
 *      不能混进来：混进来之后"重置设置"会顺手清掉端点记忆，且写放大翻倍。
 *   2. 文件缺失 / 校验失败 → 返回 schema 默认值，不抛错。设置坏了也要能启动，
 *      否则用户会卡在一个连"设置页"都打不开的状态里。
 *   3. `role` 的默认 member 是安全默认值：不显式开启就不起服务、不开防火墙依赖。
 */

import { SettingsSchema, type Settings } from '../shared/schema/local.ts';
import { readJsonFile, writeJsonAtomic } from './atomic-json.ts';
import type { StoragePaths } from './paths.ts';

export class SettingsRepository {
  constructor(private readonly paths: StoragePaths) {}

  /** 读取；缺失或损坏时给出带默认值的完整对象。 */
  async load(): Promise<Settings> {
    const raw = await readJsonFile<unknown>(this.paths.settings);
    const parsed = SettingsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : rescueFieldByField(raw);
  }

  async save(settings: Settings): Promise<void> {
    await writeJsonAtomic(this.paths.settings, SettingsSchema.parse(settings));
  }

  /** 局部更新：先读后合再整体校验，避免写出半份配置。 */
  async patch(partial: Partial<Settings>): Promise<Settings> {
    const current = await this.load();
    const next = SettingsSchema.parse({ ...current, ...partial });
    await this.save(next);
    return next;
  }

  /** L0 手动覆盖端点。null 表示走自动发现。 */
  async serviceUrl(): Promise<string | null> {
    return (await this.load()).serviceUrl;
  }

  /**
   * 遥测开关。命名是 `telemetryEnabled` 而不是 `telemetryUpload`：
   * 关闭必须**停止本地记录并清空未发送缓冲**（AC-18），不是"只停上行"。
   * 即便如此，仍以 `telemetryNoticeAckedAt != null` 为最终闸门——
   * 隐私说明没确认时零记录、零上报，与开关状态无关。
   */
  async telemetryEnabled(): Promise<boolean> {
    const settings = await this.load();
    return settings.telemetryEnabled && settings.telemetryNoticeAckedAt !== null;
  }
}

/**
 * 逐字段抢救：整体校验不过时，一个字段一个字段地尝试装回默认值之上，
 * 认得出的保留、认不出的丢掉。目的是"一次手改坏一个字段，不至于清空全部设置"。
 * 逐个试而不是整体退回默认，代价是 n 次解析（n≈10），而设置读取是低频操作。
 */
function rescueFieldByField(raw: unknown): Settings {
  const defaults = SettingsSchema.parse({});
  if (raw === null || typeof raw !== 'object') return defaults;
  const source = raw as Record<string, unknown>;
  let out = defaults;
  for (const key of Object.keys(defaults) as Array<keyof Settings & string>) {
    if (!(key in source)) continue;
    const parsed = SettingsSchema.safeParse({ ...out, [key]: source[key] });
    if (parsed.success) out = parsed.data;
  }
  return out;
}
