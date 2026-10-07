/**
 * src/repositories/jsonl.ts —— 追加式日志（变更记录 / 反馈条目）
 *
 * 追加写：单进程单写者，一行一条，短写入在 NTFS 上不会撕裂。
 * 淘汰：超过上限时整体重写并**原子替换**，绝不原地截断。
 */

import { appendFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { isNotFound, writeFileAtomic } from './atomic-json.ts';

export async function appendJsonLine(file: string, record: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

/** 读全部行。空行与坏行跳过——坏行不该让整份历史不可读。 */
export async function readJsonLines<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      continue;
    }
  }
  return out;
}

/** 取最后 n 条（保持原顺序，从旧到新）。 */
export async function tailJsonLines<T>(file: string, n: number): Promise<T[]> {
  const all = await readJsonLines<T>(file);
  return all.length <= n ? all : all.slice(all.length - n);
}

/** 重写为给定记录集（原子替换）。用于滚动淘汰。 */
export async function rewriteJsonLines(file: string, records: unknown[]): Promise<void> {
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  await writeFileAtomic(file, records.length === 0 ? '' : `${body}\n`);
}
