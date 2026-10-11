/**
 * 扫描本机已安装浏览器 —— 给"设置 · 通用 · 打开网页的浏览器"提供候选。
 *
 * 来源：`SOFTWARE\Clients\StartMenuInternet`（HKLM / HKLM\WOW6432Node / HKCU）——
 * 这是 Windows 官方登记"能处理 http 的客户端"的地方，每个直接子键就是一个浏览器，
 * 其 `shell\open\command` 的 `(Default)` 值是启动命令行、本体键的 `(Default)` 值是显示名。
 * 当前默认浏览器读 `UrlAssociations\http\UserChoice\ProgId`（如 ChromeHTML）与子键名对照。
 *
 * 读注册表一律走 winConsole（K-12：控制台输出按系统代码页解码，否则中文名乱码）。
 * 扫描失败（键不存在/权限）返回空数组——调用方按"没有其他浏览器"处理。
 */
import path from 'node:path';
import { regQueryText } from './winConsole.ts';

export interface BrowserInfo {
  /** 显示名（注册表里的浏览器名，如「Google Chrome」）。 */
  name: string;
  /** 可执行文件绝对路径。 */
  path: string;
  /** 是不是系统当前的默认浏览器（按 UserChoice 的 ProgId 判定）。 */
  isDefault: boolean;
}

/** 单次扫描最多返回几个（正常机器 2~5 个）。 */
const MAX_BROWSERS = 12;

/** Chrome/Edge 的启动命令行形如 `"C:\...\chrome.exe" --single-argument %1`。 */
function exeFromCommandLine(cmd: string): string | null {
  const s = cmd.trim();
  const quoted = /^"([^"]*\.exe)"/i.exec(s);
  if (quoted !== null && quoted[1] !== undefined) return quoted[1];
  const bare = /^(.*?\.exe)/i.exec(s);
  return bare !== null && bare[1] !== undefined ? bare[1] : null;
}

interface RegBlock {
  key: string;
  values: Map<string, string>;
}

/**
 * 取块里的"默认值"。
 *
 * 坑：`reg.exe` 把默认值**按系统语言显示**——中文 Windows 打印 `(默认)`、英文 `(Default)`、
 * 日文 `(既定)`…… 按字面量取会一个都取不到（2026-10-11 开发时就这么栽过一次：本机是中文 Windows，扫描返回空列表）。
 * 所以：先认常见写法，再退"这个键只有一个值就拿它"。
 */
function defaultValue(block: RegBlock): string | undefined {
  for (const name of ['(Default)', '(默认)', '(既定)', '(預設值)']) {
    const v = block.values.get(name);
    if (v !== undefined) return v;
  }
  return block.values.size === 1 ? [...block.values.values()][0] : undefined;
}

/** 解析 `reg query <key> /s` 的块状输出：`HKEY_...` 起一个块，块内 `名字  REG_SZ  值`。 */
function parseBlocks(text: string | null): RegBlock[] {
  if (text === null) return [];
  const blocks: RegBlock[] = [];
  let cur: RegBlock | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      cur = { key: line.trim(), values: new Map() };
      blocks.push(cur);
      continue;
    }
    if (cur === null) continue;
    const m = /^\s{2,}(\S.*?)\s{4,}REG_SZ\s+(.*)$/.exec(line);
    if (m === null) continue;
    cur.values.set(m[1].trim(), m[2].trim());
  }
  return blocks;
}

async function defaultBrowserProgId(): Promise<string | null> {
  const blocks = parseBlocks(
    await regQueryText([
      'query',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
    ]),
  );
  for (const b of blocks) {
    const v = b.values.get('ProgId');
    if (v !== undefined && v.length > 0) return v;
  }
  return null;
}

const ROOTS = [
  'HKLM\\SOFTWARE\\Clients\\StartMenuInternet',
  'HKLM\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet',
  'HKCU\\SOFTWARE\\Clients\\StartMenuInternet',
];

/** 取指定名字的值（名字大小写不敏感：注册表本身不区分大小写，reg 的显示形态会变）。 */
function namedValue(block: RegBlock, name: string): string | undefined {
  for (const [k, v] of block.values) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

/**
 * 键路径归一：`reg query` **输出的是长 hive 名**（`HKEY_LOCAL_MACHINE\...`），
 * 而我们给的 root 是短名（`HKLM\...`）——按长度直接切会错位，结果"一个浏览器也扫不到"
 * （2026-10-11 本机实测）。统一折成小写短 hive 形态再比路径。
 */
function normalizeKey(key: string): string {
  return key.replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM').replace(/^HKEY_CURRENT_USER/i, 'HKCU').toLowerCase();
}

/** 扫描已安装浏览器（去重按 exe 路径；拿不到的名用 exe 文件名兜底）。 */
export async function scanBrowsers(): Promise<BrowserInfo[]> {
  const progId = await defaultBrowserProgId();
  const seen = new Set<string>();
  const items: BrowserInfo[] = [];

  for (const root of ROOTS) {
    if (items.length >= MAX_BROWSERS) break;
    const rootNorm = normalizeKey(root);
    const blocks = parseBlocks(await regQueryText(['query', root, '/s']));
    for (const block of blocks) {
      if (items.length >= MAX_BROWSERS) break;
      const keyNorm = normalizeKey(block.key);
      if (!keyNorm.startsWith(`${rootNorm}\\`)) continue;
      const segments = keyNorm.slice(rootNorm.length + 1).split('\\');
      // 只看直接子键（浏览器本体）；它的 shell\open\command 是另一个块。
      if (segments.length !== 1) continue;
      const rel = segments[0] ?? '';
      if (rel.length === 0) continue;

      const cmdBlock = blocks.find((b) => normalizeKey(b.key) === `${rootNorm}\\${rel}\\shell\\open\\command`);
      if (cmdBlock === undefined) continue;
      const exe = exeFromCommandLine(defaultValue(cmdBlock) ?? '');
      if (exe === null) continue;

      const lower = exe.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);

      const display = defaultValue(block) ?? '';
      /** 默认浏览器的判定：UserChoice 给的是 ProgId（如 ChromeHTML），与子键名（Google Chrome）
          本来就不一样——正确映射在各浏览器自己的 Capabilities\URLAssociations\http 上。 */
      const capsBlock = blocks.find((b) => normalizeKey(b.key) === `${rootNorm}\\${rel}\\capabilities\\urlassociations`);
      const assocProgId = capsBlock !== undefined ? namedValue(capsBlock, 'http') : undefined;
      items.push({
        name: display.length > 0 ? display : path.basename(exe).replace(/\.exe$/i, ''),
        path: exe,
        isDefault:
          progId !== null &&
          (assocProgId !== undefined ? assocProgId.toLowerCase() === progId.toLowerCase() : rel === progId.toLowerCase()),
      });
    }
  }
  return items;
}
