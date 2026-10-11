/**
 * 入口采集 —— 从本机选择程序 / 文件夹，以及扫描入口点（开始菜单 / 桌面 / 任务栏 / 已安装程序）。
 *
 * 这两项此前只有界面上的一句提示，**后端能力从未实现**：
 * 个人页面的「从本机添加软件」「扫描本机程序」点了没反应。
 * 这里补齐真实实现（P0-07 个人入口管理、P0-12 入口采集）。
 */
import { app, dialog, shell } from 'electron';
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { probe as probePath } from './opener.ts';

export interface PickResult {
  ok: boolean;
  kind: 'app' | 'folder';
  /** 建议的显示名（去掉 exe / lnk 后缀） */
  name: string;
  /** 实际目标：快捷方式会被解析成真实 exe 路径；文件夹即其本身 */
  target: string;
  /** 原始选择路径（.lnk 时保留原路径，便于将来重新解析） */
  sourcePath: string;
  reason?: string;
}

export interface ScanCandidate {
  name: string;
  target: string;
  sourcePath: string;
  /** 来源标签（只用于界面标注，不参与去重）：开始菜单 / 桌面 / 任务栏 / 已安装程序。 */
  source?: string;
}

export interface ScanResult {
  ok: boolean;
  items: ScanCandidate[];
  reason?: string;
}

/** 扫描上限：入口点可能有几百个，全量塞进界面没有意义（对话框里还有搜索）。 */
const SCAN_LIMIT = 300;
const SCAN_MAX_DEPTH = 4;

function displayName(p: string): string {
  return path.basename(p).replace(/\.(exe|lnk)$/i, '');
}

/** 「只有版本号 / 只有位数」这类残名（1.4.0、2022.0.7、2018、(x64)、64-bit)）。 */
const VERSION_ONLY = /^\d+(\.\d+)*$/;
const BIT_ONLY = /^[(_\-\s]*(x64|x86|64-bit|32-bit|64|32)[)_\-\s]*$/i;
/** 这些名字进来只会让列表没法用：卸载/修复/更新/说明之类不是程序本体。 */
const NOISE_EXACT = new Set([
  '安装程序', 'setup', 'install', 'installer', 'update', 'updater', 'repair', '修复',
  'readme', '说明', '帮助', 'help', 'license', '许可', '关于', 'about', '卸载', '更多',
]);

function isNoiseName(name: string): boolean {
  const n = name.trim();
  if (n.length === 0) return true;
  if (n.includes('卸载') || /uninstall/i.test(n)) return true;
  if (NOISE_EXACT.has(n.toLowerCase())) return true;
  if (VERSION_ONLY.test(n) || BIT_ONLY.test(n)) return true;
  return false;
}

export type IdentifyResult =
  | { kind: 'web'; url: string; name: string }
  | { kind: 'app'; target: string; sourcePath: string | null; args: string | null; name: string }
  | { kind: 'folder'; target: string; name: string }
  | { kind: 'none'; reason: string };

/**
 * 剪贴板快捷添加（方案 A）的识别端：一段文本能不能直接成入口、是什么形态。
 * 只识别、不落库——落库仍走「添加入口」对话框与既有容量闸/校验。
 * 探测复用 opener 的异步 probe（K-05：禁止同步 IO，UNC 掉线不能拖死主进程）。
 */
