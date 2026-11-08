/**
 * 网页入口图标（2026-11-08，F1）。
 *
 * 默认策略：网页入口没有手动表情时，按 `origin` 尝试 `GET /favicon.ico`；
 * 成功缓存 7 天（内存 + userData/icon-cache/favicon-*.txt），失败缓存 10 分钟，
 * 调用方（entries-icon）返回 null 时卡片回退到首字方块。
 *
 * 与 ADR-007 原方案的关系：原方案是"管理员侧抓取、随配置下发 asset"，但一直未落地；
 * 这里走客户端按需抓取，用户已在 2026-11-08 明确选择 F1。边界：
 *  - 只认 http/https，只取该 origin 的 `/favicon.ico`，不解析页面、不跟随站内链接；
 *  - 3 秒超时、最多读 256KB，只接受可识别魔数的图片（HTML 404 页一律丢弃）；
 *  - 同一 origin 的并发请求合并；失败静默，不打扰用户；
 *  - 只在入口真正显示时触发，不做后台巡逻；结果不写进入口数据、不参与同步。
 *
 * 这是本项目新增的外网访问点，已同步更新 SECURITY.md / PRD / UIUX / ADR-007。
 */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TIMEOUT_MS = 3_000;
const MAX_BYTES = 256 * 1024;
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;

interface MemoryEntry {
  at: number;
  data: string | null;
}

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<string | null>>();

function originOf(raw: string): { origin: string; iconUrl: string } | null {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { origin: url.origin, iconUrl: new URL('/favicon.ico', url.origin).toString() };
  } catch {
    return null;
  }
}

function cacheFile(origin: string): string {
  const hash = createHash('sha256').update(origin).digest('hex').slice(0, 24);
  return path.join(app.getPath('userData'), 'icon-cache', `favicon-${hash}.txt`);
}

/** 磁盘缓存：成功结果才有；过期或形状不认识按未命中。 */
async function readDisk(origin: string): Promise<string | null> {
  try {
    const file = cacheFile(origin);
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > SUCCESS_TTL_MS) return null;
    const data = await readFile(file, 'utf8');
    return data.startsWith('data:image/') ? data : null;
  } catch {
    return null;
  }
}

async function writeDisk(origin: string, data: string): Promise<void> {
  try {
    const file = cacheFile(origin);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, 'utf8');
  } catch {
    // 缓存写失败不影响本次显示：下次重新抓一次即可。
  }
}

/** 只读前 limit 字节，然后主动断开。 */
async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
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

/** 魔数识别：只认图片，避免把 SPA 的 index.html（200 + text/html）当 favicon。 */
function sniffMime(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1;
  if (bytes.length >= 4 && at(0) === 0x00 && at(1) === 0x00 && at(2) === 0x01 && at(3) === 0x00) return 'image/x-icon';
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return 'image/webp';
  }
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 256)).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

async function fetchOne(iconUrl: string): Promise<string | null> {
  try {
    const res = await fetch(iconUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
      headers: {
        accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.5',
        'user-agent': 'TeamLaunch/1.8 (+https://github.com/JiuZhang-9/teamlaunch)',
      },
    });
    if (!res.ok) return null;
    const bytes = await readLimited(res, MAX_BYTES);
    if (bytes.length < 16) return null;
    const mime = sniffMime(bytes);
    if (mime === null) return null;
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * 按 origin 取 favicon；任何失败返回 null（调用方回退首字方块）。
 * 内存缓存 + 磁盘缓存 + inflight 合并，同一站点不会在首屏被并发抓多次。
 */
export async function faviconForUrl(rawUrl: string): Promise<string | null> {
  const target = originOf(rawUrl);
  if (target === null) return null;

  const cached = memory.get(target.origin);
  if (cached !== undefined) {
    const ttl = cached.data === null ? FAIL_TTL_MS : SUCCESS_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.data;
  }

  const pending = inflight.get(target.origin);
  if (pending !== undefined) return pending;

  const task = (async (): Promise<string | null> => {
    const onDisk = await readDisk(target.origin);
    if (onDisk !== null) {
      memory.set(target.origin, { at: Date.now(), data: onDisk });
      return onDisk;
    }
    const data = await fetchOne(target.iconUrl);
    memory.set(target.origin, { at: Date.now(), data });
    if (data !== null) void writeDisk(target.origin, data);
    return data;
  })().finally(() => {
    inflight.delete(target.origin);
  });

  inflight.set(target.origin, task);
  return task;
}
