/**
 * 取网页标题（2026-10-17，用户拍板"自动联网取标题"）。
 *
 * 唯一用途：新建网页入口时把名称从域名升级成真实标题（取不到就保持域名）。
 *
 * 纪律：
 *  - **只在用户正在添加的那一个网址上发一次请求**：不做批量、不后台巡逻、不缓存别人的网页；
 *  - 超时 5 秒、**只读前 64KB**（不整页下载）、按 Content-Type 声明的 charset 解码（无声明按 UTF-8）；
 *  - **任何失败静默返回 null**——取标题失败绝不能连累"添加入口"这件事本身；
 *  - 这是本项目除更新检查之外的**第二个第三方外网出口**，已在 SECURITY.md / PRD §15.3.3 / ADR-009 如实披露。
 */
import { CAPACITY } from '../shared/schema/common.ts';

const TITLE_TIMEOUT_MS = 5000;
const MAX_BYTES = 64 * 1024;

/** 只认最常见的几个实体：未解码会让标题里带 `&amp;` 这种噪声。 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#?[a-z0-9]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** 流式读取前 limit 字节后主动断开（不把整页拉完）。 */
async function readFirstBytes(res: Response, limit: number): Promise<Uint8Array> {
  const body = res.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= limit) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const room = out.byteLength - offset;
    if (room <= 0) break;
    out.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.byteLength, room);
  }
  return out;
}

/** 取网页标题；任何失败（非 http(s)、超时、非 HTML、没有 title、解码失败）都返回 null。 */
export async function fetchPageTitle(rawUrl: string): Promise<string | null> {
  const url = String(rawUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'TeamLaunch/1.0 (+https://github.com/JiuZhang-9/teamlaunch)',
      },
    });
    if (!res.ok) return null;
    const ctype = res.headers.get('content-type') ?? '';
    /* 明确不是 HTML 就别白读（有些地址会返回 JSON/图片）；没声明时不拦——很多站点不发这个头。 */
    if (ctype !== '' && !/text\/html|application\/xhtml/i.test(ctype)) return null;
    const charset = /charset=\s*"?([\w-]+)/i.exec(ctype)?.[1] ?? 'utf-8';
    const bytes = await readFirstBytes(res, MAX_BYTES);
    let text: string;
    try {
      text = new TextDecoder(charset).decode(bytes);
    } catch {
      text = new TextDecoder('utf-8').decode(bytes);
    }
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    if (!match) return null;
    /* 截断处可能切到半个多字节字符（U+FFFD），去掉它再修剪。 */
    const title = decodeEntities(match[1])
      .replace(/\uFFFD/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, CAPACITY.MAX_NAME_LEN)
      .trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}
