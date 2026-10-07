/**
 * window.tl 抽象层的类型契约 —— 渲染层与宿主能力之间的唯一接口。
 *
 * 铁律：渲染层任何文件都不得 import electron（见 eslint no-restricted-imports）。
 * 浏览器预览（无 window.tl）时自动回落到 mocks/ 下的模拟实现，UI 必须完整可交互。
 */

import type { TeamConfig } from '../../shared/schema/config.ts';
import type { PersonalConfig, Settings } from '../../shared/schema/local.ts';
import type { FeedbackItem } from '../../shared/schema/feedback.ts';
import type { Entry } from '../../shared/schema/entry.ts';

/* ------------------------------------------------------------------ *
 * 同步：8 态 + offlineReason + hasCache（架构 v1.4 T3.6 / T3.6.1）
 * 这三个值一律由同步服务写入，UI 只做「枚举 → 视觉」映射，禁止推导。
 * ------------------------------------------------------------------ */

export const SYNC_STATES = [
  'NEVER_SYNCED',
  'SYNCING',
  'ONLINE_LATEST',
  'ONLINE_UPDATE_PENDING',
  'OFFLINE_CACHED',
  'OFFLINE_EMPTY',
  'SYNC_DATA_REJECTED',
  'SYNC_FAILED_UNKNOWN',
] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export const OFFLINE_REASONS = [
  'SERVICE_NOT_FOUND',
  'NETWORK_UNREACHABLE',
  'UNKNOWN',
  'CONNECTION_BLOCKED',
] as const;
export type OfflineReason = (typeof OFFLINE_REASONS)[number];

/** 同步服务推给渲染层的唯一快照形态。 */
export interface SyncSnapshot {
  state: SyncState;
  offlineReason: OfflineReason | null;
  /** 本机是否有一次成功同步留下的缓存。禁止由 UI 从"文件存在"或"卡片数"推断。 */
  hasCache: boolean;
  /** 最近一次成功同步的时刻（UTC ISO）；从未成功同步时为 null。 */
  lastSyncedAt: string | null;
  /** 缓存对应的团队版本号。 */
  revision: number | null;
  /** 有缓存时的团队配置；OFFLINE_EMPTY 时为 null。 */
  config: TeamConfig | null;
}

/* ------------------------------------------------------------------ *
 * 打开入口的结果：本机可判定的失败原因（AC-12）
 * ------------------------------------------------------------------ */

export const OPEN_FAILURES = [
  'NOT_INSTALLED',
  'PATH_MISSING',
  'NO_PERMISSION',
  'INVALID_URL',
  'LINK_UNAVAILABLE',
  'UNKNOWN',
] as const;
export type OpenFailure = (typeof OPEN_FAILURES)[number];

export type OpenResult = { ok: true } | { ok: false; failure: OpenFailure };

/** 剪贴板快捷添加的识别结果（与 main/picker.ts 的 IdentifyResult 结构一致，改两处要同步）。 */
export type IdentifyResult =
  | { kind: 'web'; url: string; name: string }
  | { kind: 'app'; target: string; sourcePath: string | null; args: string | null; name: string }
  | { kind: 'folder'; target: string; name: string }
  | { kind: 'none'; reason: string };

/** 「在本机重新定位」结果：cancelled = 用户取消（不算失败、不提示错误）。 */
export type RelocateResult = { ok: true } | { ok: false; reason: 'cancelled' | OpenFailure };

/** 自动更新事件（与 main/updater.ts 的 AppUpdateEvent 结构一致，改两处要同步）。 */
export type AppUpdateEvent = { type: 'available' | 'downloaded'; version: string };

/** 主页收藏（2026-10-05）：本机各存各的，只存入口 id。 */
export interface FavoriteItem {
  entryId: string;
  addedAt: string;
}

/* ------------------------------------------------------------------ *
 * 反馈投递三态（AC-13 / AC-13a）：PENDING 落盘即成立，SENT 仅服务端确认
 * ------------------------------------------------------------------ */

export type FeedbackDelivery =
  | { status: 'PENDING'; queuedAt: string }
  | { status: 'SENT' }
  | { status: 'DROPPED'; reason: 'EXPIRED' | 'QUEUE_FULL' }
  | { status: 'RATE_LIMITED' };

/* ------------------------------------------------------------------ *
 * 发布（AC-06）与诊断（AC-17 / K-01）
 * ------------------------------------------------------------------ */

