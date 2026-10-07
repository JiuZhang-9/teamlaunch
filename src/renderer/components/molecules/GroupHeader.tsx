/**
 * GroupHeader —— 分组标题行（h32）。右侧计数是默认槽位，编辑态另有操作按钮注入。
 * id 供侧栏分组锚点平滑滚动定位（tl-group-{encodeURIComponent(name)}）。
 */
import type { ReactNode } from 'react';
import { CountBadge } from '../atoms/Tag.tsx';

export interface GroupHeaderProps {
  name: string;
  count: number;
  /** 锚点定位用 DOM id；缺省由调用方用 encodeURIComponent(name) 生成。 */
  id?: string;
  right?: ReactNode;
}

export function GroupHeader({ name, count, id, right }: GroupHeaderProps) {
  return (
    <div id={id} className="flex h-8 shrink-0 scroll-mt-2 items-center gap-2">
      {/* min-w-0：组名超长时收缩并出省略号，而不是把右侧操作按钮挤成竖排。 */}
      <h2 className="t-sm w-emph min-w-0 truncate-1 text-[var(--fg)]">{name}</h2>
      <CountBadge count={count} />
      <div className="flex-1" />
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </div>
  );
}
