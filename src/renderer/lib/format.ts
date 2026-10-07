/**
 * 时间格式 —— 同步状态与诊断页共用同一套口径。
 * 规格：当天 `今天 HH:mm`；隔日 `M 月 D 日 HH:mm`；隔年 `YYYY 年 M 月 D 日 HH:mm`。
 */
const pad = (n: number): string => String(n).padStart(2, '0');

export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '从未成功同步';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '从未成功同步';
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
  }
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${hm}`;
}

/** Windows 反斜杠路径（C-01 硬约束）：复制给用户的路径一律 `\`，可直接粘进资源管理器地址栏。 */
export function toWindowsPath(p: string): string {
  return p.replace(/\//g, '\\');
}

/** `https://expense.internal.company.com/login` → `expense.internal.company.com` */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? url;
  }
}
