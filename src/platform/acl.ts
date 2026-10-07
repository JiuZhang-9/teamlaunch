/**
 * src/platform/acl.ts —— 凭据文件 ACL 收敛（ADR-006 §1）
 *
 * `verifier` 等价于口令，credential.json 是本机最高价值目标，写完必须把 ACL
 * 收敛到当前用户并拒绝继承。
 *
 * 只做 Windows（icacls）。非 Windows 直接跳过：本项目 Windows 优先，
 * 且这里失败不阻塞任何主流程。spawn 走数组传参 + shell:false（K-04）。
 */

import { runCommand } from './process-runner.ts';

export async function restrictToCurrentUser(target: string): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const result = await runCommand('icacls', [target, '/inheritance:r', '/grant:r', `${process.env.USERNAME ?? 'SYSTEM'}:F`]);
  return result.exitCode === 0;
}
