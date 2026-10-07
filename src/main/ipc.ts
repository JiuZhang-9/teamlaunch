/**
 * IPC 处理器 —— `window.tl` 抽象层在主进程侧的另一端。
 *
 * 约定：渲染层不 import electron、不直连 HTTP、不做本机 IO，全部经这里。
 * 因此本文件是"能力边界"：任何新能力先在这里定义通道，再在 preload 暴露。
 */
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extractIcon, openEntry, openUrl, type OpenTarget, type RelocateResult } from './opener.ts';
import { resolveAppCandidates, saveOverride } from './appResolver.ts';
import { installDownloadedUpdate } from './updater.ts';
import { syncService } from './syncBridge.ts';
import { serverPort } from './serverPort.ts';
import { hidePalette } from './windowManager.ts';
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
import { registerHotkey, type HotkeyStatus } from './hotkey.ts';
import { commitPersonalImport, previewPersonalImport, savePersonal } from './personalPort.ts';
import { identifyAsEntry, pickEntry, scanStartMenu } from './picker.ts';
import { ensureDeviceIdentity } from './deviceIdentity.ts';

const EMPTY_PERSONAL: PersonalConfig = { schemaVersion: 1, groups: [] };

async function resolveEntry(entryId: string): Promise<Entry | undefined> {
  const team = syncService().snapshot().config;
  const inTeam = team?.groups.flatMap((g) => g.entries).find((e) => e.id === entryId);
  if (inTeam) return inTeam;
  const personal = await localStore.personal<PersonalConfig>(EMPTY_PERSONAL);
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

export interface IpcDeps {
  getWindows(): BrowserWindow[];
  /** 关闭主窗口是否"隐藏到托盘"。false 时 X = 真退出（PRD 11.5：关闭托盘常驻时关窗含义必须明确）。 */
  closeToTray(): boolean;
  onHotkey(status: HotkeyStatus, accelerator: string): void;
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
    } else if (deps.closeToTray()) win.hide();
    else app.quit();
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

  // 自动更新：用户点了「立即更新并重启」→ 静默安装 + 重启。
  ipcMain.handle('tl:app-update-install', () => installDownloadedUpdate());
  // 更新分发目录（管理员把构建产物放进来）：不存在就先建。
  ipcMain.handle('tl:app-updates-folder', async () => {
    const dir = join(app.getPath('userData'), 'updates');
    await mkdir(dir, { recursive: true });
    return (await shell.openPath(dir)).length === 0;
  });

  // 粘贴快捷添加（方案 A）的识别端：这段文本能不能直接成入口、是什么形态。只识别不落库。
  ipcMain.handle('tl:entries-identify', async (_e, text: string) => identifyAsEntry(String(text ?? '')));

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
  });

  ipcMain.handle('tl:entries-copy', async (_e, entryId: string) => {
    const entry = await resolveEntry(entryId);
    if (!entry) return false;
    clipboard.writeText(entry.type === 'web' ? entry.url : entry.target);
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
    if ('hotkey' in patch) {
      const r = registerHotkey(patch.hotkey ?? null, deps.getWindows()[0] ?? null, (report) =>
        deps.onHotkey(report.status, report.accelerator),
      );
      deps.onHotkey(r.status, r.accelerator);
    }
    return next;
  });

  // 设备标识：settings.json 同级的 identity.json，首次调用即生成并持久化。
  ipcMain.handle('tl:device-id', async () => {
    const identity = await ensureDeviceIdentity(app.getPath('userData'));
    return identity.deviceId;
  });

  ipcMain.handle('tl:personal-get', () => localStore.personal<PersonalConfig>(EMPTY_PERSONAL));
  ipcMain.handle('tl:personal-save', (_e, config: unknown): Promise<PersonalSaveResult> =>
    savePersonal(config),
  );

  ipcMain.handle('tl:personal-export', async () => {
    const config = await localStore.personal<PersonalConfig>(EMPTY_PERSONAL);
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
  ipcMain.handle('tl:personal-import-commit', (_e, req: unknown): Promise<ImportCommitResult> =>
    commitPersonalImport(req),
  );

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
  ipcMain.handle('tl:entries-scan', () => scanStartMenu());

  // 迷你面板窗口的收起动作（Esc / 点击面板外）由渲染层发回主进程执行。
  ipcMain.handle('tl:palette-hide', () => {
    hidePalette();
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
