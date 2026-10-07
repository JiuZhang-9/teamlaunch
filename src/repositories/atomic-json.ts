/**
 * src/repositories/atomic-json.ts —— 原子写与容错读（ADR-005 三条硬规则之第 1、2 条）
 *
 * 写盘必须原子：`write(tmp)` → `fsync` → `rename(tmp, target)`。
 * 任何中断都不留下半截文件——半截 JSON 会让客户端拿到不可解析的缓存，
 * 而这类故障的表现是"随机地显示上一版"，极难定位。
 *
 * 禁止一切 *Sync IO（K-05）：对已下线的 UNC 路径，同步调用会阻塞主线程数十秒。
 */

import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * 原子替换文件内容。tmp 文件带 pid + 随机后缀，避免同一进程内并发写互相踩。
 * rename 前先 fsync 文件句柄；目录级 fsync 在 Windows 上不保证，
 * 但 NTFS 的 rename 本身是原子的，已覆盖断电/崩溃这两个真实场景。
 */
export async function writeFileAtomic(target: string, content: string | Buffer): Promise<void> {
  const dir = dirname(target);
  await ensureDir(dir);
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await writeFileAtomic(target, `${JSON.stringify(value)}\n`);
}

/** 读文本。文件不存在返回 null（首次运行是常态，不是错误）。 */
export async function readTextFile(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** 读 JSON。文件不存在返回 null；解析失败抛错，由调用方决定降级还是上抛。 */
export async function readJsonFile<T>(target: string): Promise<T | null> {
  const text = await readTextFile(target);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

export function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
