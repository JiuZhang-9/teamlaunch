/**
 * 工作栏 / 工作区弹窗共用的动作描述（2026-10-27，1.3.0）。
 *
 * 两处必须用同一份数据：用户在侧栏收起时用工作栏，展开时用左下工作区弹窗，
 * 两边的动作、顺序、禁用原因不能各写一套——那会立刻出现"这边能点、那边点不动"。
 */
import type { LucideIcon } from 'lucide-react';

export interface ToolbarAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect(): void;
  /** 非空 = 当前不可用的原因（容量上限）；按钮/菜单项据此置灰并说明。 */
  disabledReason?: string | null;
}
