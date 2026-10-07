/**
 * src/shared/personal-save.ts —— 保存前的校验（纯函数）
 *
 * 为什么把两行顺序抽成一个文件：**顺序本身就是这个 bug 的全部内容**。
 *
 * `GroupListSchema` 自带容量闸（`group.ts:23` 组数 ≤8、`:42` 入口总数 ≤200），
 * 因此"先 schema 再容量"这个顺序下，任何超限输入必然先挂在 schema 上——
 * `withinCapacity` 分支永远不可达，用户拿到的永远是"结构校验未通过"，
 * 分不清是文件坏了还是入口太多了。而那段设计注释写的正是要避免这件事。
 *
 * 抽成纯函数是为了让它**能被执行**：调用方 `src/main/personalPort.ts` 依赖
 * electron，smoke 拉不起来，这段顺序逻辑因此一度只过了类型检查和代码审阅。
 */

import { PersonalConfigSchema } from './schema/local.ts';
import type { PersonalConfig } from './schema/local.ts';
import { capacityExceededCopy } from './capacity-copy.ts';
import { measure, withinCapacity } from './capacity-usage.ts';

export type PersonalSaveCheck =
  | { ok: true; config: PersonalConfig }
  | { ok: false; reason: string; details?: string[] };

/**
 * 保存前校验：**先容量、再 schema**，与导入路径（`personal-import.ts` 的
 * `parsePersonalFile`）保持同一顺序。
 *
 * `measure` 不依赖 schema（纯数数），所以放在前面不会误伤畸形输入：
 * 数不出东西就按 0 处理，自然落到 schema 去报结构问题。
 */
export function checkPersonalSave(config: unknown): PersonalSaveCheck {
  const usage = measure(config);
  if (!withinCapacity(usage)) {
    return { ok: false, reason: capacityExceededCopy(usage) };
  }

  const parsed = PersonalConfigSchema.safeParse(config);
  if (!parsed.success) {
    return {
      ok: false,
      reason: '保存的内容校验未通过，个人入口未做任何改动',
      details: parsed.error.issues.slice(0, 5).map((issue) => {
        const path = issue.path.map((p) => String(p)).join('.');
        return `${path.length === 0 ? '(根)' : path}: ${issue.message}`;
      }),
    };
  }
  return { ok: true, config: parsed.data };
}
