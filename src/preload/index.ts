/**
 * preload —— `window.tl` 抽象层的注入端。
 *
 * 只暴露**能力**，不暴露 Node/Electron 本体：`contextIsolation: true` + `contextBridge`。
 * 渲染层拿不到 `require`、拿不到 `ipcRenderer`、拿不到 `fs`——它只能调用这里的白名单。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AdminStatus,
  AppUpdateStatus,
  BrowserInfo,
  AppUpdateEvent,
  DiagnosticSnapshot,
  BookmarkBrowser,
  BookmarkSource,
  FavoriteItem,
  SavedChain,
  FeedbackDelivery,
  ImportCommitResult,
  ImportDecisions,
  IdentifyResult,
  ImportPreviewResult,
  InstallUpdateResult,
  OpenResult,
  PersonalSaveResult,
  PickResult,
  ProgramIndexSnapshot,
  PublishOutcome,
  RelocateResult,
  ScanResult,
  SyncSnapshot,
  TeamLaunchApi,
} from '../renderer/bridge/types.ts';
import { PersonalConfigSchema, SettingsSchema } from '../shared/schema/local.ts';
import { EntrySchema } from '../shared/schema/entry.ts';
import { EMPTY_PROGRAM_INDEX } from '../shared/schema/programs.ts';
import type { PersonalConfig, Settings } from '../shared/schema/local.ts';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

/**
 * 主进程推送类事件的转发：接住 channel、回调给渲染层，返回取消订阅函数。
 *
 * 必须显式逐个转发（白名单），不暴露通用的 on(任意 channel)——
 * 否则渲染层就能自行订阅任意 IPC 通道，contextBridge 的白名单意义会被绕过。
 */
