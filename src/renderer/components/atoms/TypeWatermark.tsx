/**
 * 入口类型水印（2026-11-08 G1 定稿）—— 卡片右下角只露局部的类型线稿。
 *
 * 三个要点，改之前先看：
 *   1. 图形按 200×200 画布重画，不是把 24px Lucide 图标放大（放大会把描边一起放大，显粗糙）；
 *   2. 透明度加在**整组 `<g>`** 上，不是每条线各自半透明——球体经纬线交叉处不会叠成深色；
 *   3. 位置/角度/尺寸只在 `styles/index.css` 的 `.tl-entry-watermark` 里改，
 *      组件只负责形状与当前类型色。水印是装饰层，`aria-hidden`，不承载类型信息。
 */
import type { Entry } from '../../../shared/schema/entry.ts';
import { TYPE_META } from '../../lib/entry.ts';

/** 主轮廓 / 内部细节两级线宽；与 164px 的渲染尺寸配合，约 3.4px / 1.8px。 */
const STROKE = 4.2;
const DETAIL_STROKE = 2.2;

export function TypeWatermark({ type }: { type: Entry['type'] }) {
  return (
    <span
      aria-hidden
      className="tl-entry-watermark"
      style={{ color: TYPE_META[type].watermark }}
      data-tl-type-watermark={type}
    >
      <svg viewBox="0 0 200 200">
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          /* 整组一次透明度：组内线条先按实色合成，再整体变淡；交叉点不会重复叠色。 */
          opacity={0.1}
        >
          {type === 'app' && (
            <>
              <rect x="34" y="48" width="132" height="108" rx="17" />
              <path d="M34 78H166" />
              <path d="M116 78V156" strokeWidth={DETAIL_STROKE} />
            </>
          )}
          {type === 'folder' && (
            <>
              <path d="M30 70C30 58 38 50 50 50H84C93 50 100 55 106 63L112 71H156C168 71 176 79 176 91V134C176 146 168 154 156 154H50C38 154 30 146 30 134Z" />
              <path d="M40 110C70 118 130 118 160 110" strokeWidth={DETAIL_STROKE} />
            </>
          )}
          {type === 'web' && (
            <>
              <circle cx="100" cy="100" r="82" />
              <circle cx="100" cy="100" r="73" strokeWidth={DETAIL_STROKE} />
              <ellipse cx="100" cy="100" rx="34" ry="82" />
              <ellipse cx="100" cy="100" rx="82" ry="30" />
            </>
          )}
        </g>
      </svg>
    </span>
  );
}
