/**
 * 程序名 / 目标的噪声过滤（纯函数，放 shared 以便门禁直测）。
 *
 * 口径与「扫描本机程序」对话框一致（2026-09-29 用户拍板，2026-10-11 收敛）：
 * 卸载器、安装器、说明、版本号残名都不该出现在"可启动程序"列表里。
 * 索引场景再加一层**目标文件**过滤：开始菜单里也可能有指向 setup/unins 的快捷方式。
 */

/** 「只有版本号 / 只有位数」这类残名（1.4.0、2022.0.7、2018、(x64)、64-bit)）。 */
const VERSION_ONLY = /^\d+(\.\d+)*$/;
const BIT_ONLY = /^[(_\-\s]*(x64|x86|64-bit|32-bit|64|32)[)_\-\s]*$/i;

/** 这些名字进来只会让列表没法用：卸载/修复/更新/说明之类不是程序本体。 */
const NOISE_EXACT = new Set([
  '安装程序', 'setup', 'install', 'installer', 'update', 'updater', 'repair', '修复',
  'readme', '说明', '帮助', 'help', 'license', '许可', '关于', 'about', '卸载', '更多',
]);

export function isNoiseProgramName(name: string): boolean {
  const n = name.trim();
  if (n.length === 0) return true;
  if (n.includes('卸载') || /uninstall/i.test(n)) return true;
  if (NOISE_EXACT.has(n.toLowerCase())) return true;
  if (VERSION_ONLY.test(n) || BIT_ONLY.test(n)) return true;
  return false;
}

/** 目标文件名是否像卸载器/安装器（开始菜单里也可能出现这类快捷方式）。 */
export function isNoiseProgramTarget(target: string): boolean {
  const base = target.trim().replace(/^.*[\\/]/, '').toLowerCase();
  return /^(?:unins|uninstall|uninst|setup|install|installer|update|updater|repair)[0-9._\-\s]*\.(?:exe|com)$/i.test(base);
}

/** Windows 路径归一：反斜杠、去两侧空白、忽略大小写（同一目标的唯一口径）。 */
export function normalizeProgramPath(p: string): string {
  return p.trim().replace(/\//g, '\\').toLowerCase();
}

/** 去重键：同一 exe 带不同参数算两条（Chrome 多配置、带启动参数的快捷方式不能合并）。 */
export function programDedupeKey(target: string, args?: string | null): string {
  return `${normalizeProgramPath(target)}|${(args ?? '').trim().toLowerCase()}`;
}
