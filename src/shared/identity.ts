/**
 * 入口的稳定身份色序号（2026-11-08，方案 B）。
 *
 * 用途：图标缺失 / favicon 取不到时的首字方块，按 id 哈希到 6 档低饱和身份色。
 * 同一入口永远落在同一档——用户第二次看到它时颜色不变，才能形成空间记忆。
 *
 * 放在 shared：纯函数，不启动 Electron 也能测（scripts/verify-identity.mjs）。
 */
export const IDENTITY_TONE_COUNT = 6;

/** FNV-1a 32 位：够稳定，不需要加密性质；同 id 必得同色。 */
export function identityTone(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % IDENTITY_TONE_COUNT) + 1;
}
