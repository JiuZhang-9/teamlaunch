/**
 * src/shared/net.ts —— 局域网判定（遥测零外网出口的运行时护栏）
 *
 * ADR-008 三层防线的第一层：发送前校验目标主机，非 RFC1918 / link-local
 * 一律直接丢弃并记录本地警告，不发请求。
 *
 * 这里同时放行 loopback：管理员本机的自连（含自检脚本）必须能走通，
 * 且 127.0.0.1 不可能是"外网出口"。
 */

const IPV4_OCTETS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIpv4(host: string): [number, number, number, number] | null {
  const m = IPV4_OCTETS.exec(host.trim());
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

export function isLoopbackIpv4(host: string): boolean {
  const ip = parseIpv4(host);
  return ip !== null && ip[0] === 127;
}

/** RFC1918 私有地址：10/8、172.16/12、192.168/16。 */
export function isPrivateIpv4(host: string): boolean {
  const ip = parseIpv4(host);
  if (ip === null) return false;
  if (ip[0] === 10) return true;
  if (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) return true;
  if (ip[0] === 192 && ip[1] === 168) return true;
  return false;
}

/** link-local 169.254/16（无 DHCP 时的自动地址，仍属"本机链路"，不是外网）。 */
export function isLinkLocalIpv4(host: string): boolean {
  const ip = parseIpv4(host);
  return ip !== null && ip[0] === 169 && ip[1] === 254;
}

/** 允许作为遥测/同步目标的主机：私有地址、link-local 或 loopback。 */
export function isLanHost(host: string): boolean {
  return isPrivateIpv4(host) || isLinkLocalIpv4(host) || isLoopbackIpv4(host);
}

/** 由 IPv4 与掩码算定向广播地址（ADR-002 的 L2 定向广播要用）。 */
export function directedBroadcast(ip: string, netmask: string): string | null {
  const a = parseIpv4(ip);
  const m = parseIpv4(netmask);
  if (a === null || m === null) return null;
  const out = a.map((octet, i) => octet | (~m[i] & 0xff));
  return out.join('.');
}
