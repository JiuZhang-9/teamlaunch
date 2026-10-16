/**
 * 卡片统计条（2026-10-17 用户要求）：总数 + 按类型分列，放在内容区顶部。
 *
 * 只显示**卡片数量**（从当前可见的配置数出来，筛选生效时显示筛选后的数量——与眼睛看到的一致）；
 * **点击次数不在界面上显示**（用户拍板：那些只记在本机文件里，见 main/usageStats.ts）。
 * 类型文字走 `TYPE_META`（与卡片角标同一语域），计数口径走 shared 的 `countEntries`。
 */
import type { Entry } from '../../../shared/schema/entry.ts';
import { countEntries } from '../../../shared/entry-counts.ts';
import { TYPE_META } from '../../lib/entry.ts';

export function CardStatsBar({
  groups,
  className = '',
}: {
  groups: Array<{ entries: Entry[] }>;
  className?: string;
}) {
  const { total, byType } = countEntries(groups);
  if (total === 0) return null;
  return (
    <p className={`t-xs mb-3 text-[var(--muted)] ${className}`.trim()}>
      共 {total} 个入口 · {TYPE_META.app.label} {byType.app} · {TYPE_META.folder.label} {byType.folder} ·{' '}
      {TYPE_META.web.label} {byType.web}
    </p>
  );
}