export async function identifyAsEntry(raw: string): Promise<IdentifyResult> {
  const text = String(raw ?? '').trim();
  if (/^https?:\/\/\S+\.\S+/i.test(text)) {
    let host = text;
    try {
      host = new URL(text).hostname.replace(/^www\./i, '');
    } catch {
      // 取不到主机名就用原链接兜底展示
    }
    return { kind: 'web', url: text, name: host };
  }
  if (!/^(?:[A-Za-z]:[\\/]|\\)/.test(text)) {
    return { kind: 'none', reason: '剪贴板里没有可识别的网址或路径' };
  }
  const p = text.replace(/\//g, '\\'); // 正斜杠统一为反斜杠（Windows 路径形态）
  const st = await probePath(p);
  if (st === 'missing') return { kind: 'none', reason: '这个路径在这台电脑上不存在' };
  if (st === 'denied') return { kind: 'none', reason: '没有权限访问这个路径' };
  const info = await stat(p);
  if (info.isDirectory()) return { kind: 'folder', target: p, name: path.basename(p) };
  if (/\.lnk$/i.test(p)) {
    try {
      const link = shell.readShortcutLink(p);
      if (link.target && link.target.length > 0) {
        return { kind: 'app', target: link.target, sourcePath: p, args: link.args || null, name: displayName(p) };
      }
    } catch {
      // 解析失败就按原路径当程序处理（交给系统打开仍然可用）
    }
    return { kind: 'app', target: p, sourcePath: p, args: null, name: displayName(p) };
  }
  if (/\.exe$/i.test(p)) return { kind: 'app', target: p, sourcePath: p, args: null, name: displayName(p) };
  return { kind: 'none', reason: '只支持网址、程序（exe/lnk）或文件夹' };
}

/**
 * 打开系统选择框。
 *
 * 注意：一个对话框不能同时选文件和文件夹（Windows 限制），
 * 所以由调用方先决定 kind，再打开对应的选择框。
 */
export async function pickEntry(kind: 'app' | 'folder'): Promise<PickResult> {
  const res = await dialog.showOpenDialog({
    title: kind === 'app' ? '选择要添加的软件' : '选择要添加的文件夹',
    properties: kind === 'app' ? ['openFile'] : ['openDirectory'],
    filters: kind === 'app' ? [{ name: '程序', extensions: ['exe', 'lnk'] }] : undefined,
  });

  if (res.canceled || res.filePaths.length === 0) {
    return { ok: false, kind, name: '', target: '', sourcePath: '', reason: '已取消' };
  }

  const sourcePath = res.filePaths[0];

  // 快捷方式：解析出真实目标，同时保留 .lnk 原始路径
  let target = sourcePath;
  if (kind === 'app' && /\.lnk$/i.test(sourcePath)) {
    try {
      const link = shell.readShortcutLink(sourcePath);
      if (link.target && link.target.length > 0) target = link.target;
    } catch {
      // 解析失败就用 .lnk 本身：交给系统打开仍然可用
    }
  }

  return { ok: true, kind, name: displayName(sourcePath), target, sourcePath };
}

/** 快捷方式（.lnk）目录：开始菜单（公共 + 用户）、任务栏固定项、桌面（公共 + 用户）。 */
function shortcutRoots(): Array<[string, string]> {
  const roots: Array<[string, string]> = [];
  const common = process.env.ProgramData;
  if (common) {
    roots.push([path.join(common, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), '开始菜单']);
    roots.push([path.join(common, 'Desktop'), '桌面']);
  }
  try {
    const appData = app.getPath('appData');
    roots.push([path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), '开始菜单']);
    roots.push([path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'), '任务栏']);
    roots.push([app.getPath('desktop'), '桌面']);
  } catch {
    // 拿不到用户目录就只扫公共目录
  }
  return roots;
}

/** 深挖一个目录里的 .lnk → 真实 exe（开始菜单是树，桌面/任务栏通常只有一层）。 */
async function walkShortcuts(
  dir: string,
  found: Map<string, ScanCandidate>,
  source: string,
  depth: number,
): Promise<void> {
  if (depth > SCAN_MAX_DEPTH || found.size >= SCAN_LIMIT) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.size >= SCAN_LIMIT) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkShortcuts(full, found, source, depth + 1);
      continue;
    }
    if (!/\.lnk$/i.test(entry.name)) continue;

    let target = '';
    try {
      const link = shell.readShortcutLink(full);
      if (link.target && /\.exe$/i.test(link.target)) target = link.target;
    } catch {
      continue;
    }
    if (!target) continue;
    // 同一目标只保留一个（先去重者胜：开始菜单 > 桌面 > 任务栏 > 已安装程序）
    if (found.has(target)) continue;
    const name = displayName(entry.name);
    if (isNoiseName(name)) continue;
    found.set(target, { name, target, sourcePath: full, source });
  }
}

/** DisplayIcon → exe 路径：去掉两侧引号与结尾的图标索引（形如 `,0`）。 */
function exeFromDisplayIcon(raw: string): string | null {
  const cleaned = raw.replace(/,\s*-?\d+\s*$/, '').replace(/^"+|"+$/g, '').trim();
  return /\.exe$/i.test(cleaned) ? cleaned : null;
}

/**
 * 系统 ANSI 代码页 → 解码器（读注册表/控制台输出必须按它解码）。
 *
 * 为什么必须有这一层：`reg.exe` 这类 **Windows 控制台程序**的输出是按**系统代码页**编码的
 * （中文 Windows = 936/GBK），而 Node 拿回字节后默认按 **UTF-8** 解 —— 中文名会变成乱码
 * （2026-10-11 用户实测：「已安装程序」里的名字出现 `ДК◆◆` 这类形状）。
 * 开始菜单那部分走的是快捷方式文件名/系统 API，不经过控制台输出，所以一直正常；
 * 项目里另一处 `reg query`（应用路径解析）只读英文路径，所以这个坑一直没暴露。
 */
