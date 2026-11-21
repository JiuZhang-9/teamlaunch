/**
 * 浏览器书签读取（2026-10-17 用户提出"读取浏览器书签来添加网页卡片"；2026-10-18 扩到全部 Chromium 系）。
 *
 * 两步走（2026-10-18 用户明确要求"先识别电脑上所有基于 Chrome 技术的浏览器，再选择读取"）：
 *   ① `listBookmarkBrowsers()`：**只看目录结构**（哪个浏览器装了、哪些 profile 有 Bookmarks 文件），
 *      **一个字节的书签内容都不读**；
 *   ② `scanBookmarks(browserId)`：用户选定某个浏览器后，才读那一个浏览器的 Bookmarks JSON。
 * 这样"读取"这个动作永远由用户对具体浏览器发起，而不是打开对话框就把本机所有浏览器的书签翻一遍。
 *
 * 1.10.0（2026-11-21 用户反馈"明明电脑上有好几种浏览器，为什么只识别 Chrome 和 Edge"）：
 * 原来的固定路径白名单只能覆盖 9 个已知浏览器，本机实测夸克（Quark）、豆包（Doubao）、
 * Tabbit Browser 都是标准 Chromium 结构（`<数据目录>/<profile>/Bookmarks`），却不在名单里。
 * 现在改为"固定表提供友好名 + 动态扫描兜底"：
 *   - `%LOCALAPPDATA%` / `%APPDATA%` 下按一到两层找 Chromium 数据目录：
 *       `<vendor>/User Data`、`<vendor>/<product>/User Data`（Chrome / Edge / Brave 这类）、
 *       `<host>/<profile>`（Opera 这类没有 User Data 一层的）；
 *   - 判定标准是**至少一个子目录里有 `Bookmarks`**——只看文件名与目录结构，不读内容；
 *     （不能用 `Local State` 判：Electron 应用的 userData 里也有它，实机会误报几十个"浏览器"）
 *   - 不在固定表里的浏览器用目录名兜底（常见目录给中文友好名）。
 *
 * 只做 Chromium 系：它们的书签就是 `User Data\<profile>\Bookmarks` 这个 JSON 文件。Firefox 的
 * `places.sqlite` 在浏览器运行时被锁、还要引入 SQLite 解析，v1 不做（如实说明，不假装支持）。
 *
 * 纪律：
 *  - **只读**：不写、不改、不后台巡逻、不监听文件变化；
 *  - **不离开本机**：书签含个人隐私（标题与网址），只经 IPC 交给界面供勾选，
 *    绝不进入同步/上报链路；
 *  - 读不了（文件不存在 / 被占用 / 结构变了）如实返回"读不到"，绝不猜、不编造；
 *  - 动态扫描只登记自己找到的目录，`scanBookmarks` 不接受渲染层传来的任意路径。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

export interface BookmarkItem {
  title: string;
  url: string;
}

export interface BookmarkSource {
  /** 浏览器显示名（如 'Google Chrome'）。 */
  browser: string;
  /** 用户数据目录里的 profile 名（Default / Profile 1 / Opera Stable …）。 */
  profile: string;
  path: string;
  items: BookmarkItem[];
}

/** 检测到的 Chromium 系浏览器（只看目录，不读书签内容）。 */
export interface BookmarkBrowser {
  id: string;
  name: string;
  /** 有 `Bookmarks` 文件的 profile 名；空数组 = 装了但还没产生书签文件。 */
  profiles: string[];
}

interface BrowserDef {
  id: string;
  name: string;
  dir: string;
}

/** 单个 profile 最多取这么多条：书签能上万，IPC 负载要有上限。 */
const MAX_ITEMS_PER_SOURCE = 3000;
/** 递归深度上限：书签树再深也不该超过这个数（防结构异常导致爆栈）。 */
const MAX_DEPTH = 20;

