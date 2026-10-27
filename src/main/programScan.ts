/**
 * 开始菜单程序扫描（2026-10-24）。
 *
 * 范围由用户拍板：**只扫开始菜单**（公共 + 当前用户），不遍历磁盘、不扫桌面/任务栏/注册表。
 * 想被搜到就放一个快捷方式到开始菜单——和 Windows 自己的搜索口径一致。
 *
 * 这里只做"目录树 + 快捷方式 → 记录"的核心逻辑，Electron 的 shell/readdir 由调用方注入，
 * 因此可以在普通 Node 里用假目录树直测（`scripts/verify-programs.mjs`）。
 * K-05：全程异步；K-12：这里不碰控制台程序，无编码问题。
 */
import path from 'node:path';
import {
  isNoiseProgramName,
  isNoiseProgramTarget,
  programDedupeKey,
} from '../shared/program-filter.ts';

export interface ProgramRecord {
  name: string;
  target: string;
  sourcePath: string;
  args: string;
  cwd: string;
  source: string;
}

export interface ScanDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface ProgramScanDeps {
  roots: Array<{ dir: string; source: string }>;
  listDir(dir: string): Promise<ScanDirEntry[]>;
  /** 解析 .lnk；解析不了返回 null（跳过，不影响其他条目）。 */
  readShortcut(p: string): { target?: string; args?: string; cwd?: string } | null;
  /** 已归一化的排除目标（例如 TeamLaunch 自己）。 */
  excludeTargets?: Set<string>;
  /** 跳过的子目录名（默认排除「启动 / Startup」——那些是开机自启项，不该出现在搜索里）。 */
  excludeDirNames?: Set<string>;
  maxDepth?: number;
  maxRecords?: number;
  /** 每解析多少个快捷方式让出一次主线程（shell.readShortcutLink 是同步调用）。 */
  yieldEvery?: number;
  yieldFn?: () => Promise<void>;
}

export interface ProgramScanResult {
  records: ProgramRecord[];
  /** 成功读到目录的根数量；0 = 开始菜单根本读不到（调用方据此保留旧缓存）。 */
  rootsRead: number;
}

const DEFAULT_EXCLUDE_DIRS = new Set(['启动', 'startup']);

export async function scanProgramRecords(deps: ProgramScanDeps): Promise<ProgramScanResult> {
  const maxDepth = deps.maxDepth ?? 8;
  const maxRecords = deps.maxRecords ?? 5000;
  const yieldEvery = deps.yieldEvery ?? 8;
  const yieldFn = deps.yieldFn ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  const excludeDirs = deps.excludeDirNames ?? DEFAULT_EXCLUDE_DIRS;
  const excludeTargets = deps.excludeTargets ?? new Set<string>();

  const found = new Map<string, ProgramRecord>();
  let rootsRead = 0;
  let parsed = 0;

  const walk = async (dir: string, source: string, depth: number): Promise<boolean> => {
    if (depth > maxDepth || found.size >= maxRecords) return true;
    let entries: ScanDirEntry[];
    try {
      entries = await deps.listDir(dir);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (found.size >= maxRecords) return true;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory) {
        if (excludeDirs.has(entry.name.toLowerCase())) continue;
        await walk(full, source, depth + 1);
        continue;
      }
      if (!/\.lnk$/i.test(entry.name)) continue;

      const name = entry.name.replace(/\.lnk$/i, '');
      if (isNoiseProgramName(name)) continue;

      parsed += 1;
      if (yieldEvery > 0 && parsed % yieldEvery === 0) await yieldFn();

      const link = deps.readShortcut(full);
      const target = (link?.target ?? '').trim();
      if (!/\.exe$/i.test(target)) continue;
      if (isNoiseProgramTarget(target)) continue;
      if (excludeTargets.size > 0 && excludeTargets.has(target.replace(/\//g, '\\').toLowerCase())) continue;

      const args = (link?.args ?? '').trim();
      const key = programDedupeKey(target, args);
      if (found.has(key)) continue;

      found.set(key, {
        name,
        target,
        sourcePath: full,
        args,
        cwd: (link?.cwd ?? '').trim(),
        source,
      });
    }
    return true;
  };

  for (const root of deps.roots) {
    if (await walk(root.dir, root.source, 0)) rootsRead += 1;
  }

  const records = [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return { records, rootsRead };
}