function decoderForCodePage(acp: number): TextDecoder | null {
  const label =
    acp === 936 ? 'gbk'
    : acp === 950 ? 'big5'
    : acp === 932 ? 'shift_jis'
    : acp === 949 ? 'euc-kr'
    : acp >= 1250 && acp <= 1258 ? `windows-${acp}`
    : null;
  if (label === null) return null;
  try {
    return new TextDecoder(label);
  } catch {
    // 运行时没带这个解码器（无完整 ICU）→ 退回 UTF-8
    return null;
  }
}

let ansiDecoderPromise: Promise<TextDecoder | null> | null = null;

/** 取本机 ANSI 代码页（每会话一次，缓存）：ACP 值本身是 ASCII，不存在解码递归。 */
function ansiDecoder(): Promise<TextDecoder | null> {
  if (ansiDecoderPromise === null) {
    ansiDecoderPromise = (async () => {
      const bytes = await regQueryBytes(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP']);
      if (bytes === null) return null;
      const m = /REG_SZ\s+(\d+)/.exec(bytes.toString('latin1'));
      if (m === null) return null;
      return decoderForCodePage(Number(m[1]));
    })();
  }
  return ansiDecoderPromise;
}

/** 跑一次 reg query，拿**原始字节**（解码交给调用方；数组传参 + 超时，K-04/K-05 同款纪律）。 */
function regQueryBytes(args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      args,
      { timeout: 4000, windowsHide: true, encoding: 'buffer' },
      (err, stdout) => resolve(err ? null : (stdout as unknown as Buffer)),
    );
  });
}

/** 按系统代码页解控制台输出；拿不到代码页就退回 UTF-8（纯 ASCII 内容两者一致）。 */
async function decodeConsoleOutput(bytes: Buffer): Promise<string> {
  const decoder = await ansiDecoder();
  return decoder !== null ? decoder.decode(bytes) : bytes.toString('utf8');
}

/** 读注册表 Uninstall 键（读键，不遍历磁盘）→ DisplayName / DisplayIcon。 */
async function regQueryUninstall(key: string): Promise<Array<{ name: string; icon: string }>> {
  const bytes = await regQueryBytes(['query', key, '/s']);
  if (bytes === null) return [];
  const out = await decodeConsoleOutput(bytes);
  const rows: Array<{ name: string; icon: string }> = [];
  let name = '';
  let icon = '';
  const flush = () => {
    if (name.length > 0) rows.push({ name, icon });
    name = '';
    icon = '';
  };
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      flush();
      continue;
    }
    const m = /^\s{2,}(\S+)\s+REG_SZ\s+(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === 'DisplayName') name = m[2].trim();
    else if (m[1] === 'DisplayIcon') icon = m[2].trim();
  }
  flush();
  return rows;
}

/**
 * 已安装程序（注册表）：**只取 DisplayIcon 指向 .exe 的那些**。
 * 用户明确要求"不浅扫目录"，所以这里不为了补全覆盖率去 InstallLocation 里找主程序——
 * 定位不到主程序的条目直接不列（覆盖率如实偏低，但一条都不会猜错）。
 */
async function scanInstalledPrograms(found: Map<string, ScanCandidate>): Promise<void> {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];
  for (const key of keys) {
    if (found.size >= SCAN_LIMIT) return;
    for (const row of await regQueryUninstall(key)) {
      if (found.size >= SCAN_LIMIT) return;
      const target = exeFromDisplayIcon(row.icon);
      if (target === null || found.has(target)) continue;
      if (isNoiseName(row.name)) continue;
      found.set(target, { name: row.name, target, sourcePath: target, source: '已安装程序' });
    }
  }
}

/**
 * 扫描「入口点」——只收用户真正会点的东西，不遍历磁盘（用户 2026-10-11 拍板）：
 *   ① 开始菜单（公共 + 用户）  ② 桌面（公共 + 用户）  ③ 任务栏固定项  ④ 注册表已安装程序
 * 前三类都是 .lnk，解析成真实 exe；按目标去重，先出现的来源胜出、只保留一个。
 */
export async function scanEntryPoints(): Promise<ScanResult> {
  const found = new Map<string, ScanCandidate>();
  for (const [dir, source] of shortcutRoots()) await walkShortcuts(dir, found, source, 0);
  await scanInstalledPrograms(found);

  const items = [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return {
    ok: items.length > 0,
    items,
    reason: items.length > 0 ? undefined : '没有扫到可用的程序（开始菜单 / 桌面 / 任务栏 / 已安装程序里都没有）',
  };
}