export const PUBLISH_ERRORS = [
  'REVISION_CONFLICT',
  'INSTANCE_MISMATCH',
  'SIGNATURE_INVALID',
  'VALIDATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'NETWORK_UNREACHABLE',
] as const;
export type PublishError = (typeof PUBLISH_ERRORS)[number];

export type PublishOutcome =
  | { ok: true; revision: number; changedCount: number }
  | { ok: false; error: PublishError };

export type DiagnosticLevel = 'ok' | 'warn' | 'bad';

export interface DiagnosticRow {
  key: string;
  value: string;
  level: DiagnosticLevel;
  /** 未持令牌的员工视角：服务端侧字段一律占位（不要留空白或 ***） */
  locked?: boolean;
}

export interface DiagnosticConclusion {
  level: 'warn' | 'bad';
  title: string;
  detail: string;
  actions: Array<{ id: 'switch-guide' | 'repair' | 'view-settings'; label: string }>;
}

export interface DiagnosticSnapshot {
  rows: DiagnosticRow[];
  conclusion: DiagnosticConclusion | null;
  raw: string;
}

/* ------------------------------------------------------------------ *
 * 个人入口导入（两段式）
 * ------------------------------------------------------------------ */

/** 冲突处置只有这三种，没有任何"默认覆盖"的分支（AC-15）。 */
export type ConflictAction = 'skip' | 'overwrite' | 'copy';
/** `ask` 是默认：不显式选过就不许走覆盖。 */
export type ConflictPolicy = 'ask' | ConflictAction;

export interface ImportConflict {
  /** 导入文件里的 id —— 逐项决定的键用的是这个，不是现有 id。 */
  incomingId: string;
  incomingName: string;
  existingId: string;
  existingName: string;
  /** id 重复 = 同一条；target 重复 = 目标一致但 id 不同。 */
  kind: 'id' | 'target';
}

export interface ImportPreview {
  /** 导入文件中的入口总数（含重复 id）。 */
  total: number;
  added: number;
  overwritten: number;
  conflicts: ImportConflict[];
}

export type ImportPreviewResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; reason: string; details?: string[] };

export interface ImportApplied {
  added: number;
  overwritten: number;
  skipped: number;
  copied: number;
}

export type ImportCommitResult =
  /**
   * 回带落盘后的规范配置（与 `PersonalSaveResult.ok:true` 同一形态），
   * 供调用方刷新本地缓存——否则导入成功后 `get()` 仍返回旧值，
   * 界面上就是"导入了但没变化"，和"保存了但没变化"是同一个 bug 的第二个入口。
   */
  | { kind: 'applied'; result: ImportApplied; config: PersonalConfig }
  /** ask 且仍有未决定的项：不落盘，把冲突清单交回界面。 */
  | { kind: 'needs-decision'; conflicts: ImportConflict[] }
  /** 提交阶段被容量闸拦下（文件合法、无冲突，但合并后超限）：未做任何改动。 */
  | { kind: 'error'; reason: string };

export type PersonalSaveResult =
  /** 回带落盘后的规范配置（schema 补齐默认值后的那份），供调用方刷新本地缓存。 */
  | { ok: true; config: PersonalConfig }
  /**
   * 未通过 schema 或容量闸：**一个字节都不写**。
   * 返回而不是抛错——抛出去在界面上就是"点了保存没反应"，与静默失败无法区分。
   */
  | { ok: false; reason: string; details?: string[] };

export interface ImportDecisions {
  policy: ConflictPolicy;
  perEntry?: Record<string, ConflictAction>;
}

/* ------------------------------------------------------------------ *
 * 宿主能力总接口
 * ------------------------------------------------------------------ */

/** 仅浏览器预览提供的演示开关（产品 UI 里不存在这些东西）。 */
export interface DemoControls {
  feedbackMode: 'online' | 'offline' | 'rate_limited';
  setFeedbackMode(mode: 'online' | 'offline' | 'rate_limited'): void;
  publishError: PublishError | null;
  setPublishError(error: PublishError | null): void;
  diagnosticsScenario: 'normal' | 'public-network' | 'firewall-missing';
  setDiagnosticsScenario(s: 'normal' | 'public-network' | 'firewall-missing'): void;
}

export interface TeamLaunchApi {
  readonly kind: 'electron' | 'mock';
  readonly demo?: DemoControls;

