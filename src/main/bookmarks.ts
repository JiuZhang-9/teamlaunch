/**
 * 浏览器书签读取（2026-10-17 用户提出"读取浏览器书签来添加网页卡片"）。
 *
 * 只做 **Chromium 系（Chrome / Edge）**：它们的书签就是 `User Data\<profile>\Bookmarks`
 * 这个 JSON 文件，位置固定、结构固定。Firefox 的 `places.sqlite` 在浏览器运行时被锁、
 * 还要引入 SQLite 解析，v1 不做（如实说明，不假装支持）。
 *
 * 纪律：
 *  - **只读、只在用户显式打开「导入书签」时读一次**：不后台扫描、不监听文件变化；
 *  - **不离开本机**：书签含个人隐私（标题与网址），只经 IPC 交给界面供勾选，
 *    绝不进入同步/上报链路（同步的团队配置是管理员维护的内容，与这里无关）；
 *  - 读不了（文件不存在 / 被占用 / 结构变了）如实返回"读不到"，绝不猜、不编造。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface BookmarkItem {
  title: string;
  url: string;
}

export interface BookmarkSource {
  /** 'Chrome' | 'Edge'（将来加浏览器只往 BROWSERS 里加一行）。 */
  browser: string;
  /** 用户数据目录里的 profile 名（Default / Profile 1 …）。 */
  profile: string;
  path: string;
  items: BookmarkItem[];
}

/** 单个 profile 最多取这么多条：书签能上万，IPC 负载要有上限。 */
const MAX_ITEMS_PER_SOURCE = 3000;
/** 递归深度上限：书签树再深也不该超过这个数（防结构异常导致爆栈）。 */
const MAX_DEPTH = 20;

function browsers(): Array<{ name: string; dir: string }> {
  const local = process.env.LOCALAPPDATA ?? '';
  if (local === '') return [];
  return [
    { name: 'Chrome', dir: join(local, 'Google', 'Chrome', 'User Data') },
    { name: 'Edge', dir: join(local, 'Microsoft', 'Edge', 'User Data') },
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

/** 扫描本机的 Chrome / Edge 书签；读不到的浏览器/profile 直接不出现（不报假数据）。 */
export async function scanBookmarks(): Promise<BookmarkSource[]> {
  const sources: BookmarkSource[] = [];
  for (const { name, dir } of browsers()) {
    let profiles: string[];
    try {
      profiles = await readdir(dir);
    } catch {
      continue; // 没装这个浏览器
    }
    for (const profile of profiles) {
      const file = join(dir, profile, 'Bookmarks');
      try {
        if (!(await stat(file)).isFile()) continue;
        const items = parseBookmarks(JSON.parse(await readFile(file, 'utf8')));
        if (items.length > 0) sources.push({ browser: name, profile, path: file, items });
      } catch {
        /* 单个 profile 读失败（被占用/损坏）不连累其它 profile */
      }
    }
  }
  return sources;
}
