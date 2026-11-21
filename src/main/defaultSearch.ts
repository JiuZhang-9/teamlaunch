/**
 * 浏览器默认搜索引擎解析（2026-11-21，1.11.0）。
 *
 * 用户拍板：网页搜索**不读应用内配置的引擎**，用目标浏览器自己的默认搜索引擎——
 * 在浏览器里怎么搜，这里就怎么搜；读不到时回退 Bing，并在界面上如实显示。
 *
 * 解析顺序：
 *   ① 设置里明确指定的「打开网页的浏览器」→ 按 exe 名匹配数据目录 → 读 Preferences；
 *   ② 系统默认浏览器（注册表 StartMenuInternet + UserChoice）→ 同上；
 *   ③ 任一能读到默认引擎的 Chromium 浏览器（兜底遍历）；
 *   ④ Bing（全部读不到）。
 *
 * 只读 Preferences 里的 `default_search_provider_data` 搜索模板，不碰历史/书签；
 * 拼好的 URL 交给 opener.openUrl（会尊重「打开网页的浏览器」偏好），本机处理、不上报。
 */
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { listBrowserDataDirsAt, type BrowserDataDir } from './bookmarks.ts';
import { scanBrowsers } from './browsers.ts';
import {
  buildWebSearchUrl,
  FALLBACK_SEARCH_ENGINE,
  parseDefaultSearchTemplate,
  type SearchEngineTemplate,
} from '../shared/web-search.ts';

export interface SearchEngineInfo {
  engine: string;
  browser: string | null;
  source: 'browser' | 'fallback';
  template: string;
}

/** 目录辨识名：`.../User Data` 用上一级（Chrome/Quark/Doubao），宿主目录用自身（Opera Software）。 */
function dirKey(dir: string): string {
  const base = basename(dir).toLowerCase();
  return base === 'user data' ? basename(dirname(dir)).toLowerCase() : base;
}

/**
 * exe 名（chrome / msedge / quark）与目录辨识名匹配：先精确、再包含。
 * 例：`msedge` ↔ `Edge`、`quark` ↔ `Quark`、`Tabbit Browser` ↔ `Tabbit Browser`。
 */
export function matchBrowserDir(dirs: BrowserDataDir[], exePath: string): BrowserDataDir | null {
  const exe = basename(exePath).replace(/\.exe$/i, '').toLowerCase();
  if (exe.length === 0) return null;
  const exact = dirs.find((dir) => dirKey(dir.dir) === exe);
  if (exact !== undefined) return exact;
  return (
    dirs.find((dir) => {
      const key = dirKey(dir.dir);
      return key.length > 0 && (exe.includes(key) || key.includes(exe));
    }) ?? null
  );
}

async function profileDirs(dir: BrowserDataDir): Promise<string[]> {
  if (dir.profiles.length > 0) {
    return ['Default', ...dir.profiles.filter((profile) => profile !== 'Default')];
  }
  try {
    const entries = await readdir(dir.dir, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    return ['Default', ...names.filter((name) => name !== 'Default')];
  } catch {
    return ['Default'];
  }
}

/** 读一个浏览器数据目录的默认搜索引擎（依次尝试 Default 与其他 profile）。 */
async function readEngineFrom(dir: BrowserDataDir): Promise<SearchEngineTemplate | null> {
  for (const profile of await profileDirs(dir)) {
    try {
      const raw = await readFile(join(dir.dir, profile, 'Preferences'), 'utf8');
      const engine = parseDefaultSearchTemplate(JSON.parse(raw));
      if (engine !== null) return engine;
    } catch {
      /* 单个 profile 读不到（没运行过 / 文件损坏）就继续 */
    }
  }
  return null;
}

function engineInfo(engine: SearchEngineTemplate, browser: string | null): SearchEngineInfo {
  return { engine: engine.name, browser, source: 'browser', template: engine.template };
}

/** 目标浏览器已确定但读不到默认引擎：如实回退，**不借用别的浏览器的引擎**。 */
function fallbackInfo(browser: string | null): SearchEngineInfo {
  return {
    engine: FALLBACK_SEARCH_ENGINE.name,
    browser,
    source: 'fallback',
    template: FALLBACK_SEARCH_ENGINE.template,
  };
}

/**
 * 解析"这次网页搜索用哪个引擎"。注册表/Preferences 都是只读；
 * 浏览器设置变化后下次搜索即生效（不做跨会话缓存）。
 *
 * 关键纪律：只要"用哪个浏览器"是确定的（设置指定 / 系统默认），就只读它的配置；
 * 读不到直接回退 Bing，绝不去别的浏览器里借一个引擎——那会把来源显示错，
 * 用户明明设的是 Edge 默认，界面却显示"来自 Tabbit Browser"。
 */
export async function resolveSearchEngine(browserExe: string | null): Promise<SearchEngineInfo> {
  const dirs = await listBrowserDataDirsAt(process.env.LOCALAPPDATA ?? '', process.env.APPDATA ?? '');
  const explicit = browserExe !== null && browserExe.trim().length > 0;

  /* ① 设置里明确选了浏览器：只认它。 */
  if (explicit) {
    const hit = matchBrowserDir(dirs, browserExe);
    if (hit !== null) {
      const engine = await readEngineFrom(hit);
      return engine !== null ? engineInfo(engine, hit.name) : fallbackInfo(hit.name);
    }
  }

  /* ② 系统默认浏览器（或设置浏览器的注册表声明）：同样只认它。 */
  try {
    const browsers = await scanBrowsers();
    const target = explicit
      ? browsers.find((item) => item.path.toLowerCase() === browserExe.toLowerCase())
      : browsers.find((item) => item.isDefault) ?? browsers[0];
    if (target !== undefined) {
      const byPath = matchBrowserDir(dirs, target.path);
      const dir = byPath ?? dirs.find((item) => item.name.toLowerCase() === target.name.toLowerCase()) ?? null;
      if (dir !== null) {
        const engine = await readEngineFrom(dir);
        return engine !== null ? engineInfo(engine, dir.name) : fallbackInfo(dir.name);
      }
    }
  } catch {
    /* 注册表读不到：走下面的兜底遍历 */
  }

  /* ③ 连目标浏览器都无法确定：遍历，取第一个能读到默认引擎的。 */
  for (const dir of dirs) {
    const engine = await readEngineFrom(dir);
    if (engine !== null) return engineInfo(engine, dir.name);
  }

  /* ④ 全读不到：Bing（如实标注 fallback）。 */
  return fallbackInfo(null);
}

/** 解析并拼 URL（不打开；打开由 ipc 层做，便于门禁只测纯逻辑）。 */
export async function resolveWebSearchUrl(
  query: string,
  browserExe: string | null,
): Promise<{ url: string; engine: SearchEngineInfo } | null> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  const info = await resolveSearchEngine(browserExe);
  let url = buildWebSearchUrl({ name: info.engine, template: info.template }, trimmed);
  if (url === null) {
    /* 模板解析成功但拼不出合法 URL（坏壳）：仍给用户一条可用的路——回退 Bing。 */
    url = buildWebSearchUrl(FALLBACK_SEARCH_ENGINE, trimmed);
    if (url === null) return null;
    return {
      url,
      engine: { ...info, engine: FALLBACK_SEARCH_ENGINE.name, source: 'fallback' },
    };
  }
  return { url, engine: info };
}
