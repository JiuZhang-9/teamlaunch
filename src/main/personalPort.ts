/**
 * src/main/personalPort.ts —— 个人入口在主进程侧的接入点
 *
 * 为什么单独一个文件、为什么不挂在 `backendService` 上：
 * 个人入口是**本机**数据，跟"这台机器是不是管理员"没有关系。
 * 内嵌同步服务只在 `role === 'admin'` 时装配（`ctx` 否则为 null），
 * 把个人入口挂上去，员工机的导入会整体失效——而界面上的表现只是
 * "点了导入，没反应"，没人会想到是角色闸门的问题。
 *
 * 这里直接用 repositories/services 的真实实现（schema 校验 + 容量闸 + AC-14/15），
 * 不另写一份简化版：简化版迟早会在"冲突判定"上跟真机分叉。
 */

import { app } from 'electron';
import { resolvePaths } from '../repositories/paths.ts';
import { PersonalRepository } from '../repositories/personal.repository.ts';
import { PersonalService } from '../services/personal.service.ts';
import { checkPersonalSave } from '../shared/personal-save.ts';
import type {
  ConflictAction,
  ConflictPolicy,
  ImportCommitResult,
  ImportDecisions,
  ImportPreviewResult,
  PersonalSaveResult,
} from '../renderer/bridge/types.ts';

const EMPTY_REASON = '导入内容为空，个人入口未做任何改动';
const FAILED_REASON = '导入失败，个人入口未做任何改动';

let cached: PersonalService | null = null;

/** 懒装配：`app.getPath` 必须等 app ready，而注册 IPC 时未必已就绪。 */
export function personalService(): PersonalService {
  if (cached === null) {
    cached = new PersonalService(new PersonalRepository(resolvePaths(app.getPath('userData'))));
  }
  return cached;
}

/**
 * 预览：只解析 + 判定，**不写盘**（AC-14）。
 *
 * 现有配置**一律从磁盘读**，不采信调用方带来的 `current`：
 * 那份可能是渲染层的过期缓存。预览按缓存算、提交按磁盘算，
 * 就会重现"预览说 3 条冲突、实际覆盖 5 条"——
 * 而这正是 `shared/personal-import.ts` 里单个 `measureImport` 要防的东西。
 * 真值只有一个，就是磁盘。
 */
export async function previewPersonalImport(req: unknown): Promise<ImportPreviewResult> {
  const text = readText(req);
  if (text === null) return { ok: false, reason: EMPTY_REASON };
  const service = personalService();
  return service.previewImport(text, await service.load());
}

/** 提交：成功/失败一律返回可展示的结果，绝不抛给渲染层一个 rejection。 */
export async function commitPersonalImport(req: unknown): Promise<ImportCommitResult> {
  const text = readText(req);
  if (text === null) return { kind: 'error', reason: EMPTY_REASON };
  try {
    return await personalService().commitImport(text, readDecisions(req));
  } catch {
    // 写盘失败等不可预期错误：不谎报成功，也不把内部细节抛给界面。
    return { kind: 'error', reason: FAILED_REASON };
  }
}

/**
 * 保存：与导入走同一道 schema 校验 + 容量闸。
 *
 * 以前这条通道是无条件写盘（`localStore.savePersonal`），不过任何闸，
 * 于是"最多 200 个入口"可以被 `personal.save(300 条)` 直接绕过。
 * 后果不是"存进去了"这么简单：用户下次点添加时才看到上限提示，
 * 他会以为问题出在刚才那次添加，而真正的原因是之前存进去的就已经超了——
 * 错误出现在离原因很远的地方，这正是我们一直在防的那类问题。
 */
export async function savePersonal(config: unknown): Promise<PersonalSaveResult> {
  const checked = checkPersonalSave(config);
  if (!checked.ok) return checked;
  try {
    await personalService().save(checked.config);
    // 回带落盘后的规范配置（schema 补齐过默认值），调用方可以据此刷新缓存。
    return { ok: true, config: checked.config };
  } catch {
    // 到这里只剩写盘失败：容量与结构都已在 checkPersonalSave 里拦过。
    return { ok: false, reason: '保存失败，个人入口未做任何改动' };
  }
}

/** IPC 入参一律当不可信输入处理：渲染层可能传任何东西过来。 */
function readText(req: unknown): string | null {
  if (typeof req !== 'object' || req === null) return null;
  const text = (req as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
}

const POLICIES = new Set<string>(['ask', 'skip', 'overwrite', 'copy']);
const ACTIONS = new Set<string>(['skip', 'overwrite', 'copy']);

/**
 * 决定项拿不到 / 不认识时一律回落到 `ask`——
 * 这是**不会覆盖**的那一边。解析失败就按覆盖处理，
 * 等于给一个畸形 IPC 消息开了静默覆盖的口子。
 */
function readDecisions(req: unknown): ImportDecisions {
  const raw = typeof req === 'object' && req !== null ? (req as { decisions?: unknown }).decisions : null;
  if (typeof raw !== 'object' || raw === null) return { policy: 'ask' };

  const { policy, perEntry } = raw as { policy?: unknown; perEntry?: unknown };
  const safe: ImportDecisions = {
    policy: typeof policy === 'string' && POLICIES.has(policy) ? (policy as ConflictPolicy) : 'ask',
  };
  if (typeof perEntry === 'object' && perEntry !== null) {
    const actions: Record<string, ConflictAction> = {};
    for (const [key, value] of Object.entries(perEntry)) {
      if (typeof value === 'string' && ACTIONS.has(value)) actions[key] = value as ConflictAction;
    }
    safe.perEntry = actions;
  }
  return safe;
}
