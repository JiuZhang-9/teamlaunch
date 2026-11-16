/**
 * BrandMark —— 产品 Logo：源图派生的「双色标」（1.9.0，2026-11-15 用户定稿）。
 *
 * 形状来自 gen-icon.cjs 从 build/icon-source.png 实算的 alpha 遮罩（暗/亮主题各一张，
 * 极性相反：暗=深色像素实心、亮=浅色像素实心；半透档 30% 能透出背景），颜色 = var(--accent)
 * 用 CSS mask 上色——主题色、亮暗主题切换即时生效，不重算图片。
 * 与任务栏/托盘的圆角实色企鹅（icon.ico / tray.ico）同一管线：换图标只换源图重跑脚本。
 * 1.8.5/1.8.6 的彩色企鹅位图（brand-mark.png）随之退役：脚本继续产出但不再被引用。
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return <span aria-hidden className="tl-brand-mark" style={{ width: size, height: size }} />;
}
