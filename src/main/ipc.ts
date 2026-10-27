/**
 * IPC 处理器 —— `window.tl` 抽象层在主进程侧的另一端。
 *
 * 约定：渲染层不 import electron、不直连 HTTP、不做本机 IO，全部经这里。
 * 因此本文件是"能力边界"：任何新能力先在这里定义通道，再在 preload 暴露。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractIcon, openEntry, openUrl, type OpenTarget, type RelocateResult } from './opener.ts';
import { resolveAppCandidates, saveOverride } from './appResolver.ts';
import { fetchPageTitle } from './pageTitle.ts';
import { listBookmarkBrowsers, scanBookmarks } from './bookmarks.ts';
import { applyLayout, captureLayout, clearLayout, layoutCount } from './windowLayout.ts';
import { recordEntryOpen, recordFeature, type UsageFeature } from './usageStats.ts';
import { checkForUpdatesNow, getUpdateStatus, installDownloadedUpdate } from './updater.ts';
import { syncService } from './syncBridge.ts';
import { serverPort } from './serverPort.ts';
import { hidePalette, showMainWindow, switchToMain, switchToPalette } from './windowManager.ts';
import { notifySystem } from './notify.ts';
import { localStore } from './localStore.ts';
import { EntrySchema } from '../shared/schema/entry.ts';
import { SettingsSchema } from '../shared/schema/local.ts';
import type { Entry } from '../shared/schema/entry.ts';
import type { PersonalConfig, Settings } from '../shared/schema/local.ts';
import type {
  FeedbackDelivery,
  ImportCommitResult,
  ImportPreviewResult,
  OpenResult,
  PersonalSaveResult,
  PublishOutcome,
} from '../renderer/bridge/types.ts';
import { registerHotkeys, type HotkeyReport } from './hotkey.ts';
import { commitPersonalImport, personalService, previewPersonalImport, savePersonal } from './personalPort.ts';
import { identifyAsEntry, pickEntry, scanEntryPoints } from './picker.ts';
import { scanBrowsers } from './browsers.ts';
import { getProgramSnapshot, refreshPrograms } from './programIndex.ts';
import { ensureDeviceIdentity } from './deviceIdentity.ts';

const EMPTY_PERSONAL: PersonalConfig = { schemaVersion: 1, groups: [] };

/**
 * 读个人入口配置 —— **必须经 PersonalService**（schema 校验 + 损坏诊断），
 * 不能用 `localStore.personal` 裸读。
 *
 * 2026-10-17 实测的后果：`config/personal.json` 被手改坏（少字段 / 字段名写错）时，
 * 裸读把坏数据原样交给渲染层，界面在渲染入口时抛 `Cannot read properties of undefined
 * (reading 'replace')`——**整个主窗口白屏**，没有错误页、没有提示，看着就是"应用坏了"。
 * 仓库层早就返回 `{ config, corrupt, reason }` 且 `PersonalService.corruption()` 就是为此写的，
 * 只是这条通道一直没接（见 R25）。
 */
async function readPersonalSafe(): Promise<PersonalConfig> {
  try {
    return await personalService().load();
  } catch {
    // 连读都读不了（权限/IO）：按空处理，同样不把异常抛给界面。
    return EMPTY_PERSONAL;
  }
}

async function resolveEntry(entryId: string): Promise<Entry | undefined> {
  const team = syncService().snapshot().config;
  const inTeam = team?.groups.flatMap((g) => g.entries).find((e) => e.id === entryId);
  if (inTeam) return inTeam;
  const personal = await readPersonalSafe();
  return personal.groups.flatMap((g) => g.entries).find((e) => e.id === entryId);
}

function toOpenTarget(e: Entry): OpenTarget {
  if (e.type === 'web') return { kind: 'web', url: e.url };
  if (e.type === 'app') {
    // id 供本机"重新定位"缓存按入口存取（分层解析 2026-10-04）。
    return { id: e.id, kind: 'app', target: e.target, args: e.args ?? null, cwd: e.cwd ?? null, expandEnv: e.expandEnv };
  }
  return { kind: 'folder', target: e.target };
}

