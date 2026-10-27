/**
 * 本机程序索引的契约（2026-10-24）。
 *
 * 索引只服务快捷窗口搜索：**不是入口**、不进团队配置、不参与同步、不占个人入口容量
 * （PRD AC-19）。来源只有开始菜单里的 .lnk（用户拍板：不遍历磁盘）。
 *
 * name 必须压到 `CAPACITY.MAX_NAME_LEN` 以内：搜索结果会合成一条临时 Entry 交给
 * `openObject` / `icon`，而 EntrySchema 对 name 有 40 字上限——超一点整条都会被拒。
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from './common.ts';

export const PROGRAM_INDEX_SCHEMA_VERSION = 1;

/** 一条本机程序（运行时形态：含拼音检索键与稳定 id）。 */
export const ProgramItemSchema = z.object({
  /** `sys-` + 目标/参数哈希：跨扫描稳定，供图标缓存与列表 key 使用。 */
  id: z.string().min(1).max(64),
  /** 快捷方式显示名（已截到 40 字，保证能合成合法 Entry）。 */
  name: z.string().min(1).max(40),
  /** 快捷方式解析出的真实 exe。 */
  target: z.string().min(1),
  /** 原始 .lnk 路径：图标回退与"已添加入口"判定都用它。 */
  sourcePath: z.string().min(1),
  args: z.string().max(4096),
  cwd: z.string().max(4096),
  /** 来源标签（当前只有「开始菜单」；保留字段便于以后加 UWP）。 */
  source: z.string().min(1).max(20),
  /** 全拼检索键（小写、去分隔符），由主进程预计算。 */
  py: z.string().max(120),
  /** 拼音首字母检索键（小写），由主进程预计算。 */
  pyInit: z.string().max(60),
});

export type ProgramItem = z.infer<typeof ProgramItemSchema>;

/** 主进程推送 / preload 缓存 / 渲染层订阅的同一份快照。 */
export interface ProgramIndexSnapshot {
  items: ProgramItem[];
  /** 上次扫描完成时间；null = 还没扫过（磁盘缓存也没有）。 */
  scannedAt: string | null;
  /** 正在后台扫描：界面可据此显示"正在索引本机程序…"。 */
  scanning: boolean;
  /** 最近一次扫描失败的人话原因；成功后清空。 */
  error: string | null;
}

/** 磁盘缓存（config/programs-index.json）：只存结果，不存扫描过程。 */
export const ProgramIndexCacheSchema = z.object({
  schemaVersion: z.literal(PROGRAM_INDEX_SCHEMA_VERSION),
  scannedAt: IsoDateTimeSchema,
  items: z.array(ProgramItemSchema).max(5000),
});

export type ProgramIndexCache = z.infer<typeof ProgramIndexCacheSchema>;

/** preload 缓存默认值：安全空态，不伪造"已索引"。 */
export const EMPTY_PROGRAM_INDEX: ProgramIndexSnapshot = {
  items: [],
  scannedAt: null,
  scanning: false,
  error: null,
};
