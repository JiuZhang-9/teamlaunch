/**
 * ProgressRing —— 圆形进度环（2026-10-18，工作区小窗的"正在下载新版本"用）。
 *
 * 为什么是环而不是条：它要挤在 236px 宽的小窗里、和一段说明文字并排，
 * 圆环比横条更省横向空间，也和"后台在做事、你可以继续用"的语气相称。
 *
 * 颜色一律走令牌（硬编码色值会被 verify:p0 / verify:tokens 抓）；无障碍用 progressbar 角色如实报数。
 */
export interface ProgressRingProps {
  /** 0–100；超出范围会被夹回。 */
  percent: number;
  size?: number;
  strokeWidth?: number;
  /** 无障碍名（必填：进度环本身没有可见标题）。 */
  label: string;
  className?: string;
  /** false = 不画环内的百分比文字（外面已经有数字时，例如顶栏胶囊）。 */
  showValue?: boolean;
}

export function ProgressRing({ percent, size = 36, strokeWidth = 3.5, label, className = '', showValue = true }: ProgressRingProps) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (value / 100) * circumference;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={label}
      className={['relative inline-grid shrink-0 place-items-center', className].join(' ')}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          style={{ transition: 'stroke-dasharray var(--motion-fast) linear' }}
        />
      </svg>
      {showValue && <span className="t-2xs absolute leading-none text-[var(--fg-2)]">{value}%</span>}
    </span>
  );
}