/** `tl:entries-icon` 的本会话结果缓存（键含图标引用：换表情会走新键）。 */
const iconMemo = new Map<string, string>();

async function extractEntryIcon(entry: Entry): Promise<string | null> {
  // 用户挑选的表情图标：内联 SVG 文本 → data URL。SVG 作为 <img> 源是静态的，
  // 不执行脚本；字符经过 schema 长度闸，此处无需再清洗。
  if (entry.icon.kind === 'emoji' && entry.icon.char) {
    const char = [...entry.icon.char].join('');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
      + '<text x="16" y="17" font-size="24" text-anchor="middle" dominant-baseline="central" '
      + "font-family=\"'Segoe UI Emoji','Noto Color Emoji',sans-serif\">" + char + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  if (entry.type === 'web') return null;
  const direct = await extractIcon(entry.target);
  if (direct) return direct;
  // 回退 1：快捷方式解析出的目标提取失败时，试原始 .lnk 的图标（部分 stub 程序没有图标资源）。
  if (entry.type === 'app' && entry.sourcePath && entry.sourcePath !== entry.target) {
    const viaSource = await extractIcon(entry.sourcePath);
    if (viaSource) return viaSource;
  }
  // 回退 2（2026-10-07，用户反馈老条目永远没图标）：目标路径本机不存在时，
  // 走与「打开」相同的分层解析（重定位缓存 → App Paths → 开始菜单索引），
  // 在解析出的真实程序上提取图标——老条目不用重新定位也能长出图标。
  if (entry.type === 'app') {
    const candidates = await resolveAppCandidates(entry.id, entry.target);
    for (const cand of candidates) {
      const icon = await extractIcon(cand.target);
      if (icon) return icon;
    }
  }
  return null;
}

/**
 * 个人入口变更广播（2026-10-21）。
 *
 * 快捷面板是**独立窗口**，各窗口的 preload 缓存与 React store 互不相通：
 * 主窗口刚加的入口，面板要到重启才看得见（用户实测"新添加的程序在快捷窗口搜不到"）。
 * 落盘成功后把规范配置推给其余窗口，它们的缓存与界面立刻跟上。
 */
function broadcastPersonal(config: PersonalConfig, sender?: Electron.WebContents): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (sender !== undefined && win.webContents === sender) continue;
    win.webContents.send('tl:personal', config);
  }
}

export interface IpcDeps {
  getWindows(): BrowserWindow[];
  onHotkey(report: HotkeyReport): void;
  /** 设置落盘后通知装配层：同步客户端据此换端点、换轮询间隔、开关遥测。 */
  onSettingsPatch(next: Settings): void;
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('tl:window', (_e, action: 'min' | 'max' | 'close') => {
    const win = deps.getWindows()[0];
    if (!win) return;
    if (action === 'min') win.minimize();
    else if (action === 'max') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else {
      /* 走窗口原生 close，让「托盘开启 → 收进托盘 / 托盘关闭 → 退出」的策略只有一处
         （windowManager 的 close 处理）。标题栏 X、Ctrl+W、Alt+F4 因此完全同义。 */
      win.close();
    }
  });

  ipcMain.handle('tl:entries-open', async (_e, entryId: string): Promise<OpenResult> => {
    const entry = await resolveEntry(entryId);
    if (!entry) return { ok: false, failure: 'UNKNOWN' };
    return openEntry(toOpenTarget(entry));
  });

  // 编辑态草稿的直接打开：草稿尚未发布，resolveEntry 按发布配置/个人配置都找不到它，
  // 管理员"发布前试一下"是正当需求。目标经 EntrySchema 校验后走同一 opener。
  ipcMain.handle('tl:entries-open-object', async (_e, raw: unknown): Promise<OpenResult> => {
    const gate = EntrySchema.safeParse(raw);
    if (!gate.success) return { ok: false, failure: 'UNKNOWN' };
    return openEntry(toOpenTarget(gate.data));
  });

