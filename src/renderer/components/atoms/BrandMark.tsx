/**
 * BrandMark —— 产品 Logo：应用图标（ip-as-logo 珊瑚企鹅）的圆角方图。
 * 与 build/icon.ico 同源（gen-icon.cjs 从 build/icon-source.png 派生
 * src/renderer/assets/brand-mark.png）——换图标只换源文件重跑脚本，本组件不用动。
 * 旧的手绘"T"字形（frame/solid 变体）随 1.8.5 换标退役，历史见 git。
 */
import brandMarkUrl from '../../assets/brand-mark.png';

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <img
      aria-hidden
      src={brandMarkUrl}
      width={size}
      height={size}
      alt=""
      style={{
        borderRadius: 'var(--radius-md, 8px)',
        display: 'block',
        flexShrink: 0,
      }}
    />
  );
}
