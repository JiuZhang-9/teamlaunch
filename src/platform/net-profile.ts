/**
 * src/platform/net-profile.ts —— 本机网络事实：LAN IPv4、活动网络配置文件
 *
 * 用途：`/diagnostics` 的 `lanAddresses` 与 `activeNetworkProfile`（K-01 的现场表现）。
 *
 * 地址来自 `os.networkInterfaces()`（内存态，不是 IO，因此不违反 K-05）。
 * 活动配置文件只能问 Windows（`Get-NetConnectionProfile`），走 spawn + 数组传参，
 * 带超时，解析失败一律降级为 'Unknown' —— 巡检项宁可说"不知道"，
 * 也不能把"不知道"渲染成"Private 正常"，那会让管理员跳过最该查的一项。
 */

import { networkInterfaces } from 'node:os';
import { directedBroadcast } from '../shared/net.ts';
import { runCommand } from './process-runner.ts';

export interface LanInterface {
  address: string;
  netmask: string;
  /** 定向广播地址，L2 发现要对每个网卡各发一份。 */
  broadcast: string;
}

export type NetworkProfile = 'Domain' | 'Private' | 'Public' | 'Unknown';

/** 非 internal 的 IPv4 网卡。多个网卡（含 VPN / Hyper-V）都会列出，供人工核对网段。 */
export function listLanInterfaces(): LanInterface[] {
  const all = networkInterfaces();
  const out: LanInterface[] = [];
  for (const list of Object.values(all)) {
    if (list === undefined) continue;
    for (const item of list) {
      // @types/node 24 把 family 收窄成 'IPv4' | 'IPv6' 字面量，不能再和数字比。
      if (item.family !== 'IPv4') continue;
      if (item.internal) continue;
      const broadcast = directedBroadcast(item.address, item.netmask);
      if (broadcast === null) continue;
      out.push({ address: item.address, netmask: item.netmask, broadcast });
    }
  }
  return out.sort((a, b) => a.address.localeCompare(b.address));
}

export function listLanAddresses(): string[] {
  return listLanInterfaces().map((i) => i.address);
}

/**
 * 活动网络配置文件。取所有连接里"最严格"的那个：
 * 只要有一张活动网卡是 Public，防火墙规则就不生效 —— 报 Private 会误导。
 */
export async function readActiveNetworkProfile(): Promise<NetworkProfile> {
  if (process.platform !== 'win32') return 'Unknown';
  const result = await runCommand('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory',
  ]);
  if (result.exitCode !== 0 || result.timedOut || result.spawnFailed) return 'Unknown';

  const categories = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (categories.length === 0) return 'Unknown';
  if (categories.some((c) => c === 'Public')) return 'Public';
  if (categories.includes('DomainAuthenticated')) return 'Domain';
  if (categories.includes('Private')) return 'Private';
  return 'Unknown';
}
