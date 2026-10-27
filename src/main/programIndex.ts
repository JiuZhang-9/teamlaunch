/**
 * 本机程序索引（2026-10-24）。
 *
 * 职责：开始菜单扫描 → 内存索引 + 磁盘缓存 → 广播给所有窗口；快捷窗口只读内存。
 * 刷新时机由用户拍板：启动（缓存过期才扫）、开始菜单文件变化（防抖）、手动刷新、24h TTL 兜底。
 * **没有固定周期全量扫描**——开始菜单变化很少，定时扫只会换来无意义的 IO 与杀软噪音。
 *
 * 与入口的关系（PRD AC-19）：索引里的程序**不是入口**，不落团队配置、不占个人容量、
 * 不跨机同步；用户按 Ctrl+回车才把它变成一条个人入口。
 *
 * 实测（2026-10-24 本机）：191 个程序冷扫约 4.3 秒——`shell.readShortcutLink` 是同步调用，
 * 无法避免。因此：① 结果必须落盘缓存，启动只读缓存；② 扫描分批让出主线程（programScan 每 8 个让一次）；
 * ③ 只在缓存缺失/过期、开始菜单变化、手动刷新时扫，**不在每次打开面板时扫**。
 */
import { app, shell } from 'electron';
import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { CAPACITY } from '../shared/schema/common.ts';
import {
  EMPTY_PROGRAM_INDEX,
  PROGRAM_INDEX_SCHEMA_VERSION,
  ProgramIndexCacheSchema,
  type ProgramIndexSnapshot,
  type ProgramItem,
} from '../shared/schema/programs.ts';
import { normalizeProgramPath } from '../shared/program-filter.ts';
import { logLine } from './appLog.ts';
import { localStore } from './localStore.ts';
import { pinyinKeys } from './programPinyin.ts';
import { scanProgramRecords, type ProgramRecord } from './programScan.ts';

/** 24 小时兜底重扫：文件监听覆盖不到的少数场景（注册表型安装器、权限变化）靠它收敛。 */
const TTL_MS = 24 * 60 * 60 * 1000;
/** 扫描失败后的退避：避免用户反复打开面板时反复触发 4 秒级重扫。手动刷新不受限。 */
const RETRY_BACKOFF_MS = 60 * 1000;
/** 文件监听防抖：一次安装/卸载会连续触发很多事件。 */
const WATCH_DEBOUNCE_MS = 3000;

let snapshot: ProgramIndexSnapshot = { ...EMPTY_PROGRAM_INDEX, items: [] };
let broadcast: (snapshot: ProgramIndexSnapshot) => void = () => {};
let inFlight: Promise<ProgramIndexSnapshot> | null = null;
let watchers: FSWatcher[] = [];
let watchTimer: NodeJS.Timeout | null = null;
let lastAttemptAt = 0;
let started = false;

function emit(): void {
  broadcast(snapshot);
}

function isStale(scannedAt: string): boolean {
  const at = Date.parse(scannedAt);
  if (Number.isNaN(at)) return true;
  return Date.now() - at > TTL_MS;
}

/** 开始菜单的两个权威位置（公共 + 当前用户）。想被搜到就往这里放快捷方式。 */
function startMenuRoots(): Array<{ dir: string; source: string }> {
  const roots: Array<{ dir: string; source: string }> = [];
  const programData = process.env.ProgramData;
  if (programData) {
    roots.push({
      dir: path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      source: '开始菜单',
    });
  }
  try {
    roots.push({
      dir: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      source: '开始菜单',
    });
  } catch {
    // 拿不到用户目录时只扫公共目录
  }
  return roots;
}

/** 稳定 id：同一目标 + 参数跨扫描不变（图标缓存与列表 key 都依赖它）。 */
function programId(record: ProgramRecord): string {
  const hash = createHash('sha1')
    .update(`${record.target.toLowerCase()}|${record.args.toLowerCase()}`)
    .digest('hex');
  return `sys-${hash}`;
}

function toItem(record: ProgramRecord): ProgramItem {
  const rawName = record.name.trim() || path.basename(record.target).replace(/\.exe$/i, '');
  // EntrySchema 的 name 上限是 40：超了会让合成出的 Entry 整条校验失败（打开/图标全空）。
  const name = rawName.slice(0, CAPACITY.MAX_NAME_LEN);
  const { py, pyInit } = pinyinKeys(name);
  return {
    id: programId(record),
    name,
    target: record.target,
    sourcePath: record.sourcePath,
    // schema 对这两个字段有 4096 上限：极个别快捷方式参数超长时截断，
    // 否则整份缓存会校验失败、每次启动都重扫。
    args: record.args.slice(0, 4096),
    cwd: record.cwd.slice(0, 4096),
    source: record.source,
    py,
    pyInit,
  };
}

export function getProgramSnapshot(): ProgramIndexSnapshot {
  return snapshot;
}

/**
 * 扫描并替换索引。单飞：启动、文件变化、手动刷新同时到来时只跑一次。
 * 扫描失败保留上一份结果（宁可显示旧列表，也不把用户刚能搜到的程序清空）。
 */
