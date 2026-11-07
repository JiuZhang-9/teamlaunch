/**
 * 上次显示的是哪一面（2026-11-07，用户要求：手动启动恢复上次关闭的窗口）。
 *
 * 机器维护的状态，不是用户意图——单独 `config/surface-state.json`，不进 settings.json。
 * 只在两面切换显示 / 获得焦点时写一次；文件极小，同步原子写，保证退出前最后一次切换不丢。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Surface } from '../shared/surface-machine.ts';

const FILE = path.join('config', 'surface-state.json');

function filePath(userData: string): string {
  return path.join(userData, FILE);
}

/** 读上次显示过的那一面；读不到 / 形状不认识 → null（调用方回默认快捷搜索栏）。 */
export function loadLastSurface(userData: string): Surface | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(filePath(userData), 'utf8'));
    if (raw === null || typeof raw !== 'object') return null;
    const value = (raw as Record<string, unknown>).lastSurface;
    return value === 'main' || value === 'palette' ? value : null;
  } catch {
    return null;
  }
}

/** 原子写：半截 JSON 会让下次启动读到损坏状态（ADR-005）。 */
export function saveLastSurface(userData: string, surface: Surface): void {
  try {
    const full = filePath(userData);
    mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lastSurface: surface }, null, 2), 'utf8');
    renameSync(tmp, full);
  } catch {
    // 记忆失败不影响功能：下次启动回默认快捷搜索栏。
  }
}