/**
 * 已知的 Chromium 系浏览器与其用户数据目录。
 *
 * 这张表只负责**友好显示名**（以及 scan 的稳定 id）；真正"装了哪些浏览器"由动态扫描决定，
 * 所以新浏览器（夸克 / 豆包 / Tabbit …）即使不在表里也能被发现，不会再整类漏掉。
 */
function browserDefsAt(local: string, roaming: string): BrowserDef[] {
  if (local === '') return [];
  return [
    { id: 'chrome', name: 'Google Chrome', dir: join(local, 'Google', 'Chrome', 'User Data') },
    { id: 'edge', name: 'Microsoft Edge', dir: join(local, 'Microsoft', 'Edge', 'User Data') },
    { id: 'brave', name: 'Brave', dir: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { id: 'vivaldi', name: 'Vivaldi', dir: join(local, 'Vivaldi', 'User Data') },
    { id: 'chromium', name: 'Chromium', dir: join(local, 'Chromium', 'User Data') },
    { id: 'yandex', name: 'Yandex Browser', dir: join(local, 'Yandex', 'YandexBrowser', 'User Data') },
    { id: '360chrome', name: '360 极速浏览器', dir: join(local, '360Chrome', 'Chrome', 'User Data') },
    { id: 'qqbrowser', name: 'QQ 浏览器', dir: join(local, 'Tencent', 'QQBrowser', 'User Data') },
    /* Opera 系没有 `User Data` 这一层：profile（Opera Stable / Opera GX Stable）直接挂在宿主目录下，
       Bookmarks 就在 profile 目录里——所以这一条给的是宿主目录，profile 名随之变成那两个。 */
    ...(roaming === '' ? [] : [{ id: 'opera', name: 'Opera', dir: join(roaming, 'Opera Software') }]),
  ];
}

/**
 * 常见但不在固定表里的目录名 → 友好显示名。
 * 匹配只看数据目录所在的那一层（如 `Quark/User Data` 的上一级是 `Quark`）。
 * 没命中的用目录名本身，至少不会"识别不到"。
 */
const FRIENDLY_DIR_NAMES: Record<string, string> = {
  quark: '夸克浏览器',
  doubao: '豆包浏览器',
  'tabbit browser': 'Tabbit Browser',
  tabbit: 'Tabbit Browser',
  '360chromex': '360 安全浏览器',
  '360se': '360 安全浏览器',
  '360se6': '360 安全浏览器',
  'ima.copilot': 'ima',
  qianwen: '千问浏览器',
  sogou: '搜狗浏览器',
  'sogou explorer': '搜狗浏览器',
  '2345explorer': '2345 浏览器',
  maxthon: '傲游浏览器',
  'maxthon5': '傲游浏览器',
  liebao: '猎豹浏览器',
  'liebaosafe': '猎豹浏览器',
  arc: 'Arc',
  'sidekick': 'Sidekick',
  'comodo dragon': 'Comodo Dragon',
  'slimjet': 'Slimjet',
  'centbrowser': 'Cent Browser',
  'ucbrowser': 'UC 浏览器',
  'huaweibrowser': '华为浏览器',
  'baidubrowser': '百度浏览器',
};

function browserDefs(): BrowserDef[] {
  return browserDefsAt(process.env.LOCALAPPDATA ?? '', process.env.APPDATA ?? '');
}

function flatten(node: unknown, out: BookmarkItem[], depth: number): void {
  if (out.length >= MAX_ITEMS_PER_SOURCE || depth > MAX_DEPTH) return;
  if (node === null || typeof node !== 'object') return;
  const n = node as { type?: unknown; name?: unknown; url?: unknown; children?: unknown };
  if (n.type === 'url' && typeof n.url === 'string' && /^https?:\/\//i.test(n.url)) {
    const title = String(n.name ?? '').trim();
    out.push({ title: title.length > 0 ? title : n.url, url: n.url });
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) flatten(child, out, depth + 1);
  }
}