const subscribe = <T>(channel: string, deliver: (payload: T) => void): (() => void) => {
  const handler = (_e: unknown, payload: T): void => {
    deliver(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

/**
 * 同步式 getter 的缓存层。
 *
 * 契约里 `sync.snapshot()` / `settings.get()` / `personal.get()` 是同步读取
 * （渲染层按"本机已有值"使用，UI 不该为一次读盘挂 loading）。
 * Electron 侧必然是异步 IPC，所以这里在 preload 启动时预热缓存，
 * 之后靠 `tl:sync` 推送增量更新；读取永远返回缓存，不阻塞。
 */
const NEVER: SyncSnapshot = {
  state: 'NEVER_SYNCED',
  offlineReason: null,
  hasCache: false,
  lastSyncedAt: null,
  revision: null,
  config: null,
};

const cache: {
  sync: SyncSnapshot;
  settings: Settings;
  personal: PersonalConfig;
  programs: ProgramIndexSnapshot;
} = {
  sync: NEVER,
  settings: SettingsSchema.parse({}),
  personal: PersonalConfigSchema.parse({ groups: [] }),
  programs: EMPTY_PROGRAM_INDEX,
};

/**
 * 预热完成信号（R23，2026-10-17）。
 *
 * 预热是异步的，而渲染层首帧**同步**读缓存——首帧早于预热完成时读到的是默认值
 * （表现为隐私门重弹、「我的入口」空白，重启即好）。渲染层挂载后 await 这个 promise
 * 再重取一次缓存，就能在不给首帧挂 loading 的前提下保证最终显示的是真值。
 */
const ready: Promise<void> = (async () => {
  try {
    /* 每个通道单独兜底：某个 handler 还没注册（启动竞态）时，
       不能把已就绪的 settings / personal / sync 缓存一起丢掉。 */
    const [s, st, p, pg] = await Promise.all([
      invoke<SyncSnapshot | null>('tl:sync-snapshot').catch(() => null),
      invoke<Settings | null>('tl:settings-get').catch(() => null),
      invoke<PersonalConfig | null>('tl:personal-get').catch(() => null),
      invoke<ProgramIndexSnapshot | null>('tl:programs-snapshot').catch(() => null),
    ]);
    if (s) cache.sync = s;
    if (st) cache.settings = { ...cache.settings, ...st };
    if (p) cache.personal = p;
    if (pg) cache.programs = pg;
  } catch {
    // 预热失败保持默认：NEVER_SYNCED 与默认 settings 都是安全态，不伪造"已同步"
  }
})();

ipcRenderer.on('tl:sync', (_e, snapshot: SyncSnapshot) => {
  cache.sync = snapshot;
});

// 设置变更广播：任意窗口改了设置（主题/缩放/热键…），其余窗口的缓存与界面都要跟上。
ipcRenderer.on('tl:settings', (_e, settings: Settings) => {
  cache.settings = settings;
});

// 个人入口变更广播（2026-10-21）：主窗口加/删/改后，快捷面板窗口的缓存与界面立刻跟上。
// 缓存必须在这里更新——`personal.get()` 是同步读缓存，只发事件的话渲染层拿到的仍是旧值。
ipcRenderer.on('tl:personal', (_e, config: PersonalConfig) => {
  cache.personal = config;
});

// 本机程序索引广播（2026-10-24）：启动扫描/开始菜单变化/手动刷新都推一次。
ipcRenderer.on('tl:programs', (_e, snapshot: ProgramIndexSnapshot) => {
  cache.programs = snapshot;
});

const api: TeamLaunchApi = {
  kind: 'electron',
  /* 预热完成信号（R23）：同步 getter 在首帧可能返回缓存默认值，挂载后 await 它再重取。 */
  ready,
  /* 真实运行版本由主进程经 webPreferences.additionalArguments 下发（见 windowManager）；
     拿不到就是空串，渲染层回落到构建期常量 __APP_VERSION__（浏览器预览 Harness 用）。 */
  appVersion: process.argv.find((a) => a.startsWith('--tl-app-version='))?.slice('--tl-app-version='.length) ?? '',

  entries: {
    open: (entryId) => invoke<OpenResult>('tl:entries-open', entryId),
    openObject: (raw) => {
      // 草稿入口直接开：目标经 schema 校验再交给主进程 opener。
      const gate = EntrySchema.safeParse(raw);
      if (!gate.success) return Promise.resolve({ ok: false as const, failure: 'UNKNOWN' as const });
      return invoke<OpenResult>('tl:entries-open-object', gate.data);
    },
    icon: (entry) => {
      // 图标提取直传入口对象（与 openObject 同理）：草稿/未发布的图标引用主进程
      // 按 id 反查不到，目标路径校验后交给主进程，异常一律回落 null。
      const gate = EntrySchema.safeParse(entry);
      if (!gate.success) return Promise.resolve(null);
      return invoke<string | null>('tl:entries-icon', gate.data);
    },
    copyTarget: (entryId) => invoke<boolean>('tl:entries-copy', entryId),
    /** 多选批量复制：入口对象逐个过 schema 后交给主进程，一次写入多行。 */
    copyMany: (entries) => {
      const gated = (Array.isArray(entries) ? entries : []).map((raw) => EntrySchema.safeParse(raw)).filter((g) => g.success).map((g) => g.data);
      if (gated.length === 0) return Promise.resolve(false);
      return invoke<boolean>('tl:entries-copy-many', gated);
    },
    reveal: (entryId) => invoke<void>('tl:entries-reveal', entryId),
    openExternal: (url) => invoke<void>('tl:entries-open-external', url),
    pick: (kind) => invoke<PickResult>('tl:entries-pick', kind),
    scanStartMenu: () => invoke<ScanResult>('tl:entries-scan'),
    identify: (text) => invoke<IdentifyResult>('tl:entries-identify', text),
    /* 网页名称自动识别：只对正在添加的那一个网址取一次标题；null 表示取不到（回落域名）。 */
    pageTitle: (url) => invoke<string | null>('tl:entries-page-title', url),
    relocate: (entry) => {
      // 与 openObject 同一闸：入口对象过 schema 再交给主进程。
      const gate = EntrySchema.safeParse(entry);
      if (!gate.success) return Promise.resolve({ ok: false as const, reason: 'UNKNOWN' as const });
      return invoke<RelocateResult>('tl:entries-relocate', gate.data);
    },
  },

  sync: {
    snapshot: () => cache.sync,
    subscribe: (listener) => {
      const handler = (_e: unknown, snapshot: SyncSnapshot) => listener(snapshot);
      ipcRenderer.on('tl:sync', handler);
      listener(cache.sync);
      return () => ipcRenderer.removeListener('tl:sync', handler);
    },
    refresh: () => invoke<void>('tl:sync-refresh'),
    pull: async () => {
      const snapshot = await invoke<SyncSnapshot>('tl:sync-pull');
      cache.sync = snapshot;
      return snapshot;
    },
  },

  settings: {
    get: () => cache.settings,
    patch: async (patch) => {
      const next = await invoke<Settings>('tl:settings-patch', patch);
      cache.settings = next;
      return next;
    },
  },

  personal: {
    get: () => cache.personal,
    // 保存可能被 schema / 容量闸拒绝，因此有结果可判断，不再是无条件写盘。
    save: async (config) => {
      const result = await invoke<PersonalSaveResult>('tl:personal-save', config);
      // 用落盘后的规范配置刷新缓存：否则保存成功后 get() 仍返回旧值，
      // 界面上就是"保存了但没变化"。
      if (result.ok) cache.personal = result.config;
      return result;
    },
    exportJson: () =>
      invoke<{ ok: true; path: string; count: number } | { ok: false; reason: string }>('tl:personal-export'),
    /* 文件损坏诊断（R25）：损坏时 get() 返回的是**空配置**，和"本来就没有入口"长得一样，
       界面必须靠这条通道如实说明。每次现问主进程（不走缓存）：它只在页面挂载时问一次。 */
    corruption: () =>
      invoke<{ corrupt: boolean; reason: string | null }>('tl:personal-corruption'),
    // 导入两段式：先预览（不落盘），冲突逐项决定后再提交。顺序不可颠倒。
    previewImport: (text: string, current: PersonalConfig) =>
      invoke<ImportPreviewResult>('tl:personal-import-preview', { text, current }),
    commitImport: async (text: string, decisions: ImportDecisions) => {
      const result = await invoke<ImportCommitResult>('tl:personal-import-commit', { text, decisions });
      // 与 save 对称：导入成功也要刷新缓存，否则"导入了但没变化"。
      // needs-decision / error 两种都没写盘，缓存不动。
      if (result.kind === 'applied') cache.personal = result.config;
      return result;
    },
  },

  feedback: {
    submit: (item) => invoke<FeedbackDelivery>('tl:feedback-submit', item),
  },

  publish: {
    put: (req) => invoke<PublishOutcome>('tl:publish', req),
  },

  diagnostics: {
    fetch: () => invoke<DiagnosticSnapshot | null>('tl:diagnostics'),
    repair: () => invoke<boolean>('tl:diagnostics-repair'),
  },

  admin: {
    status: () => invoke<AdminStatus>('tl:admin-status'),
    enroll: (passphrase) => invoke<{ ok: boolean; reason?: string }>('tl:admin-enroll', passphrase),
    unlock: (passphrase) => invoke<{ ok: boolean }>('tl:admin-unlock', passphrase),
    deviceId: () => invoke<string>('tl:device-id'),
  },

  browsers: {
    list: () => invoke<BrowserInfo[]>('tl:browsers-scan'),
  },

  palette: {
    hide: () => invoke<void>('tl:palette-hide'),
    /**
     * 主窗口 Ctrl+Tab → 快捷面板（2026-10-21）。托盘开启时主窗口进托盘，
     * 实现主窗口 ↔ 面板互换；托盘关着时只把面板盖上来。
     */
    show: () => invoke<boolean>('tl:palette-show'),
    /** 「进入主窗口」（2026-10-18）：收起面板 → 还原 → 显示并聚焦主窗口。 */
    openMain: () => invoke<boolean>('tl:palette-open-main'),
    /** 面板里「加为入口」：主进程收起面板、唤起主窗口并把文本转发过去（见 tl:palette-quick-add）。 */
    quickAdd: (text) => invoke<boolean>('tl:palette-quick-add', text),
  },

  programs: {
    // 同步读 preload 缓存：首帧就能拿到上次扫描结果，搜索框不会先空一下。
    snapshot: () => cache.programs,
    subscribe: (cb) => {
      const handler = (_e: unknown, snapshot: ProgramIndexSnapshot): void => {
        cb(snapshot);
      };
      ipcRenderer.on('tl:programs', handler);
      cb(cache.programs);
      return () => ipcRenderer.removeListener('tl:programs', handler);
    },
    refresh: () => invoke<ProgramIndexSnapshot>('tl:programs-refresh'),
  },

  clipboard: {
    /** 只读文本（剪贴板候选行）。单条判定与清单去重在渲染层做。 */
    read: () => invoke<string>('tl:clipboard-read'),
    write: (text) => invoke<boolean>('tl:clipboard-write', text),
  },

  window: {
    min: () => invoke<void>('tl:window', 'min'),
    toggleMax: () => invoke<void>('tl:window', 'max'),
    close: () => invoke<void>('tl:window', 'close'),
    setZoom: (zoomPercent: number) => invoke<void>('tl:window-zoom', zoomPercent),
  },

  events: {
    onHotkeyConflict: (cb) =>
      subscribe<{ accelerator: string; kind: 'surface' | 'search' }>('tl:hotkey-conflict', cb),
    // 主进程推的是 { status, accelerator, kind }，契约只向外暴露"是否注册成功"这一个布尔；
    // 冲突细节由 onHotkeyConflict 单独通知，两条通道不重复表达同一件事。
    onHotkeyStatus: (cb) =>
      subscribe<{ status: string; accelerator: string; kind: 'surface' | 'search' }>('tl:hotkey-status', (p) =>
        cb({ registered: p.status === 'registered', accelerator: p.accelerator, kind: p.kind }),
      ),
    onPaletteShown: (cb) =>
      subscribe<{ scope?: 'entries' | 'programs' } | undefined>('tl:palette-shown', (p) =>
        cb({ scope: p?.scope ?? 'entries' }),
      ),
    onPaletteHidden: (cb) => subscribe<void>('tl:palette-hidden', () => cb()),
    /** 主窗口被重新唤起（热键 / 托盘 / 通知）：渲染层据此聚焦搜索并重读剪贴板。 */
    onMainShown: (cb) => subscribe<void>('tl:main-shown', () => cb()),
    onSettingsChanged: (cb) => subscribe<Settings>('tl:settings', cb),
    /** 任意窗口改了「我的入口」都广播到这里：快捷面板不重启也能搜到新加的入口。 */
    onPersonalChanged: (cb) => subscribe<PersonalConfig>('tl:personal', cb),
    onAppUpdate: (cb) => subscribe<AppUpdateEvent>('tl:app-update', cb),
    /** 主进程转发的"把这段文本走一遍粘贴添加"（面板的「加为入口」用）。 */
    onQuickAdd: (cb) => subscribe<string>('tl:quick-add', cb),
    /** 本机程序索引更新：面板窗口与主窗口共享同一份快照。 */
    onProgramsChanged: (cb) => subscribe<ProgramIndexSnapshot>('tl:programs', cb),
    onNoticeClick: (cb) => subscribe<void>('tl:notice-click', () => cb()),
  },
  updater: {
    install: () => invoke<InstallUpdateResult>('tl:app-update-install'),
    openUpdatesFolder: () => invoke<boolean>('tl:app-updates-folder'),
    /** 手动跑一轮检查，返回检查后的状态（设置页「检查更新」）。 */
    check: () => invoke<AppUpdateStatus>('tl:app-update-check'),
    /** 读当前更新状态：是否已发现新版本、是否已下载待安装、上次失败原因。 */
    status: () => invoke<AppUpdateStatus>('tl:app-update-status'),
  },
  favorites: {
    get: () => invoke<FavoriteItem[]>('tl:favorites-get'),
    save: (list) => invoke<void>('tl:favorites-save', list),
  },
  /* 连锁收藏（2026-10-19）：与收藏同款——本机文件，形状校验在 store 里做。 */
  chains: {
    get: () => invoke<SavedChain[]>('tl:chains-get'),
    save: (list) => invoke<void>('tl:chains-save', list),
  },
  /* 连锁的窗口位置记忆（2026-10-19 进阶）：记一次 / 启动时应用 / 查条数 / 清除。 */
  windowLayout: {
    capture: (chainId, steps) =>
      invoke<{ saved: number; missing: string[]; reason?: string }>('tl:window-layout-capture', chainId, steps),
    apply: (chainId, entryId) => invoke<{ ok: boolean; reason?: string }>('tl:window-layout-apply', chainId, entryId),
    info: (chainId) => invoke<number>('tl:window-layout-info', chainId),
    clear: (chainId) => invoke<boolean>('tl:window-layout-clear', chainId),
  },
  /* 本机用量统计（仅落本机文件、不上报、不进 UI）：失败静默，绝不影响功能。 */
  usage: {
    bump: (event) => invoke<boolean>('tl:usage-bump', event),
  },
  /* 浏览器书签扫描（Chrome / Edge）：只读本机文件、只在打开「导入书签」时调一次。 */
  bookmarks: {
    /** 第一步：识别本机装了的 Chromium 系浏览器（只 stat 目录，不读书签内容）。 */
    browsers: () => invoke<BookmarkBrowser[]>('tl:bookmarks-browsers'),
    /** 第二步：读用户选定的那一个浏览器的书签。 */
    scan: (browserId) => invoke<BookmarkSource[]>('tl:bookmarks-scan', browserId),
  },
  /* 设置·关于页：随包的更新日志（打包版读 resources/CHANGELOG.md）。 */
  about: {
    changelog: () => invoke<string | null>('tl:app-changelog'),
  },
  /* 系统通知（2026-10-19）：渲染层决定要不要打扰（新公告这类），主进程发系统级 toast。 */
  notify: {
    system: (payload) => invoke<boolean>('tl:notice', payload),
  },
  /* 拖拽进来的文件/文件夹取真实路径（2026-10-19 用户的"拖桌面图标进来"）：
     Electron 32 起渲染层的 `File.path` 已被移除，必须经 `webUtils.getPathForFile`——
     放 preload 里是为了让渲染层保持"零 electron 依赖"的硬规矩。取不到返回空串。 */
  files: {
    pathFor: (file: File) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
};

contextBridge.exposeInMainWorld('tl', api);
