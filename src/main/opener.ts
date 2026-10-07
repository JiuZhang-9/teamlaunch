/**
 * 打开入口 —— K-04 / K-05 / K-07 三条硬约束的落点。
 *
 *  K-04：路径含空格、中文、特殊字符。无参一律走 `shell.openPath`（不拼命令）；
 *        带参一律 `spawn(target, args[], { shell: false })`，绝不 `exec` + `shell:true`。
 *  K-05：禁止一切 `*Sync` IO —— UNC 下线路径的同步调用可阻塞主线程数十秒。
 *  K-07：网页一律走**外部浏览器**。内置 Chromium 是独立 profile，内网 SSO 会失效。
 */
import { shell, app } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { access, constants, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAppCandidates } from './appResolver.ts';

export type OpenFailure =
  | 'NOT_INSTALLED'
  | 'PATH_MISSING'
  | 'NO_PERMISSION'
  | 'INVALID_URL'
  | 'LINK_UNAVAILABLE'
  | 'UNKNOWN';

export type OpenResult = { ok: true } | { ok: false; failure: OpenFailure };

export interface OpenTarget {
  /** 团队入口 id：本机"重新定位"缓存按它存取（per-machine，永不同步）。 */
  id?: string;
  kind: 'app' | 'folder' | 'web';
  target?: string;
  url?: string;
  args?: string | null;
  cwd?: string | null;
  expandEnv?: boolean;
}

export type RelocateResult = { ok: true } | { ok: false; reason: 'cancelled' | OpenFailure };

const HAS_TIMEOUT_MS = 3000;

/** 存在性/权限探测。带超时，避免 UNC 下线路径把主线程拖死（K-05）。picker 的识别也复用它。 */
export async function probe(p: string): Promise<'ok' | 'missing' | 'denied'> {
  try {
    await withTimeout(access(p, constants.F_OK), HAS_TIMEOUT_MS);
    await withTimeout(access(p, constants.R_OK | constants.X_OK), HAS_TIMEOUT_MS);
    return 'ok';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENETUNREACH') return 'missing';
    if (code === 'EACCES' || code === 'EPERM') return 'denied';
    if (code === 'TL_TIMEOUT') return 'missing';
    return 'missing';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TL_TIMEOUT' })), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function expand(str: string): string {
  return str.replace(/%([^%]+)%/g, (_m, name: string) => process.env[name] ?? `%${name}%`);
}

export async function openEntry(t: OpenTarget): Promise<OpenResult> {
  if (t.kind === 'web') {
    return openUrl(t.url ?? '');
  }

  const raw = t.target ?? '';
  if (!raw.trim()) return { ok: false, failure: 'PATH_MISSING' };
  const target = t.expandEnv ? expand(raw) : raw;

  const state = await probe(target);
  if (state === 'missing') {
    if (t.kind === 'app') {
      // 分层解析（2026-10-04 用户拍板 2/3/5）：本机重新定位缓存 → App Paths 注册表 → 开始菜单索引。
      // 管理员下发的路径只是线索；解析出的候选仍要逐个过探测，第一个真实存在的才执行。
      const candidates = await resolveAppCandidates(t.id ?? '', target);
      for (const cand of candidates) {
        const s = await probe(cand.target);
        if (s === 'ok') return launchExe(cand.target, t.args ?? '', t.cwd);
        if (s === 'denied') return { ok: false, failure: 'NO_PERMISSION' };
      }
      return { ok: false, failure: 'NOT_INSTALLED' };
    }
    return { ok: false, failure: 'PATH_MISSING' };
  }
  if (state === 'denied') {
    return { ok: false, failure: 'NO_PERMISSION' };
  }

  return launchExe(target, t.args ?? '', t.cwd);
}

/** 无参走 shell.openPath（不拼命令），带参走 spawn 数组传参——路径含空格/中文不被吃掉（K-04）。 */
function launchExe(target: string, args: string, cwd?: string | null): Promise<OpenResult> {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return shell.openPath(target).then((err) => (err ? { ok: false, failure: 'UNKNOWN' } : { ok: true }));
  }
  return new Promise<OpenResult>((resolve) => {
    const child = spawn(target, splitArgs(trimmed), {
      shell: false,
      cwd: cwd || undefined,
      detached: false,
    });
    child.once('error', () => resolve({ ok: false, failure: 'UNKNOWN' }));
    child.once('spawn', () => resolve({ ok: true }));
  });
}

