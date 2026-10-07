/**
 * 入口采集 —— 从本机选择程序 / 文件夹，以及扫描开始菜单程序。
 *
 * 这两项此前只有界面上的一句提示，**后端能力从未实现**：
 * 个人页面的「从本机添加软件」「扫描开始菜单程序」点了没反应。
 * 这里补齐真实实现（P0-07 个人入口管理、P0-12 入口采集）。
 */
import { app, dialog, shell } from 'electron';
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
}

export interface ScanResult {
  ok: boolean;
  items: ScanCandidate[];
  reason?: string;
}

/** 扫描上限：开始菜单可能有几百个快捷方式，全量塞进界面没有意义。 */
const SCAN_LIMIT = 200;
const SCAN_MAX_DEPTH = 4;

function displayName(p: string): string {
  return path.basename(p).replace(/\.(exe|lnk)$/i, '');
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

function startMenuRoots(): string[] {
  const roots: string[] = [];
  const common = process.env.ProgramData;
  if (common) {
    roots.push(path.join(common, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }
  try {
    roots.push(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  } catch {
    // 拿不到用户目录就只扫公共目录
  }
  return roots;
}

/**
 * 扫描开始菜单，返回指向 exe 的快捷方式候选（去重、按名称排序）。
 *
 * 只收 .lnk → .exe：开始菜单里还有文件夹、URL 快捷方式和卸载程序，
 * 全收进来会让候选列表没法用。
 */
export async function scanStartMenu(): Promise<ScanResult> {
  const found = new Map<string, ScanCandidate>();

  const walk = async (dir: string, depth: number): Promise<void> => {
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
        await walk(full, depth + 1);
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
      // 同一目标只保留一个（去重按目标而非名称，避免同一程序出现多次）
      if (!found.has(target)) {
        found.set(target, { name: displayName(entry.name), target, sourcePath: full });
      }
    }
  };

  for (const root of startMenuRoots()) await walk(root, 0);

  const items = [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return {
    ok: items.length > 0,
    items,
    reason: items.length > 0 ? undefined : '没有在开始菜单找到可用的程序快捷方式',
  };
}
