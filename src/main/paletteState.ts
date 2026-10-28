/**
 * 快捷窗口位置记忆（2026-10-27，1.5.1 用户要求：可以手动拖动并记住位置）。
 *
 * 归属：机器维护的状态，不是用户意图——单独 `config/palette-state.json`，不进 settings.json。
 * 只存 x/y；尺寸固定（`resizable: false`），所以不需要 width/height。
 *
 * 写盘节流：拖动窗口会连续触发 move，不节流就是每帧一次磁盘写（K-05 的反面教材）。
 * 按 300ms 合并；隐藏/关闭前补一次立即写。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FILE = path.join('config', 'palette-state.json');
const DEBOUNCE_MS = 300;

export interface PalettePosition {
  x: number;
  y: number;
}

function filePath(userData: string): string {
  return path.join(userData, FILE);
}

/** 读上次拖到的位置；读不到 / 形状不认识就返回 null（调用方用默认位置）。 */
export async function loadPalettePosition(userData: string): Promise<PalettePosition | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(filePath(userData), 'utf8'));
    if (raw === null || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.x !== 'number' || !Number.isFinite(o.x)) return null;
    if (typeof o.y !== 'number' || !Number.isFinite(o.y)) return null;
    return { x: o.x, y: o.y };
  } catch {
    return null;
  }
}

export async function savePalettePosition(userData: string, pos: PalettePosition): Promise<void> {
  const full = filePath(userData);
  await mkdir(path.dirname(full), { recursive: true });
  // 原子写（ADR-005）：半截 JSON 会让下次启动读到损坏状态。
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(pos, null, 2), 'utf8');
  await rename(tmp, full);
}

/** 把窗口的 move 事件接成"节流写盘"；返回 flush，隐藏/关闭前调一次。 */
export function trackPalettePosition(
  userData: string,
  win: {
    getBounds(): { x: number; y: number };
    on(event: string, listener: () => void): void;
  },
): () => void {
  let timer: NodeJS.Timeout | null = null;
  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const b = win.getBounds();
    void savePalettePosition(userData, { x: b.x, y: b.y }).catch(() => undefined);
  };
  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };
  win.on('move', schedule);
  return flush;
}
