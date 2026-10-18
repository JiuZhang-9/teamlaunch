/**
 * 只落本机的两份数据：settings.json（用户意图）与 personal.json。
 *
 * 字段集合以 ARCHITECTURE §5.2 为准，本文件是它的机器可执行版本，两者必须一致。
 * 「上次成功的端点」不在这里 —— 那是机器维护的高频状态，归 `discovery.json`（ADR-002 L1）。
 * 一个事实只允许一个写入点，settings.json 只放用户意图。
 */

import { z } from 'zod';
import { IsoDateTimeSchema, SCHEMA_VERSION } from './common.ts';
import { GroupListSchema } from './group.ts';

export const WindowHotkeysSchema = z.object({
  toggleSidebar: z.string().default('Ctrl+B'),
  tabTeam: z.string().default('Ctrl+Q'),
  tabPersonal: z.string().default('Ctrl+E'),
  focusSearch: z.string().default('Ctrl+F'),
  refresh: z.string().default('F5'),
  openSettings: z.string().default('Ctrl+,'),
  toggleEdit: z.string().default('Ctrl+Shift+E'),
  publish: z.string().default('Ctrl+Enter'),
  newEntry: z.string().default('Ctrl+N'),
});

/** 应用内快捷键默认值（全局唤起热键走 OS 注册，不在此列）。 */
export const WINDOW_HOTKEY_DEFAULTS: WindowHotkeys = {
  toggleSidebar: 'Ctrl+B',
  tabTeam: 'Ctrl+Q',
  tabPersonal: 'Ctrl+E',
  focusSearch: 'Ctrl+F',
  refresh: 'F5',
  openSettings: 'Ctrl+,',
  toggleEdit: 'Ctrl+Shift+E',
  publish: 'Ctrl+Enter',
  newEntry: 'Ctrl+N',
};

export type WindowHotkeys = z.infer<typeof WindowHotkeysSchema>;

export const SettingsSchema = z.object({
  /** 本机文件由本应用独占写入，缺失时按当前版本补齐即可；线上报文体则一律严格必填。 */
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  /** 默认 member：不显式开启就不起服务、不开防火墙依赖，这是安全的默认值。 */
  role: z.enum(['admin', 'member']).default('member'),
  /** L0 手动覆盖，也是迁移到独立服务器的开关。null = 走自动发现。 */
  serviceUrl: z.string().nullable().default(null),
  autoLaunch: z.boolean().default(true),
  trayEnabled: z.boolean().default(true),
  hotkey: z.string().min(1).default('Ctrl+Space'),
  pollIntervalMs: z.int().min(5_000).max(300_000).default(30_000),
  /** 多选连锁启动的每步间隔（用户定稿 2026-10-05：默认 800ms，可在设置调节）。 */
  chainIntervalMs: z.int().min(300).max(5_000).default(800),
  /** 管理员解锁后闲置多久自动退出编辑态（PRD §14.1 / ADR-006）。 */
  editIdleTimeoutMs: z.int().min(30_000).max(7_200_000).default(600_000),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /**
   * 应用内快捷键（窗口内 keydown 匹配，非 OS 级注册）。空串 = 禁用该键。
   * 全局唤起热键（OS 级）单独存放在 hotkey 字段。
   */
  hotkeys: WindowHotkeysSchema.default(WINDOW_HOTKEY_DEFAULTS),
  /**
   * 主题色（accent）：只用于 7 处点缀（选中竖条/tint 底、Logo、卡片左缘条、focus 环、开关、徽标），
   * 画布/卡片/正文永远是中性灰。6 位 hex；派生色（hover/text/tint）由渲染层运行时计算。
   */
  // eslint-disable-next-line no-restricted-syntax -- 默认值即品牌青蓝；它是数据（用户可改的设置项），样式引用一律走派生后的 --accent*。
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#106696'),
  /**
   * 打开网页用哪个浏览器：**本机可执行文件路径**；null = 系统默认浏览器（默认值，行为不变）。
   * 指定的浏览器失效（卸载/移动）时回落系统默认并提示——不回写这个字段（用户的选择留着）。
   */
  browserExe: z.string().nullable().default(null),
  /** 侧栏折叠：true = 侧栏完全消失（非图标栏形态）。持久化，跨会话恢复。 */
  sidebarCollapsed: z.boolean().default(false),
  /**
   * 命名刻意不是 `telemetryUpload`：关闭它必须**停止本地记录并清空未发送缓冲**，
   * 不是"只停上行、继续本地记"（AC-18）。写成 upload 会被读成只控制上传。
   */
  telemetryEnabled: z.boolean().default(true),
  /** null = 隐私说明未确认。此状态下必须零记录、零上报（AC-18）。 */
  telemetryNoticeAckedAt: IsoDateTimeSchema.nullable().default(null),
  /**
   * 主页公告提醒（2026-10-17）：管理员发布新公告时，在右下角提示一次（每篇只提示一次）。
   * 关掉只是不再弹提示——公告本身仍在主页上，随时能看。
   */
  announcementNotify: z.boolean().default(true),
  /**
   * 自动检查更新（2026-10-17，O-07）：开（默认）= 启动约 30 秒后自动检查一次、此后每 6 小时一次；
   * 关 = 不再自动访问更新源（GitHub / 局域网镜像），只有手点「检查更新」才发请求。
   *
   * 为什么给开关：更新检查是本项目**常态化的第三方外网出口**（SECURITY.md 第 5 条）。
   * 企业内网若不允许任何此类访问，"默认静默失败"不如给一个诚实的选择——关掉就等于零请求。
   */
  autoCheckUpdates: z.boolean().default(true),
  /**
   * 全局快捷窗口的不透明度（2026-10-19 用户要求："增加半透明调节功能，比如调到 0.8"）。
   * 整数百分比，60–100，默认 100（不透明＝行为不变）。只作用于面板窗口，不动主窗口。
   */
  paletteOpacity: z.int().min(60).max(100).default(100),
  /** 界面缩放（百分比）。浏览器式缩放：窗口不变，字体与内部 UI 等比放大重排。 */
  uiZoom: z.int().min(80).max(150).default(100),
  /**
   * 应用内快捷键覆盖表：动作 id → 加速器串（如 'Ctrl+Shift+E'）。
   * 只存**用户改过**的动作，未出现的动作跟随内置默认（shared/app-hotkeys.ts）；
   * 空串 = 用户显式解绑。格式由录制器保证，匹配在渲染层完成。
   */
  appHotkeys: z.record(z.string(), z.string()).default({}),
  /** 自增即可让全部图标缓存失效，无需逐个删文件。 */
  iconCacheVersion: z.int().min(1).default(1),
  /** 个人导入遇到 ID 冲突时的策略（AC-15：禁止静默覆盖）。 */
  deletedConflictPolicy: z.enum(['ask', 'skip', 'overwrite', 'copy']).default('ask'),
});

export const PersonalConfigSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  updatedAt: IsoDateTimeSchema.optional(),
  groups: GroupListSchema,
});

export type Settings = z.infer<typeof SettingsSchema>;
export type PersonalConfig = z.infer<typeof PersonalConfigSchema>;
