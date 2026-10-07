/**
 * src/shared/capacity-copy.ts —— 容量上限文案的唯一生成处
 *
 * 三处调用方：
 *   1. 服务端添加 / 保存（`services/personal.service.ts`）
 *   2. 服务端导入闸（`shared/personal-import.ts`）
 *   3. 渲染层提示与浏览器预览 mock
 *
 * 写三遍必然漏一处，而这类不一致用户是会直接看到的（预览说 200、真机说 201），
 * 且他无从判断哪个是真的。改一次措辞只动这里。
 *
 * 数字一律由 CAPACITY 算出，不写字面量 200 / 8 ——
 * 上限改了而文案没改，是"提示在骗人"里最难被发现的一种。
 *
 * 本文件**不导出数字**：上限数值的唯一出口是 `schema/common.ts` 的 `CAPACITY`。
 * 曾经这里转发过 `MAX_ENTRIES` / `MAX_GROUPS`，那等于给同一个事实开了两个出口
 * （文案模块顺带当了数字的网关，依赖方向也是反的）——已收掉，需要数值就直接
 * import `CAPACITY`。
 */

import { CAPACITY } from './schema/common.ts';
import type { CapacityUsage } from './capacity-usage.ts';

/** 撞上限后继续添加：给出当前实际占用，让人知道要删多少，而不是只说"超了"。 */
export function capacityExceededCopy(current: CapacityUsage): string {
  return (
    `个人入口最多 ${CAPACITY.MAX_ENTRIES} 个入口、最多 ${CAPACITY.MAX_GROUPS} 个分组`
    + `（当前 ${current.entries} 个 / ${current.groups} 组），请先删减后重试`
  );
}

/** 导入文件自身超限：整份拒收，一个字节都不写。 */
export function importFileTooLargeCopy(file: CapacityUsage): string {
  return (
    `导入文件超出个人入口上限（最多 ${CAPACITY.MAX_ENTRIES} 个入口、`
    + `${CAPACITY.MAX_GROUPS} 个分组，该文件有 ${file.entries} 个 / ${file.groups} 组），`
    + '个人入口未做任何改动'
  );
}

/**
 * 剩余额度：给「还能加几个」的正向说法。
 * 夹到 0 是因为导入后可能瞬间超过上限，显示"还可添加 -3 个"是纯粹的噪音。
 */
export function remainingCopy(current: CapacityUsage): string {
  return (
    `还可添加 ${Math.max(0, CAPACITY.MAX_ENTRIES - current.entries)} 个入口、`
    + `${Math.max(0, CAPACITY.MAX_GROUPS - current.groups)} 个分组`
  );
}
