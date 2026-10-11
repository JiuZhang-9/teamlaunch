/**
 * 「打开网页用哪个浏览器」的本机偏好（本机状态，不进同步、不进 settings 广播之外的地方）。
 *
 * 单独一个模块的原因：`opener.ts` 要读它、设置变更时装配层要写它，
 * 而扫描实现（browsers.ts）又要用 opener 的 probe —— 放一起会形成循环 import。
 */
let current: string | null = null;

/** 写入口径：null 或空串 = 用系统默认浏览器（行为与从前完全一致）。 */
export function setBrowserPreference(exe: string | null | undefined): void {
  const v = typeof exe === 'string' ? exe.trim() : '';
  current = v.length > 0 ? v : null;
}

export function getBrowserPreference(): string | null {
  return current;
}
