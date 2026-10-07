/**
 * 本机文档读写端口（settings.json / personal.json）。
 *
 * K-05：全程异步，禁止一切 `*Sync` IO。
 * AC-14：写盘用原子写（临时文件 + rename），导入失败时现有文件一个字节都不动。
 * 真正的存储实现在 `src/server/**`（后端负责）；这里是 shell 侧的默认回落，
 * 后端仓库就绪后由 index.ts 注入替换。
 */
import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = (): string => app.getPath('userData');

async function readJson<T>(rel: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path.join(root(), rel), 'utf8');
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(rel: string, value: unknown): Promise<void> {
  const full = path.join(root(), rel);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmp, full);
}

export const localStore = {
  settings<T>(fallback: T): Promise<T> {
    return readJson('settings.json', fallback);
  },
  saveSettings(value: unknown): Promise<void> {
    return writeJsonAtomic('settings.json', value);
  },
  personal<T>(fallback: T): Promise<T> {
    return readJson(path.join('config', 'personal.json'), fallback);
  },
  savePersonal(value: unknown): Promise<void> {
    return writeJsonAtomic(path.join('config', 'personal.json'), value);
  },
  /** 应用入口的"本机重新定位"缓存：per-machine，永不同步（用户拍板方案 5）。 */
  appOverrides<T>(fallback: T): Promise<T> {
    return readJson(path.join('config', 'app-overrides.json'), fallback);
  },
  saveAppOverrides(value: unknown): Promise<void> {
    return writeJsonAtomic(path.join('config', 'app-overrides.json'), value);
  },
  /** 主页收藏（2026-10-05）：本机各存各的，不随团队同步。 */
  favorites<T>(fallback: T): Promise<T> {
    return readJson(path.join('config', 'favorites.json'), fallback);
  },
  saveFavorites(value: unknown): Promise<void> {
    return writeJsonAtomic(path.join('config', 'favorites.json'), value);
  },
};
