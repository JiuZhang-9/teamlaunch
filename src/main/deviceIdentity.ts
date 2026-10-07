/**
 * 本机设备标识（identity.json）。
 *
 * 格式与设置页展示一致：`DESKTOP-7F3A92·a1b2c3`（主机名 · 6 位十六进制）。
 * 首启即本地预生成并持久化（C-02）：首启遥测事件不单独上报，随首次成功同步补发，
 * 所以标识必须先于任何上报存在。写盘用原子写，全程异步（K-05）。
 */
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface DeviceIdentity {
  deviceId: string;
  createdAt: string;
}

function newDeviceId(): string {
  return `${hostname()}·${randomBytes(3).toString('hex')}`;
}

export async function ensureDeviceIdentity(root: string): Promise<DeviceIdentity> {
  const file = path.join(root, 'identity.json');
  await mkdir(path.dirname(file), { recursive: true });

  try {
    const text = await readFile(file, 'utf8');
    const parsed = JSON.parse(text) as Partial<DeviceIdentity>;
    if (parsed.deviceId) return { deviceId: parsed.deviceId, createdAt: parsed.createdAt ?? '' };
  } catch {
    // 不存在或损坏 → 下面重新生成
  }

  const identity: DeviceIdentity = { deviceId: newDeviceId(), createdAt: new Date().toISOString() };
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(identity, null, 2), 'utf8');
  await rename(tmp, file);
  return identity;
}
