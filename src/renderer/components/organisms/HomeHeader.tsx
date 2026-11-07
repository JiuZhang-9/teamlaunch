/**
 * HomeHeader —— 主页的精简顶栏（2026-11-07 用户拍板方案 A）。
 *
 * 主页此前是整个外壳里唯一不渲染 ContentHeader 的页面：侧栏一收起，
 * 主页就没有任何可见入口回到团队 / 个人（只能靠 Ctrl+E / Ctrl+Q）。
 * 这里用与 ContentHeader 同高、同边框的一条栏，只放主页标题和两个目标页按钮，
 * 不显示搜索框 / 工作栏 / 类型筛选——主页没有可搜索的内容。
 */
import { BuildingComplex, House, UserRound } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';
import type { TabKey } from '../../store/workbenchStore.tsx';

export interface HomeHeaderProps {
  onSwitchTab(tab: TabKey): void;
}

export function HomeHeader({ onSwitchTab }: HomeHeaderProps) {
  return (
    <div
      data-tl-home-header
      className="flex h-[var(--content-header-h)] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-[var(--space-6)]"
      style={{ background: 'var(--bg-surface)' }}
    >
      <House size={20} strokeWidth={2} aria-hidden className="text-[var(--fg-2)]" />
      <span className="t-base w-emph text-[var(--fg)]">主页</span>
      <div className="flex-1" />
      <Button
        tone="ghost"
        size="sm"
        icon={BuildingComplex}
        iconSize={16}
        onClick={() => onSwitchTab('team')}
      >
        团队入口
      </Button>
      <Button
        tone="ghost"
        size="sm"
        icon={UserRound}
        iconSize={16}
        onClick={() => onSwitchTab('personal')}
      >
        个人入口
      </Button>
    </div>
  );
}
