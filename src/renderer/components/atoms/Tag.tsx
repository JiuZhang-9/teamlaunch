/**
 * 三类小标签：TypeTag（类型文字）/ SourceTag（团队·本机）/ CountBadge（N 项）。
 *
 * AC-03 要求「类型图标 + 类型文字」双通道：TypeTag 是文字通道的载体，
 * 它是关闭颜色辨识后仍能分辨类型的关键，任何页面都不得省略。
 */
const BASE = [
  'inline-flex shrink-0 items-center rounded-[var(--radius-sm)]',
  'px-1.5 py-0.5 t-xs text-[var(--tag-fg)] bg-[var(--tag-bg)]',
].join(' ');

export function TypeTag({ label }: { label: string }) {
  return <span className={BASE}>{label}</span>;
}

export function SourceTag({ source }: { source: string }) {
  return <span className={BASE}>{source}</span>;
}

export function CountBadge({ count, unit = '项' }: { count: number; unit?: string }) {
  return (
    <span className={`${BASE} t-2xs text-[var(--muted)]`}>
      {count} {unit}
    </span>
  );
}
