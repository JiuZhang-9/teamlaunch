/**
 * 快捷添加落点判定（2026-10-29 用户拍板方案 A）。
 *
 * 四条"随手加一条"的入口——粘贴、快捷窗口「加为入口」、搜索结果 / 剪贴板候选加为入口、
 * 拖拽文件进窗口——统一跟随编辑态：管理员正在编辑团队草稿时进团队，否则进「我的入口」。
 * 扫描程序 / 批量添加 / 导入书签是**有明确个人语义**的批量动作，不走这里，仍只进个人入口。
 *
 * 纯函数放 shared：拖拽与文本添加两个调用点必须给出同一个答案，不能各写一个三元表达式。
 */
export type QuickAddScope = 'team' | 'personal';

export interface QuickAddContext {
  /** 管理员是否处于团队编辑态（草稿可写）。 */
  editing: boolean;
}

export function quickAddScope(ctx: QuickAddContext): QuickAddScope {
  return ctx.editing ? 'team' : 'personal';
}