export function openUrl(url: string): OpenResult {
  if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, failure: 'INVALID_URL' };
  void shell.openExternal(url);
  return { ok: true };
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** 本机图标提取：data URL。K-08 —— 只在本机提取，绝不跨网同步。 */
export async function extractIcon(pathLike: string, size: 'small' | 'large' = 'large'): Promise<string | null> {
  try {
    const icon = await withTimeout(app.getFileIcon(pathLike, { size }), HAS_TIMEOUT_MS);
    if (icon.isEmpty()) return null;
    const url = icon.toDataURL();
    // 个别 exe（实测 ima.copilot.exe）的 RT_ICON 是 PNG 压缩格式，shell 图标缓存
    // 链（SHGetFileInfo 系）对它返回"默认应用程序图"，而资源里明明有真图标。
    // 判定基准：对空 .exe 提取一次（shell 对无法解析的 exe 必给同一张默认图），
    // 结果相同即视为"shell 给了假图"，改走 ExtractAssociatedIcon 兜底提取真图。
    const basis = await defaultAppIcon(size);
    if (!basis || url !== basis) return url;
    const fallback = await extractIconViaShellAssoc(pathLike, size);
    return fallback ?? url;
  } catch {
    return null;
  }
}

/** "默认应用程序图"基准（空 .exe 提取一次并缓存；null=探测失败，不启用判定）。 */
let defaultAppIconCache: Record<'small' | 'large', string | null> | undefined;
async function defaultAppIcon(size: 'small' | 'large'): Promise<string | null> {
  if (!defaultAppIconCache) defaultAppIconCache = { small: null, large: null };
  if (defaultAppIconCache[size] !== null || defaultAppIconCache[size] === '') return defaultAppIconCache[size];
  try {
    const dir = await mkdtemp(path.join(tmpdir(), 'tl-icon-basis-'));
    const probe = path.join(dir, 'basis.exe');
    await writeFile(probe, Buffer.alloc(0));
    const icon = await withTimeout(app.getFileIcon(probe, { size }), HAS_TIMEOUT_MS);
    defaultAppIconCache[size] = icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    defaultAppIconCache[size] = null;
  }
  return defaultAppIconCache[size];
}

/**
 * 兜底提取：PowerShell ExtractAssociatedIcon。与 getFileIcon 同为 shell 层但
 * 不吃坏缓存（实测前者给真图、后者给默认图）。结果按 路径+mtime 持久缓存成
 * dataURL 文本——PS 冷启动数百毫秒，每个可疑 exe 只承担一次。
 */
async function extractIconViaShellAssoc(pathLike: string, size: 'small' | 'large'): Promise<string | null> {
  try {
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(pathLike)).mtimeMs;
    } catch {
      return null;
    }
    const cacheDir = path.join(app.getPath('userData'), 'icon-cache');
    const key = createHash('sha256').update(`${pathLike.toLowerCase()}|${mtimeMs}|${size}`).digest('hex').slice(0, 24);
    const cacheFile = path.join(cacheDir, `${key}.txt`);
    try {
      const cached = await readFile(cacheFile, 'utf8');
      if (cached.startsWith('data:image/')) return cached;
    } catch {
      // 未命中，走提取
    }
    const png = path.join(tmpdir(), `tl-icon-${key}.png`);
    const script =
      `Add-Type -AssemblyName System.Drawing;` +
      `$i=[System.Drawing.Icon]::ExtractAssociatedIcon('${pathLike.replace(/'/g, "''")}');` +
      `$i.ToBitmap().Save('${png.replace(/'/g, "''")}',[System.Drawing.Imaging.ImageFormat]::Png)`;
    const res = await withTimeout(
      new Promise<string | null>((resolve) => {
        execFile(
          `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 8000, windowsHide: true },
          (err) => resolve(err ? null : png),
        );
      }),
      9000,
    ).catch(() => null);
    if (!res) return null;
    const bytes = await readFile(png);
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, dataUrl, 'utf8');
    await rm(png, { force: true });
    return dataUrl;
  } catch {
    return null;
  }
}