  // 主页收藏：本机各存各的（config/favorites.json），不随团队同步。
  ipcMain.handle('tl:favorites-get', async () => localStore.favorites<unknown[]>([]));
  ipcMain.handle('tl:favorites-save', async (_e, list: unknown) => {
    await localStore.saveFavorites(list);
    return true;
  });

  /* 系统通知（2026-10-19）：渲染层决定"要不要打扰"，主进程负责发系统级 toast。
     点击通知默认把主窗口拿到前台，并回推一条 `tl:notice-click` 让界面做"去主页"这类收尾。 */
  ipcMain.handle('tl:notice', (_e, payload: unknown) => {
    const p = (payload ?? {}) as { title?: unknown; body?: unknown };
    if (typeof p.title !== 'string' || typeof p.body !== 'string') return false;
    return notifySystem({
      title: p.title,
      body: p.body,
      onClick: () => {
        showMainWindow();
        const win = deps.getWindows()[0];
        if (win && !win.isDestroyed()) win.webContents.send('tl:notice-click');
      },
    });
  });

  /* 连锁收藏（2026-10-19）：同样是本机文件（config/chains.json）。
     口径与 favorites 一致——渲染层给完整数组、主进程原子写盘；形状校验在渲染层 store 里做。 */
  ipcMain.handle('tl:chains-get', async () => localStore.chains<unknown[]>([]));
  ipcMain.handle('tl:chains-save', async (_e, list: unknown) => {
    await localStore.saveChains(list);
    return true;
  });

  /* 连锁的窗口位置记忆（2026-10-19 进阶）：记一次 / 启动时应用 / 查条数 / 清除。
     判定与落盘都在 main/windowLayout.ts（那里管 PowerShell 一次性调用与失败原因）。 */
  ipcMain.handle('tl:window-layout-capture', (_e, chainId: unknown, steps: unknown) =>
    captureLayout(app.getPath('userData'), String(chainId ?? ''), (steps ?? []) as Parameters<typeof captureLayout>[2]),
  );
  ipcMain.handle('tl:window-layout-apply', (_e, chainId: unknown, entryId: unknown) =>
    applyLayout(app.getPath('userData'), String(chainId ?? ''), String(entryId ?? '')),
  );
  ipcMain.handle('tl:window-layout-info', (_e, chainId: unknown) =>
    layoutCount(app.getPath('userData'), String(chainId ?? '')),
  );
  ipcMain.handle('tl:window-layout-clear', (_e, chainId: unknown) =>
    clearLayout(app.getPath('userData'), String(chainId ?? '')),
  );

  // 自动更新：用户点了「立即更新并重启」→ 静默安装 + 重启。
  ipcMain.handle('tl:app-update-install', () => installDownloadedUpdate());
  // 更新分发目录（管理员把构建产物放进来）：不存在就先建。
  ipcMain.handle('tl:app-updates-folder', async () => {
    const dir = join(app.getPath('userData'), 'updates');
    await mkdir(dir, { recursive: true });
    return (await shell.openPath(dir)).length === 0;
  });
  // 设置页的「检查更新」与状态行：手动跑一轮 + 读当前状态（都是显式调用，不走推送）。
  ipcMain.handle('tl:app-update-check', () => checkForUpdatesNow());
  ipcMain.handle('tl:app-update-status', () => getUpdateStatus());

  // 粘贴快捷添加（方案 A）的识别端：这段文本能不能直接成入口、是什么形态。只识别不落库。
  ipcMain.handle('tl:entries-identify', async (_e, text: string) => identifyAsEntry(String(text ?? '')));
  // 网页名称自动识别（2026-10-17）：只对"用户正在添加的那一个网址"取一次标题；
  // 失败/超时/非 HTML 一律返回 null，调用方回落到域名（纪律见 main/pageTitle.ts）。
  ipcMain.handle('tl:entries-page-title', async (_e, url: unknown) => fetchPageTitle(String(url ?? '')));
  // 本机用量统计（仅落本机文件、不上报、不进 UI）：入口点击结果 / 功能使用次数。
  // 负载只做最小校验；写失败静默（见 main/usageStats.ts）。
  ipcMain.handle('tl:usage-bump', async (_e, raw: unknown) => {
    const payload = raw as { kind?: unknown; key?: unknown; ok?: unknown } | null;
    const key = String(payload?.key ?? '').slice(0, 64);
    if (key.length === 0) return false;
    if (payload?.kind === 'entry') await recordEntryOpen(key, payload.ok !== false);
    else if (payload?.kind === 'feature') await recordFeature(key as UsageFeature);
    else return false;
    return true;
  });

