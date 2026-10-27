/**
 * 工作栏动作的溢出判定（2026-10-27，1.3.0）。
 *
 * 需求（用户原话）："工作栏按钮能放的就都放下，放不下的在最后一位加一个更多按钮变成下拉菜单"。
 * 这里只做**纯判定**：给定每个按钮的实测宽度、可用宽度、间距和「更多」按钮宽度，
 * 返回能直接显示几个。真正的测量（ResizeObserver + 隐藏测量行）留在 ContentHeader。
 *
 * 放进 shared 的理由与其它判定类纯函数一致：不启动 Electron / React 就能测全部分支
 * （scripts/verify-toolbar.mjs）。
 */

export interface FitResult {
  /** 能直接显示的动作数（0..widths.length）。 */
  visibleCount: number;
  /** 是否出现「更多」按钮。 */
  overflow: boolean;
  /** 实际占用宽度（含「更多」按钮与间隔），用于断言/调试。 */
  usedWidth: number;
}

export function fitItems(widths: number[], available: number, gap: number, moreWidth: number): FitResult {
  const n = widths.length;
  if (n === 0) return { visibleCount: 0, overflow: false, usedWidth: 0 };

  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
  if (total <= available) return { visibleCount: n, overflow: false, usedWidth: total };

  /* 需要「更多」时它自己也占宽度，且与前面的按钮之间有一个 gap。
     可用宽度连「更多」都放不下时返回 0：调用方仍会渲染「更多」，
     但那是布局已经不可能满足的极端情况（880px 最小窗宽下不会出现）。 */
  const budget = available - moreWidth - gap;
  if (budget <= 0) return { visibleCount: 0, overflow: true, usedWidth: moreWidth };

  let used = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const next = used + widths[i] + (i > 0 ? gap : 0);
    if (next > budget) break;
    used = next;
    count += 1;
  }
  return {
    visibleCount: count,
    overflow: true,
    usedWidth: used + (count > 0 ? gap : 0) + moreWidth,
  };
}
