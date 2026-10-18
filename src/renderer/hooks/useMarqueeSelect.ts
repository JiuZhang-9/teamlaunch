/**
 * 框选多选（2026-10-18 用户要求："目前多选需要右键或 Ctrl 点选，希望能直接添加框选功能。
 * 现在直接框选会选中界面上的文字，不太对，希望能直接框选对应的卡片。"）
 *
 * 行为：
 *  - 在卡片区**空白处**按下左键并拖动 → 画出选框，松开时把与选框相交的卡片纳入多选；
 *  - 按住 Ctrl / Shift 拖 = 并入现有清单（不按 = 替换成这一批）；
 *  - 从卡片、按钮、输入框上起手一律不算框选（那些地方各有各的动作）；
 *  - 拖动期间 `html.tl-marquee` 关掉文字选择（否则拖出一片蓝底文字），松开即恢复。
 *
 * 命中判定：卡片自身带 `data-tl-card-id`，用**视口坐标**的矩形相交判断——
 * 与滚动容器无关，滚到哪都能正确框住（卡片 rect 与选框 rect 都是视口坐标）。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** 拖动距离小于它视为"点了一下空白处"，不产生选择（避免误触清空/误选）。 */
const MIN_DRAG_PX = 4;

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 起手位置在交互元素上时不启动框选。 */
const INTERACTIVE = 'button, a, input, textarea, select, [contenteditable="true"], [role="dialog"], [data-tl-card-id]';

function intersect(a: DOMRect, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const left = Math.min(r.x0, r.x1);
  const right = Math.max(r.x0, r.x1);
  const top = Math.min(r.y0, r.y1);
  const bottom = Math.max(r.y0, r.y1);
  return a.left < right && a.right > left && a.top < bottom && a.bottom > top;
}

export interface MarqueeOptions {
  /** 选框容器（卡片区所在的元素）。 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 松开时回调：命中的卡片 id（按 DOM 顺序）+ 是否并入现有选择。 */
  onSelect(ids: string[], additive: boolean): void;
  /** 关掉框选（例如筛选态、编辑对话框打开时）。 */
  enabled?: boolean;
}

export function useMarqueeSelect({ containerRef, onSelect, enabled = true }: MarqueeOptions) {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const startRef = useRef<{ x0: number; y0: number } | null>(null);
  const lastHits = useRef<HTMLElement[]>([]);
  /** 回调放 ref：常挂的 window 监听器不该因为父组件每次渲染产生的新闭包而重挂。 */
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const clearHits = useCallback(() => {
    for (const el of lastHits.current) el.removeAttribute('data-tl-marquee-hit');
    lastHits.current = [];
  }, []);

  const stop = useCallback(() => {
    startRef.current = null;
    setRect(null);
    clearHits();
    document.documentElement.classList.remove('tl-marquee');
  }, [clearHits]);

  /** 拖动中：算命中并就地高亮（outline 不改几何，不会引起重排）。 */
  const paint = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const box = { x0, y0, x1, y1 };
      setRect({
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      });
      const container = containerRef.current;
      clearHits();
      if (!container) return;
      const hit: HTMLElement[] = [];
      for (const el of container.querySelectorAll<HTMLElement>('[data-tl-card-id]')) {
        if (intersect(el.getBoundingClientRect(), box)) {
          el.setAttribute('data-tl-marquee-hit', 'true');
          hit.push(el);
        }
      }
      lastHits.current = hit;
    },
    [clearHits, containerRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(INTERACTIVE)) return;
      const container = containerRef.current;
      /* 没有卡片就不必开始（主页/空列表上拖拽仍应是原生的选区行为）。 */
      if (!container || container.querySelector('[data-tl-card-id]') === null) return;
      e.preventDefault();
      startRef.current = { x0: e.clientX, y0: e.clientY };
      document.documentElement.classList.add('tl-marquee');
      paint(e.clientX, e.clientY, e.clientX, e.clientY);
    },
    [containerRef, enabled, paint],
  );

  /* 监听器**常挂**（不依赖 dragging 的挂载时机）：
     最初写成"拖动开始时才挂"，看似省事，实际有个一帧的缝——pointerdown 里 setDragging(true)
     要等 React 重渲染后 effect 才跑，若按下与移动落在同一帧（合成事件/极快的手势），
     那一记 pointermove 就没人接，选框卡在起点。常挂 + startRef 守卫没有这个缝。 */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const s = startRef.current;
      if (s === null) return;
      paint(s.x0, s.y0, e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      const s = startRef.current;
      if (s === null) return;
      const moved = Math.abs(e.clientX - s.x0) >= MIN_DRAG_PX || Math.abs(e.clientY - s.y0) >= MIN_DRAG_PX;
      const hits = moved ? lastHits.current : [];
      const ids = hits
        .map((el) => el.getAttribute('data-tl-card-id'))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
      const additive = e.ctrlKey || e.metaKey || e.shiftKey;
      stop();
      if (moved && ids.length > 0) onSelectRef.current(ids, additive);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [stop, paint]);

  /* 卸载兜底：万一在拖动中被切走（切页/退出多选），别把 user-select:none 留在 html 上。 */
  useEffect(() => () => {
    document.documentElement.classList.remove('tl-marquee');
  }, []);

  return { rect, onPointerDown };
}
