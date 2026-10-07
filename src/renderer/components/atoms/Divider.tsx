/** Divider：1px 分隔线。支持左右缩进（结果行分隔线左缩进 60px 对齐文字起点）。 */
export function Divider({ inset = 0, right = 0 }: { inset?: number; right?: number }) {
  return (
    <span
      role="separator"
      className="block h-px w-full bg-[var(--border-subtle)]"
      style={{ marginLeft: inset, width: `calc(100% - ${inset + right}px)` }}
    />
  );
}