/** 解析一份 Bookmarks JSON（`roots` 下逐个根节点展开）。结构不认识就返回空列表。 */
function parseBookmarks(raw: unknown): BookmarkItem[] {
  const out: BookmarkItem[] = [];
  const roots = (raw as { roots?: unknown } | null)?.roots;
  if (roots === null || typeof roots !== 'object') return out;
  for (const value of Object.values(roots as Record<string, unknown>)) {
    flatten(value, out, 0);
  }
  return out;
}

/** 某个 profile 目录下有 Bookmarks 文件吗（**只 stat，不读内容**）。 */
async function hasBookmarksFile(dir: string, profile: string): Promise<boolean> {
  try {
    return (await stat(join(dir, profile, 'Bookmarks'))).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

async function childDirs(base: string): Promise<string[]> {
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 目录里哪些子目录有 Bookmarks 文件（profile 列表）。 */
async function profilesIn(dir: string): Promise<string[]> {
  const profiles: string[] = [];
  for (const name of await childDirs(dir)) {
    if (await hasBookmarksFile(dir, name)) profiles.push(name);
  }
  return profiles;
}

/**
 * 探测一个目录是不是 Chromium 系浏览器数据目录。
 * 返回 profile 列表；不是数据目录（或装了但一个书签文件都没有）返回 null。
 *
 * 判定只看"至少一个子目录里有 `Bookmarks`"——**不能只看 `Local State`**：
 * Electron 应用（VS Code / Discord / Obsidian / TeamLaunch 自己）的 userData 根目录里
 * 也有 Chromium 的 `Local State`，按它判定会把整个 AppData 清单都认成浏览器
 * （2026-11-21 实机验证踩到）。装了的 Chromium 浏览器一定有 profile 目录，
 * 产生过书签就一定有 Bookmarks 文件；没有书签文件的动态目录也没有可导入内容，
 * 不列出来比误报几十个"浏览器"更诚实。
 */
async function probeDataDir(dir: string): Promise<string[] | null> {
  if (!(await isDirectory(dir))) return null;
  const profiles = await profilesIn(dir);
  return profiles.length > 0 ? profiles : null;
}

interface FoundDir {
  dir: string;
  profiles: string[];
}

/**
 * 在一个根目录下按"一到两层"找数据目录（只看目录与文件名，不读内容）：
 *  - `<root>/<vendor>/User Data`
 *  - `<root>/<vendor>/<product>/User Data`
 *  - `<root>/<host>/<profile>`（Opera 这种宿主目录下直接是 profile）
 */
async function discoverUnder(root: string): Promise<FoundDir[]> {
  const found: FoundDir[] = [];
  if (root === '') return found;
  for (const vendor of await childDirs(root)) {
    const vendorPath = join(root, vendor);
    const self = await probeDataDir(vendorPath);
    if (self !== null) {
      found.push({ dir: vendorPath, profiles: self });
      continue;
    }
    const direct = await probeDataDir(join(vendorPath, 'User Data'));
    if (direct !== null) {
      found.push({ dir: join(vendorPath, 'User Data'), profiles: direct });
      continue;
    }
    for (const product of await childDirs(vendorPath)) {
      const nested = await probeDataDir(join(vendorPath, product, 'User Data'));
      if (nested !== null) found.push({ dir: join(vendorPath, product, 'User Data'), profiles: nested });
    }
  }
  return found;
}

/** 目录归一（大小写、分隔符），用于去重。 */
function normalizeDir(dir: string): string {
  return dir.replace(/\//g, '\\').toLowerCase();
}

/**
 * 动态发现的 数据目录 → 浏览器定义。
 * 每次 `listBookmarkBrowsersAt` 重建；`scanBookmarks` 只认这里登记过的 id/目录。
 */
const discovered = new Map<string, BrowserDef>();

/**
 * 目录名 → 显示名：优先固定表的友好名（按路径归一匹配），其次常见目录名映射，
 * 最后用目录名本身（`Quark` / `Doubao` 这类至少看得出来是什么）。
 */
function displayNameOf(dir: string, known: BrowserDef[]): string {
  const norm = normalizeDir(dir);
  const hit = known.find((def) => normalizeDir(def.dir) === norm);
  if (hit !== undefined) return hit.name;
  /* 数据目录本身通常叫 `User Data`（Chrome/夸克/豆包）——真正有辨识度的是上一级
     （Quark / Doubao / Tabbit Browser）；宿主目录形态（Opera）则直接用目录名。 */
  const base = basename(dir);
  const parent = basename(dirname(dir));
  const candidates = base.toLowerCase() === 'user data' ? [parent, base] : [base, parent];
  for (const name of candidates) {
    const friendly = FRIENDLY_DIR_NAMES[name.toLowerCase()];
    if (friendly !== undefined) return friendly;
  }
  return candidates[0] ?? base;
}

/**
 * 第一步：识别本机装了的 Chromium 系浏览器（**不读书签内容**）。
 *
 * 固定表先占位（友好名与稳定 id），动态扫描补上不在表里的浏览器；同一目录只保留一条。
 * 目录读不到 = 没装这个浏览器，直接从结果里消失（不报假数据）。
 */
export async function listBookmarkBrowsersAt(local: string, roaming: string): Promise<BookmarkBrowser[]> {
  const known = browserDefsAt(local, roaming);
  const merged = new Map<string, { def: BrowserDef; profiles: string[] }>();

  /* 固定表：只收真正存在的目录（与原行为一致：装了才列）。 */
  for (const def of known) {
    if (!(await isDirectory(def.dir))) continue;
    merged.set(normalizeDir(def.dir), { def, profiles: await profilesIn(def.dir) });
  }

  /* 动态扫描：两个根目录都扫；已由固定表覆盖的目录不重复。 */
  for (const root of [local, roaming]) {
    for (const item of await discoverUnder(root)) {
      const key = normalizeDir(item.dir);
      if (merged.has(key)) continue;
      const def: BrowserDef = {
        id: `auto:${key}`,
        name: displayNameOf(item.dir, known),
        dir: item.dir,
      };
      merged.set(key, { def, profiles: item.profiles });
    }
  }

  discovered.clear();
  const out: BookmarkBrowser[] = [];
  for (const item of merged.values()) {
    discovered.set(item.def.id, item.def);
    out.push({ id: item.def.id, name: item.def.name, profiles: item.profiles });
  }
  return out;
}

/** 第一步（默认路径）：本机环境变量。 */
export async function listBookmarkBrowsers(): Promise<BookmarkBrowser[]> {
  return listBookmarkBrowsersAt(process.env.LOCALAPPDATA ?? '', process.env.APPDATA ?? '');
}

/** 第二步：读**用户选定的那一个**浏览器的书签（每次都在用户显式动作下发生）。 */
export async function scanBookmarks(browserId: unknown): Promise<BookmarkSource[]> {
  if (typeof browserId !== 'string') return [];
  /* 只认本次 list 登记过的目录（生产里两条路径同源）；没走过 list 时才回退固定表。
     绝不按渲染层传入的任意路径读盘。 */
  const def = discovered.get(browserId) ?? browserDefs().find((b) => b.id === browserId);
  if (def === undefined) return [];

  const sources: BookmarkSource[] = [];
  let entries: string[];
  try {
    entries = (await readdir(def.dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  for (const profile of entries) {
    const file = join(def.dir, profile, 'Bookmarks');
    try {
      if (!(await stat(file)).isFile()) continue;
      const items = parseBookmarks(JSON.parse(await readFile(file, 'utf8')));
      if (items.length > 0) sources.push({ browser: def.name, profile, path: file, items });
    } catch {
      /* 单个 profile 读失败（被占用/损坏）不连累其它 profile */
    }
  }
  return sources;
}