  /* 浏览器书签（2026-10-17 起；2026-10-18 按用户要求拆成两步）：
     先「识别本机装了哪些 Chromium 系浏览器」（只 stat 目录，不读书签内容），
     用户选定某个浏览器后再读它那一份。**只读本机文件、只经 IPC 交给界面**，
     绝不进入同步/上报链路（见 main/bookmarks.ts）。 */
  ipcMain.handle('tl:bookmarks-browsers', () => listBookmarkBrowsers());
  ipcMain.handle('tl:bookmarks-scan', (_e, browserId: unknown) => scanBookmarks(browserId));

  // 更新日志（2026-10-17 批 5）：读随包的 CHANGELOG.md 交给设置·关于页渲染。
  // 打包版在 resources/CHANGELOG.md（extraResources），开发态读仓库根目录；读不到就返回 null，
  // 界面如实说明"随包版本读不到"而不是装作没有更新日志。
  ipcMain.handle('tl:app-changelog', async () => {
    const file = app.isPackaged
      ? join(process.resourcesPath, 'CHANGELOG.md')
      : join(app.getAppPath(), 'CHANGELOG.md');
    try {
      const text = await readFile(file, 'utf8');
      return text.length > 400_000 ? text.slice(0, 400_000) : text;
    } catch {
      return null;
    }
  });

