/**
 * preload —— `window.tl` 抽象层的注入端。
 *
 * 只暴露**能力**，不暴露 Node/Electron 本体：`contextIsolation: true` + `contextBridge`。
 * 渲染层拿不到 `require`、拿不到 `ipcRenderer`、拿不到 `fs`——它只能调用这里的白名单。
 */
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AdminStatus,
  AppUpdateEvent,
  DiagnosticSnapshot,
  FavoriteItem,
  FeedbackDelivery,
  ImportCommitResult,
  ImportDecisions,
  IdentifyResult,
  ImportPreviewResult,
  OpenResult,
  PersonalSaveResult,
  PickResult,
  PublishOutcome,
  RelocateResult,
  ScanResult,
  SyncSnapshot,
  TeamLaunchApi,
} from '../renderer/bridge/types.ts';
import { PersonalConfigSchema, SettingsSchema } from '../shared/schema/local.ts';
import { EntrySchema } from '../shared/schema/entry.ts';
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
} = {
  sync: NEVER,
  settings: SettingsSchema.parse({}),
  personal: PersonalConfigSchema.parse({ groups: [] }),
};

void (async () => {
  try {
    const [s, st, p] = await Promise.all([
      invoke<SyncSnapshot | null>('tl:sync-snapshot'),
      invoke<Settings | null>('tl:settings-get'),
      invoke<PersonalConfig | null>('tl:personal-get'),
    ]);
    if (s) cache.sync = s;
    if (st) cache.settings = { ...cache.settings, ...st };
    if (p) cache.personal = p;
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

const api: TeamLaunchApi = {
  kind: 'electron',

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
    reveal: (entryId) => invoke<void>('tl:entries-reveal', entryId),
    openExternal: (url) => invoke<void>('tl:entries-open-external', url),
    pick: (kind) => invoke<PickResult>('tl:entries-pick', kind),
    scanStartMenu: () => invoke<ScanResult>('tl:entries-scan'),
    identify: (text) => invoke<IdentifyResult>('tl:entries-identify', text),
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

  palette: {
    hide: () => invoke<void>('tl:palette-hide'),
  },

  clipboard: {
    write: (text) => invoke<boolean>('tl:clipboard-write', text),
  },

  window: {
    min: () => invoke<void>('tl:window', 'min'),
    toggleMax: () => invoke<void>('tl:window', 'max'),
    close: () => invoke<void>('tl:window', 'close'),
    setZoom: (zoomPercent: number) => invoke<void>('tl:window-zoom', zoomPercent),
  },

  events: {
    onHotkeyConflict: (cb) => subscribe<{ accelerator: string }>('tl:hotkey-conflict', cb),
    // 主进程推的是 { status, accelerator }，契约只向外暴露"是否注册成功"这一个布尔；
    // 冲突细节由 onHotkeyConflict 单独通知，两条通道不重复表达同一件事。
    onHotkeyStatus: (cb) =>
      subscribe<{ status: string }>('tl:hotkey-status', (p) => cb({ registered: p.status === 'registered' })),
    onPaletteShown: (cb) => subscribe<void>('tl:palette-shown', () => cb()),
    onPaletteHidden: (cb) => subscribe<void>('tl:palette-hidden', () => cb()),
    onSettingsChanged: (cb) => subscribe<Settings>('tl:settings', cb),
    onAppUpdate: (cb) => subscribe<AppUpdateEvent>('tl:app-update', cb),
  },
  updater: {
    install: () => invoke<void>('tl:app-update-install'),
    openUpdatesFolder: () => invoke<boolean>('tl:app-updates-folder'),
  },
  favorites: {
    get: () => invoke<FavoriteItem[]>('tl:favorites-get'),
    save: (list) => invoke<void>('tl:favorites-save', list),
  },
};

contextBridge.exposeInMainWorld('tl', api);
