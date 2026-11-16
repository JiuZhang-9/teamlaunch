/**
 * HomeHeader —— 主页的精简顶栏（2026-11-07 方案 A；1.9.0 起主页是"态"：顶栏只剩退出开关）。
 *
 * 1.9.0 用户拍板：主页不再是与团队/个人并列的一页，而是一个由小房子开关的态——
 * 顶栏右侧的「团队入口 / 个人入口」按钮去掉，退出主页只走左侧的小房子
 * （回到进入主页之前的那个页面）；侧栏里主页也与两个入口页做了区分。
 */
import { House } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';

export interface HomeHeaderProps {
  /** 退出主页：回到进入主页之前的那个内容页（外壳记住了它）。 */
  onExitHome(): void;
}

export function HomeHeader({ onExitHome }: HomeHeaderProps) {
  return (
    <div
      data-tl-home-header
      className="flex h-[var(--content-header-h)] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-[var(--space-6)]"
      style={{ background: 'var(--bg-surface)' }}
    >
      {/* 与 ContentHeader 的主页小房子同一个 Button 组件、同尺寸（1.9.0 复测反馈：
          两个小房子没对齐，切换主页时按钮会位移）。 */}
      <Button tone="ghost" icon={House} iconSize={20} aria-label="退出主页" title="退出主页，回到上次的页面" onClick={onExitHome} />
      <span className="t-base w-emph text-[var(--fg)]">主页</span>
      <div className="flex-1" />
    </div>
  );
}
