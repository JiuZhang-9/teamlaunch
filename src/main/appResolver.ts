/**
 * 应用入口的本机解析层（2026-10-04，用户拍板方案 2/3/5）。
 *
 * 团队下发的应用入口存的是管理员机器上的绝对路径；同一个应用在不同机器的
 * 安装位置通常不同。打开探测失败（本机 missing）时按序给出候选：
 *   1) 本机"重新定位"缓存（app-overrides.json，per-machine，永不同步）——
 *      用户亲手指定的一定是他要的，优先级最高；
 *   2) App Paths 注册表（HKLM / WOW6432Node / HKCU 的 `...\App Paths\<exe 名>`，
 *      "运行"对话框同款机制，正规安装的软件大多注册在这里）；
 *   3) 开始菜单索引（复用 picker.scanStartMenu，一次扫描会话内缓存；
 *      按 exe 基名与显示名各建一个键）。
 *
 * 解析只提供线索：候选必须在 opener 里再过存在性探测，第一个真实存在的才执行。
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { localStore } from './localStore.ts';
import { scanStartMenu, type ScanCandidate } from './picker.ts';

export interface AppOverride {
  target: string;
  args?: string;
  cwd?: string;
}

const OverrideMapSchema = z.record(
  z.string(),
  z.object({
    target: z.string().min(1),
    args: z.string().optional(),
    cwd: z.string().optional(),
  }),
);

let overridesCache: Map<string, AppOverride> | null = null;

async function loadOverrides(): Promise<Map<string, AppOverride>> {
  if (overridesCache) return overridesCache;
  // 损坏的覆盖文件按空表处理（与 settings.json 同一自愈纪律），下次保存即修复。
  const parsed = OverrideMapSchema.safeParse(await localStore.appOverrides({}));
  overridesCache = new Map(Object.entries(parsed.success ? parsed.data : {}));
  return overridesCache;
}

export async function getOverride(entryId: string): Promise<AppOverride | null> {
  return (await loadOverrides()).get(entryId) ?? null;
}

export async function saveOverride(entryId: string, override: AppOverride): Promise<void> {
  const map = await loadOverrides();
  map.set(entryId, override);
  await localStore.saveAppOverrides(Object.fromEntries(map));
}

/** App Paths 的三个常见注册位置：64 位视图 / 32 位兼容视图 / 当前用户。 */
const APP_PATHS_KEYS = [
  (name: string) => `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`,
  (name: string) => `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`,
  (name: string) => `HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`,
];

/** 读注册表默认值。reg 不存在/键不存在都按 null 处理，带超时不拖主线程。 */
function regQueryDefault(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/ve'], { timeout: 2000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const line = stdout.split(/\r?\n/).find((l) => l.includes('REG_SZ'));
      if (!line) return resolve(null);
      const value = line
        .slice(line.indexOf('REG_SZ') + 'REG_SZ'.length)
        .trim()
        .replace(/^"|"$/g, '');
      resolve(value.length > 0 ? value : null);
    });
  });
}

/** 开始菜单索引（会话内只扫一次）：exe 基名与显示名 → 快捷方式候选。 */
let menuIndexPromise: Promise<Map<string, ScanCandidate>> | null = null;
function startMenuIndex(): Promise<Map<string, ScanCandidate>> {
  if (!menuIndexPromise) {
    menuIndexPromise = scanStartMenu()
      .then((r) => {
        const map = new Map<string, ScanCandidate>();
        for (const it of r.items) {
          map.set(path.basename(it.target).toLowerCase(), it);
          map.set(it.name.toLowerCase(), it);
        }
        return map;
      })
      .catch(() => new Map<string, ScanCandidate>());
  }
  return menuIndexPromise;
}

/**
 * 给定入口 id 与下发的目标路径，返回本机候选（不含原路径——opener 在调用前已探测过它）。
 * 只有"可执行形态"（exe/lnk）才值得找；文件夹与网页没有安装位置问题。
 */
export async function resolveAppCandidates(entryId: string, target: string): Promise<AppOverride[]> {
  const exeName = path.basename(target);
  if (!/\.(exe|lnk)$/i.test(exeName)) return [];

  const out: AppOverride[] = [];
  const seen = new Set<string>();
  const push = (o: AppOverride) => {
    const key = `${o.target.toLowerCase()}|${o.args ?? ''}`;
    if (o.target.length > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  };

  const override = (await loadOverrides()).get(entryId);
  if (override) push(override);

  for (const key of APP_PATHS_KEYS) {
    const viaAppPaths = await regQueryDefault(key(exeName));
    if (viaAppPaths) {
      push({ target: viaAppPaths });
      break; // 三个视图命中其一即可，不必都查
    }
  }

  const hit = (await startMenuIndex()).get(exeName.toLowerCase());
  if (hit) push({ target: hit.target });

  return out;
}