  // 「在这台电脑上重新定位」（分层解析第 5 步）：选一次、本机记住（app-overrides.json，
  // 永不同步）、立刻尝试打开。取消不算失败，界面保持原状。
  ipcMain.handle('tl:entries-relocate', async (_e, raw: unknown): Promise<RelocateResult> => {
    const gate = EntrySchema.safeParse(raw);
    if (!gate.success) return { ok: false, reason: 'UNKNOWN' };
    const entry = gate.data;
    if (entry.type !== 'app') return { ok: false, reason: 'UNKNOWN' };
    const res = await dialog.showOpenDialog({
      title: `定位「${entry.name}」在这台电脑上的程序`,
      properties: ['openFile'],
      filters: [{ name: '程序', extensions: ['exe', 'lnk'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, reason: 'cancelled' };
    const picked = res.filePaths[0];
    let target = picked;
    let args = entry.args ?? '';
    let cwd = entry.cwd ?? '';
    if (/\.lnk$/i.test(picked)) {
      try {
        const link = shell.readShortcutLink(picked);
        if (link.target && link.target.length > 0) target = link.target;
        if (link.args) args = link.args;
        if (link.cwd) cwd = link.cwd;
      } catch {
        // 解析失败就按所选文件本身当程序路径
      }
    }
    await saveOverride(entry.id, { target, args: args || undefined, cwd: cwd || undefined });
    const r = await openEntry(toOpenTarget({ ...entry, target, args, cwd }));
    return r.ok ? { ok: true } : { ok: false, reason: r.failure };
  });

  // 图标提取直收入口对象（渲染层已过 schema 校验）：团队入口的编辑草稿/未发布改动
  // 在 resolveEntry 里反查不到（它只认已发布配置与个人落盘），按 id 查会拿到旧引用
  // （已发布的表情）或 null（草稿新建），换图标永远"不生效"。提取只读路径取图标、
  // 不执行程序；这里再过一次 schema 闸防结构异常的数据，字符串入参走旧反查兜底。
  ipcMain.handle('tl:entries-icon', async (_e, raw: unknown) => {
    const gate = EntrySchema.safeParse(raw);
    const entry = gate.success ? gate.data : typeof raw === 'string' ? await resolveEntry(raw) : undefined;
    if (!entry) return null;
    /* 本会话的图标结果缓存（2026-10-21）：快捷面板与主窗口各有一份渲染层缓存，
       主进程此前每次都重新提取——两个窗口对同一份清单各取一遍，正好把 shell 图标链打满。
       只缓存成功值：取不到的下次重试（`getFileIcon` 对个别 exe 会瞬时失败）。 */
    const memoKey = [
      entry.type,
      entry.icon.kind,
      entry.icon.kind === 'emoji' ? entry.icon.char : '',
      entry.type === 'web' ? entry.url : entry.target,
      entry.type === 'app' ? (entry.sourcePath ?? '') : '',
    ].join('|');
    const memo = iconMemo.get(memoKey);
    if (memo !== undefined) return memo;
    const icon = await extractEntryIcon(entry);
    if (icon !== null) iconMemo.set(memoKey, icon);
    return icon;
  });

  ipcMain.handle('tl:entries-copy', async (_e, entryId: string) => {
    const entry = await resolveEntry(entryId);
    if (!entry) return false;
    clipboard.writeText(entry.type === 'web' ? entry.url : entry.target);
    return true;
  });

  /**
   * 多选批量复制：逐个取目标后**一次**写入多行。
   * 渲染层循环调单条通道只会互相覆盖剪贴板（最后只剩一条），所以必须一条通道办完。
   * 入口对象在渲染层已经过 schema，这里再校验一次（与 openObject 同一纪律）。
   */
  ipcMain.handle('tl:entries-copy-many', (_e, raw: unknown) => {
    const list = Array.isArray(raw) ? raw : [];
    const lines: string[] = [];
    for (const item of list) {
      const gate = EntrySchema.safeParse(item);
      if (!gate.success) continue;
      lines.push(gate.data.type === 'web' ? gate.data.url : gate.data.target);
    }
    if (lines.length === 0) return false;
    clipboard.writeText(lines.join('\n'));
    return true;
  });

  ipcMain.handle('tl:entries-reveal', async (_e, entryId: string) => {
    const entry = await resolveEntry(entryId);
    if (!entry || entry.type === 'web') return;
    shell.showItemInFolder(entry.target);
  });

  ipcMain.handle('tl:entries-open-external', (_e, url: string) => openUrl(url));

  ipcMain.handle('tl:sync-snapshot', () => syncService().snapshot());
  /** 渲染层挂载后主动拉一次：preload 预热缓存与首帧之间有竞态，拉取兜底保证首帧即真值。 */
  ipcMain.handle('tl:sync-pull', () => syncService().snapshot());
  ipcMain.handle('tl:sync-refresh', async () => {
    await syncService().refresh();
  });

  ipcMain.handle('tl:settings-get', () => localStore.settings<Settings | null>(null));
  ipcMain.handle('tl:settings-patch', async (_e, patch: Partial<Settings>) => {
    const current = await localStore.settings<Partial<Settings>>({});
    // 落盘前必须过 schema：否则稀疏合并结果直接写盘，从未写过的字段（自启/托盘/热键等）
    // 连同它们的默认值一起消失——托盘被销毁、用户改过的热键被重置，都是这条漏出来的。
    // 手改损坏的 current 也在 schema 处被兜住：parse 失败就整体回落默认值再合并。
    // current 整体损坏（如时间戳格式非法）时按字段回落默认值，本次 patch 照常生效——
    // 否则用户永远无法通过界面修复损坏的设置文件。
    const storedGate = SettingsSchema.safeParse(current);
    const base = storedGate.success ? storedGate.data : SettingsSchema.parse({});
    const next = SettingsSchema.parse({ ...base, ...patch });
    await localStore.saveSettings(next);
    // 开机自启真实现：注册当前可执行文件。开发态（未打包）不写系统启动项，
    // 否则每次开发都会把 electron.exe 挂进登录项——开关仍落盘，打包后即生效。
    if ('autoLaunch' in patch && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: next.autoLaunch });
    }
    // 界面缩放走浏览器式 zoomFactor：窗口尺寸不变，字体与内部 UI 等比缩放重排。
    // 只作用于发起调用的窗口（迷你面板窗口保持 100%）。
    if ('uiZoom' in patch) {
      BrowserWindow.fromWebContents(_e.sender)?.webContents.setZoomFactor(next.uiZoom / 100);
    }
    deps.onSettingsPatch(next);
    if ('hotkey' in patch || 'searchHotkey' in patch) {
      /* 两个全局键必须整组重注册：hotkey.ts 内部先 unregisterAll，
         只注册改动的那个会把另一个悄悄注销（单键时代遗留的坑）。 */
      registerHotkeys(
        { surface: next.hotkey, search: next.searchHotkey },
        deps.getWindows()[0] ?? null,
        (report) => deps.onHotkey(report),
      );
    }
    return next;
  });

  // 设备标识：settings.json 同级的 identity.json，首次调用即生成并持久化。
  ipcMain.handle('tl:device-id', async () => {
    const identity = await ensureDeviceIdentity(app.getPath('userData'));
    return identity.deviceId;
  });

  ipcMain.handle('tl:personal-get', () => readPersonalSafe());
  /* 文件损坏诊断（R25）：损坏时上面会回落成空配置——那看起来和"你没有个人入口"一模一样，
     所以必须有一条通道让界面**如实说明**"文件读不了"，而不是安静地显示空列表。 */
  ipcMain.handle('tl:personal-corruption', () => personalService().corruption());
  ipcMain.handle('tl:personal-save', async (e, config: unknown): Promise<PersonalSaveResult> => {
    const result = await savePersonal(config);
    // 其它窗口（含快捷面板）必须立刻看到新清单，否则"加了但搜不到"。
    if (result.ok) broadcastPersonal(result.config, e.sender);
    return result;
  });

  ipcMain.handle('tl:personal-export', async () => {
    /* 损坏时拒绝导出：导出"空配置"会被读成"我的入口本来就是空的"，
        比直接说清楚更糟（文件在磁盘上原样没动，用户可以自己修/找回来）。 */
    const corruption = await personalService().corruption();
    if (corruption.corrupt) {
      return { ok: false as const, reason: `个人入口文件无法读取（${corruption.reason ?? '未知原因'}），导出已取消；原文件未做任何改动` };
    }
    const config = await readPersonalSafe();
    const count = config.groups.reduce((n, g) => n + g.entries.length, 0);
    const res = await dialog.showSaveDialog({
      title: '导出我的入口',
      defaultPath: `我的入口-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false as const, reason: '已取消' };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(res.filePath, JSON.stringify(config, null, 2), 'utf8');
    return { ok: true as const, path: res.filePath, count };
  });

  // 导入两段式：先预览（不落盘），冲突逐项决定后再提交。顺序不可颠倒。
  // 判定逻辑在 personalPort（真值读磁盘），这里只做通道注册。
  // （旧的一次性 'tl:personal-import' 已删除：它只选文件不落盘，被两段式取代。）
  ipcMain.handle('tl:personal-import-preview', (_e, req: unknown): Promise<ImportPreviewResult> =>
    previewPersonalImport(req),
  );
  ipcMain.handle('tl:personal-import-commit', async (e, req: unknown): Promise<ImportCommitResult> => {
    const result = await commitPersonalImport(req);
    // 导入同样是一次落盘：别的窗口要同步刷新（与保存同一条纪律）。
    if (result.kind === 'applied') broadcastPersonal(result.config, e.sender);
    return result;
  });

  ipcMain.handle('tl:feedback-submit', async (_e, item: unknown): Promise<FeedbackDelivery> =>
    serverPort.submitFeedback({ items: [item as never] }),
  );

  ipcMain.handle('tl:publish', async (_e, req: unknown): Promise<PublishOutcome> =>
    serverPort.publish(req as never),
  );

  ipcMain.handle('tl:diagnostics', () => serverPort.diagnostics());
  ipcMain.handle('tl:diagnostics-repair', () => serverPort.repairFirewall());
  ipcMain.handle('tl:admin-unlock', async (_e, passphrase: string) => ({
    ok: await serverPort.verifyAdmin(passphrase),
  }));
  // status → enroll → unlock 三者是一套：没有 status，全新安装的机器没有任何
  // 途径写入口令（用户输什么都是"口令不对"）。顺序不可颠倒。
  ipcMain.handle('tl:admin-status', () => serverPort.adminStatus());
  ipcMain.handle('tl:admin-enroll', (_e, passphrase: string) => serverPort.enrollAdmin(passphrase));

  // 入口采集：这两条此前界面上有菜单、后端却从未实现，点了没反应。
  ipcMain.handle('tl:entries-pick', (_e, kind: 'app' | 'folder') => pickEntry(kind));
  ipcMain.handle('tl:entries-scan', () => scanEntryPoints());

  /* 本机程序索引（2026-10-24）：快捷窗口搜索用。索引不是入口——不落个人配置、
     不占容量、不同步；用户按 Ctrl+回车才走既有添加流程把它变成入口。 */
  ipcMain.handle('tl:programs-snapshot', () => getProgramSnapshot());
  ipcMain.handle('tl:programs-refresh', () => refreshPrograms('manual'));

  // 「设置 · 通用 · 打开网页的浏览器」的候选：只读注册表，不写任何东西。
  ipcMain.handle('tl:browsers-scan', () => scanBrowsers());

  // 迷你面板窗口的收起动作（Esc / 点击面板外）由渲染层发回主进程执行。
  ipcMain.handle('tl:palette-hide', () => {
    hidePalette();
  });

  /**
   * 「进入主窗口」（2026-10-18 用户要求）：面板收起 → 主窗口还原（若最小化）→ 显示并聚焦。
   * 与 quickAdd 的区别是它**不改动任何数据**——只是把用户带到主界面。
   * 2026-10-27（1.2.0）：互斥与 activeSurface 统一收进 windowManager（surface-machine.ts 判定）。
   */
  ipcMain.handle('tl:palette-open-main', () => switchToMain());

  /**
   * 主窗口 Ctrl+Tab → 快捷面板（2026-10-21 用户要求「主窗口和快捷搜索栏互换」）。
   * 2026-10-27（1.2.0）：两面互斥收进 windowManager——托盘开着时主窗口进托盘，
   * 托盘关着时最小化；无论哪种都不会再出现「面板盖在主窗口上」的共存状态。
   */
  ipcMain.handle('tl:palette-show', () => switchToPalette());

  /**
   * 剪贴板读取（快捷搜索面板的剪贴板候选行）：只读文本，**不落库、不写日志**。
   * 单条判定（含换行就不认）在渲染层做——它同时要按当前清单去重。
   */
  ipcMain.handle('tl:clipboard-read', () => clipboard.readText());

  /**
   * 面板里"加为入口"：面板窗口自己装不下对话框（那边只有面板一套组件），
   * 所以收起面板 → 唤起并聚焦主窗口 → 把文本推给主窗口，
   * 由主窗口走与 Ctrl+V 粘贴添加**同一套**预填编辑器流程。
   */
  ipcMain.handle('tl:palette-quick-add', (_e, text: unknown) => {
    const main = deps.getWindows()[0];
    if (!main || main.isDestroyed()) return false;
    /* showMainWindow 会先收面板、再还原/显示/聚焦，互斥与「activeSurface 归主窗口」
       都由它统一处理；这里不再手写一套窗口动作。 */
    showMainWindow();
    main.webContents.send('tl:quick-add', String(text ?? ''));
    return true;
  });

  // 浏览器式缩放：只作用于发起调用的窗口（迷你面板保持 100%）。
  ipcMain.handle('tl:window-zoom', (_e, zoomPercent: number) => {
    const z = Math.min(150, Math.max(80, Number(zoomPercent) || 100));
    BrowserWindow.fromWebContents(_e.sender)?.webContents.setZoomFactor(z / 100);
  });

  ipcMain.handle('tl:clipboard-write', (_e, text: string) => {
    clipboard.writeText(text);
    return true;
  });
}
