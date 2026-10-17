/**
 * 浏览器书签读取（2026-10-17 用户提出"读取浏览器书签来添加网页卡片"；2026-10-18 扩到全部 Chromium 系）。
 *
 * 两步走（2026-10-18 用户明确要求"先识别电脑上所有基于 Chrome 技术的浏览器，再选择读取"）：
 *   ① `listBookmarkBrowsers()`：**只看目录结构**（哪个浏览器装了、哪些 profile 有 Bookmarks 文件），
 *      **一个字节的书签内容都不读**；
 *   ② `scanBookmarks(browserId)`：用户选定某个浏览器后，才读那一个浏览器的 Bookmarks JSON。
 * 这样"读取"这个动作永远由用户对具体浏览器发起，而不是打开对话框就把本机所有浏览器的书签翻一遍。
 *
 * 只做 Chromium 系：它们的书签就是 `User Data\<profile>\Bookmarks` 这个 JSON 文件（Opera 没有
 * `User Data` 这一层，profile 目录直接挂在宿主目录下），位置与结构稳定。Firefox 的 `places.sqlite`
 * 在浏览器运行时被锁、还要引入 SQLite 解析，v1 不做（如实说明，不假装支持）。
 *
 * 纪律：
 *  - **只读**：不写、不改、不后台巡逻、不监听文件变化；
 *  - **不离开本机**：书签含个人隐私（标题与网址），只经 IPC 交给界面供勾选，
 *    绝不进入同步/上报链路；
 *  - 读不了（文件不存在 / 被占用 / 结构变了）如实返回"读不到"，绝不猜、不编造。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

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

/** 单个 profile 最多取这么多条：书签能上万，IPC 负载要有上限。 */
const MAX_ITEMS_PER_SOURCE = 3000;
/** 递归深度上限：书签树再深也不该超过这个数（防结构异常导致爆栈）。 */
const MAX_DEPTH = 20;

/**
 * 已知的 Chromium 系浏览器与其用户数据目录。
 *
 * 路径猜错不会造成错误数据——那个浏览器就是"没检测到"，不会出现在列表里；
 * 反过来说，**不在这张表里的浏览器我们不会假装支持**（对话框的空状态会如实列出查过哪些）。
 */
function browserDefs(): Array<{ id: string; name: string; dir: string }> {
  const local = process.env.LOCALAPPDATA ?? '';
  const roaming = process.env.APPDATA ?? '';
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

/**
 * 第一步：识别本机装了的 Chromium 系浏览器（**不读书签内容**）。
 * 目录读不到 = 没装这个浏览器，直接从结果里消失（不报假数据）。
 */
export async function listBookmarkBrowsers(): Promise<BookmarkBrowser[]> {
  const found: BookmarkBrowser[] = [];
  for (const def of browserDefs()) {
    let entries: string[];
    try {
      entries = await readdir(def.dir);
    } catch {
      continue; // 没装 / 目录不可读
    }
    const profiles: string[] = [];
    for (const profile of entries) {
      if (await hasBookmarksFile(def.dir, profile)) profiles.push(profile);
    }
    found.push({ id: def.id, name: def.name, profiles });
  }
  return found;
}

/** 第二步：读**用户选定的那一个**浏览器的书签（每次都在用户显式动作下发生）。 */
export async function scanBookmarks(browserId: unknown): Promise<BookmarkSource[]> {
  if (typeof browserId !== 'string') return [];
  const def = browserDefs().find((b) => b.id === browserId);
  if (def === undefined) return [];

  const sources: BookmarkSource[] = [];
  let entries: string[];
  try {
    entries = await readdir(def.dir);
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