  entries: {
    open(entryId: string): Promise<OpenResult>;
    /** 直接按入口对象打开（不经 id 解析）：编辑态草稿未发布，id 解析不到它。 */
    openObject(entry: Entry): Promise<OpenResult>;
    /**
     * 本机图标提取（data URL）；取不到返回 null，由 UI 回退 Lucide。
     * 直传入口对象而非 id（与 openObject 同构）：团队入口的编辑草稿/未发布改动
     * 在主进程反查不到（resolveEntry 只认已发布配置与个人落盘），按 id 查会
     * 拿到旧引用（已发布的表情）或 null（草稿新建）——换图标永远"不生效"。
     */
    icon(entry: Entry): Promise<string | null>;
    copyTarget(entryId: string): Promise<boolean>;
    reveal(entryId: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    /**
     * 打开系统选择框，让用户从本机挑一个程序或文件夹。
     *
     * 一个对话框不能同时选文件和文件夹（Windows 限制），所以由调用方先定 kind。
     * 快捷方式会被解析成真实 exe 路径，同时保留 .lnk 原路径（sourcePath）。
     */
    pick(kind: 'app' | 'folder'): Promise<PickResult>;
    /** 扫描开始菜单，返回指向 exe 的快捷方式候选（去重、排序、有上限）。 */
    scanStartMenu(): Promise<ScanResult>;
    /** 剪贴板快捷添加（方案 A）：识别一段文本可否快速成入口；kind=none 时给可读原因。 */
    identify(text: string): Promise<IdentifyResult>;
    /** 在本机重新定位应用入口：选一次、本机记住、立刻尝试打开。 */
    relocate(entry: Entry): Promise<RelocateResult>;
  };

  /** 主页收藏（本机持久化）。 */
  favorites: {
    get(): Promise<FavoriteItem[]>;
    save(list: FavoriteItem[]): Promise<void>;
  };

  /** 自动更新（打包版才有行为；开发态 install 不会被执行——入口根本不启动）。 */
  updater: {
    /** 静默安装已下载的更新并重启（perMachine 安装会要一次 UAC）。 */
    install(): Promise<void>;
    /** 打开更新分发目录（管理员把构建产物放进来）。 */
    openUpdatesFolder(): Promise<boolean>;
  };

  sync: {
    snapshot(): SyncSnapshot;
    subscribe(listener: (s: SyncSnapshot) => void): () => void;
    refresh(): Promise<void>;
    /** 挂载后主动拉一次当前快照：preload 预热与首帧有竞态，推送可能还没来。 */
    pull(): Promise<SyncSnapshot>;
    /** 仅 mock 传输层提供：让预览 Harness 演示 8 态（不是 UI 推导的口子）。 */
    demoForce?(patch: Partial<Pick<SyncSnapshot, 'state' | 'offlineReason' | 'hasCache'>>): void;
  };

  settings: {
    get(): Settings;
    patch(patch: Partial<Settings>): Promise<Settings>;
  };

  personal: {
    get(): PersonalConfig;
    /**
     * 保存走与导入同一道容量闸 + schema 校验，失败返回可展示的原因而不抛错。
     * 以前这里是无条件写盘（不过任何闸），上限因此可以被绕过。
     */
    save(config: PersonalConfig): Promise<PersonalSaveResult>;
    exportJson(): Promise<{ ok: true; path: string; count: number } | { ok: false; reason: string }>;
    /**
     * 导入两段式（与后端 personal.service 的 previewImport / commitImport 一一对应）。
     *
     * 顺序不可颠倒：**先预览（不读写现有数据）→ 有冲突就逐项问 → 再提交**。
     * 预览过关不代表提交一定成功：文件合法、无冲突、但合并后总数超限的情况，
     * 预览会通过而提交被拦（容量闸在落盘前）。UI 必须能呈现这个失败。
     */
    previewImport(text: string, current: PersonalConfig): Promise<ImportPreviewResult>;
    commitImport(text: string, decisions: ImportDecisions): Promise<ImportCommitResult>;
  };

  feedback: {
    submit(item: FeedbackItem): Promise<FeedbackDelivery>;
  };

  publish: {
    /**
     * 发布必须携带**完整草稿**与它基于的版本号：服务端按 baseRevision 做乐观并发、
     * 按草稿内容生成新版本。此前只传 summary，服务端拿不到配置，发布从未真正成功过。
     */
    put(req: PublishRequestPayload): Promise<PublishOutcome>;
  };

  diagnostics: {
    fetch(): Promise<DiagnosticSnapshot | null>;
    repair(): Promise<boolean>;
  };

  /**
   * 管理员口令：**必须先能设置，再谈验证**。
   *
   * 只暴露 unlock 时，全新安装的机器没有任何途径写入口令——用户输什么都是错的，
   * 而且界面不会告诉他"你还没设置过"。所以 status / enroll / unlock 三者是一套：
   *   status → 未设置则走 enroll（设置 + 直接进入已解锁，不要求再输一遍）
   *          → 已设置则走 unlock
   * enroll 失败的原因一律用通用文案，不回传"至少 N 位"之类的规则（PRD §14.1）。
   */
  admin: {
    status(): Promise<AdminStatus>;
    enroll(passphrase: string): Promise<{ ok: boolean; reason?: string }>;
    unlock(passphrase: string): Promise<{ ok: boolean }>;
    /** 本机匿名设备标识（identity.json），设置页展示用。 */
    deviceId(): Promise<string>;
  };

  /** 迷你面板窗口（palette）的专属控制：渲染层 Esc/关闭动作请主进程收起窗口。 */
  palette: {
    hide(): Promise<void>;
  };

  clipboard: {
    write(text: string): Promise<boolean>;
  };

  /**
   * 窗口控制（主进程 `tl:window`）。
   *
   * 三个动作都是 no-return：调用方不做成功/失败分支——窗口操作要么生效要么进程已退出，
   * 中间没有可恢复的失败态。界面上的反馈由 TitleBar 依据 `isMockHost` 决定是否提示，
   * 这样契约保持最简，也避免 UI 去猜"这次到底生效了没有"。
   */
  window: {
    min(): Promise<void>;
    toggleMax(): Promise<void>;
    close(): Promise<void>;
    /** 浏览器式缩放（百分比 80–150）：窗口不变，字体与内部 UI 等比缩放。 */
    setZoom(zoomPercent: number): Promise<void>;
  };

  /**
   * 主进程推送类事件（preload 转发）。每个方法返回**取消订阅**函数。
   *
   * 这些通道必须由主进程驱动、界面被动消费：
   *  - `onHotkeyConflict`：AC-05。热键注册不上必须告知并引导改键，且**每次会话只提示一次**——
   *    Ctrl+Space 与中文输入法冲突概率很高，反复弹窗会把人烦走。
   *  - `onPaletteShown/Hidden`：迷你面板窗口的 open 状态由主进程驱动（显示/失焦/热键切换）。
   */
  events: {
    onHotkeyConflict(cb: (info: { accelerator: string }) => void): () => void;
    onHotkeyStatus(cb: (info: { registered: boolean }) => void): () => void;
    onPaletteShown(cb: () => void): () => void;
    onPaletteHidden(cb: () => void): () => void;
    /** 任意窗口改了设置都广播到这里：跨窗口主题/热键/缩放同步的唯一通道。 */
    onSettingsChanged(cb: (settings: Settings) => void): () => void;
    /** 自动更新进展：available=发现新版本开始后台下载；downloaded=已就绪可安装。 */
    onAppUpdate(cb: (event: AppUpdateEvent) => void): () => void;
  };
}

/** 发布请求载荷：草稿 + 它基于的版本 + 变更说明。 */
export interface PublishRequestPayload {
  summary: string;
  config: TeamConfig;
  baseRevision: number;
}

/**
 * 管理员口令状态。
 *
 * `canEnroll`（这台机器能不能设置口令）与 `enrolled`（口令是否已设置）必须分开：
 * 混为一谈会让全新安装的机器显示"请输入口令"——而口令不存在、也没有设置入口，用户被卡死。
 */
export interface AdminStatus {
  enrolled: boolean;
  role: 'admin' | 'member';
  canEnroll: boolean;
}

/** 本机选择框的返回。target 是真实目标，sourcePath 是原始选择（lnk 时两者不同）。 */
export interface PickResult {
  ok: boolean;
  kind: 'app' | 'folder';
  name: string;
  target: string;
  sourcePath: string;
  reason?: string;
}

export interface ScanCandidate {
  name: string;
  target: string;
  sourcePath: string;
}

export interface ScanResult {
  ok: boolean;
  items: ScanCandidate[];
  reason?: string;
}

declare global {
  interface Window {
    tl?: TeamLaunchApi;
  }
}