export function refreshPrograms(reason: string): Promise<ProgramIndexSnapshot> {
  if (inFlight) return inFlight;
  lastAttemptAt = Date.now();

  const task = (async (): Promise<ProgramIndexSnapshot> => {
    const startedAt = Date.now();
    snapshot = { ...snapshot, scanning: true, error: null };
    emit();
    try {
      const result = await scanProgramRecords({
        roots: startMenuRoots(),
        listDir: async (dir) => {
          const entries = await readdir(dir, { withFileTypes: true });
          return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
        },
        readShortcut: (p) => {
          try {
            const link = shell.readShortcutLink(p);
            return { target: link.target, args: link.args, cwd: link.cwd };
          } catch {
            return null;
          }
        },
        // 把自己排除：搜索里出现 TeamLaunch 再启动一次没有意义（单实例会把焦点给现有窗口）。
        excludeTargets: new Set([normalizeProgramPath(process.execPath)]),
      });
      if (result.rootsRead === 0) throw new Error('开始菜单目录读不到');

      const items = result.records.map(toItem);
      const scannedAt = new Date().toISOString();
      snapshot = { items, scannedAt, scanning: false, error: null };
      try {
        await localStore.saveProgramsIndex({
          schemaVersion: PROGRAM_INDEX_SCHEMA_VERSION,
          scannedAt,
          items,
        });
      } catch (err) {
        /* 缓存写失败不影响本次会话（内存索引已经生效），但必须留证据：
           下次启动会重扫，用户不需要知道磁盘写失败这种事。 */
        logLine('TL-PROGRAMS', 'cache write failed', err instanceof Error ? err.message : String(err));
      }
      logLine('TL-PROGRAMS', `scan ${reason}`, `items=${items.length} ms=${Date.now() - startedAt}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      snapshot = { ...snapshot, scanning: false, error: `扫描本机程序失败：${detail}` };
      logLine('TL-PROGRAMS', `scan failed (${reason})`, detail);
    }
    emit();
    return snapshot;
  })();

  inFlight = task;
  void task.finally(() => {
    if (inFlight === task) inFlight = null;
  });
  return task;
}

/** 快捷窗口每次打开时调用：缓存过期就后台刷新，不阻塞打开。 */
export function ensureProgramsFresh(): void {
  if (!started) return;
  const stale = snapshot.scannedAt === null || isStale(snapshot.scannedAt);
  if (!stale) return;
  // 扫描失败/没有缓存时不反复触发（4 秒级扫描），手动刷新不受这条限制。
  if (Date.now() - lastAttemptAt < RETRY_BACKOFF_MS) return;
  void refreshPrograms('ttl');
}

/** 开始菜单目录变化 → 防抖重扫。监听失败只记日志：搜索仍能用缓存。 */
function startWatchers(): void {
  for (const root of startMenuRoots()) {
    try {
      watchers.push(
        watch(root.dir, { recursive: true }, () => {
          if (watchTimer !== null) clearTimeout(watchTimer);
          watchTimer = setTimeout(() => {
            watchTimer = null;
            void refreshPrograms('watch');
          }, WATCH_DEBOUNCE_MS);
        }),
      );
    } catch {
      // 目录不存在/没有权限：TTL 与手动刷新兜底
    }
  }
}

/**
 * 启动装配：读磁盘缓存先广播（首屏可搜），缓存缺失/过期再后台扫。
 * K-13 的教训：这个函数必须在 `src/main/index.ts` 的真实启动路径上被调用，
 * 只"实现并导出"不算接线。
 */
export function startProgramIndex(onUpdate: (snapshot: ProgramIndexSnapshot) => void): void {
  if (started) return;
  started = true;
  broadcast = onUpdate;

  void (async () => {
    const raw = await localStore.programsIndex<unknown>(null);
    const parsed = ProgramIndexCacheSchema.safeParse(raw);
    /* 只在还没有任何扫描结果时应用缓存：极端情况下（读盘慢、用户已经手动刷新完）
       晚到的缓存不能把新结果盖回旧的。 */
    if (parsed.success && snapshot.scannedAt === null) {
      snapshot = {
        items: parsed.data.items,
        scannedAt: parsed.data.scannedAt,
        // 缓存读盘与用户按热键可能并发：已经有人在扫时，别把 scanning 状态覆盖回 false。
        scanning: inFlight !== null,
        error: inFlight !== null ? snapshot.error : null,
      };
      emit();
    }
    const hasFreshSnapshot = snapshot.scannedAt !== null && !isStale(snapshot.scannedAt);
    if (!hasFreshSnapshot && (!parsed.success || isStale(parsed.data.scannedAt))) {
      void refreshPrograms(parsed.success ? 'ttl' : 'startup');
    }
  })();

  startWatchers();
}

export function stopProgramIndex(): void {
  if (watchTimer !== null) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      // 退出流程，关不掉也不影响
    }
  }
  watchers = [];
}
