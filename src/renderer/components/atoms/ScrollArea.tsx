/**
 * 覆盖式滚动容器（K-A 的落地处）。
 *
 * 为什么必须自己画滑块：`::-webkit-scrollbar { width: 10px }` 与 `scrollbar-width: thin`
 * 在 Chromium 上都会**占据布局宽度**，可用宽从 992 掉到 982，6 列立刻变 5 列。
 * 本组件把原生条宽度归零（.tl-scroll），再用一个绝对定位的浮层滑块自己画，
 * 布局宽度永远是完整的 992。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion.ts';

export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  /** 恢复到上次离开时的滚动位置（切 Tab 保留滚动位置，AC-08 相关）。 */
  initialTop?: number;
  onScrollTop?(top: number): void;
  ariaLabel?: string;
}

export function ScrollArea({
  children,
  className = '',
  initialTop = 0,
  onScrollTop,
  ariaLabel,
}: ScrollAreaProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState({ top: 0, height: 0, visible: false });
  const [dragging, setDragging] = useState(false);
  /** 滚动中标记：滑块只在滚动期间显示，停止 800ms 后淡出（用户反馈：悬停常显太吵）。 */
  const [scrolling, setScrolling] = useState(false);
  const scrollIdleTimer = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
  /** initialTop 只在挂载时用一次：之后由父级记录，避免每次渲染把用户滚回去。 */
  const initialTopRef = useRef(initialTop);

  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const track = clientHeight;
    if (scrollHeight <= clientHeight + 1) {
      setThumb((t) => ({ ...t, visible: false }));
      return;
    }
    const height = Math.max(28, (track * clientHeight) / scrollHeight);
    const max = scrollHeight - clientHeight;
    const top = ((track - height) * scrollTop) / max;
    setThumb({ top, height, visible: true });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTop = initialTopRef.current;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const el = boxRef.current;
      const start = dragRef.current;
      if (!el || !start) return;
      const max = el.scrollHeight - el.clientHeight;
      const track = el.clientHeight - thumb.height;
      const delta = ((e.clientY - start.startY) / Math.max(1, track)) * max;
      el.scrollTop = Math.min(max, Math.max(0, start.startTop + delta));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, thumb.height]);

  useEffect(() => {
    return () => {
      if (scrollIdleTimer.current !== null) window.clearTimeout(scrollIdleTimer.current);
    };
  }, []);

  return (
    <div className={`tl-scroll-area ${className}`} data-scrolling={scrolling || dragging ? 'true' : undefined}>
      <div
        ref={boxRef}
        role="group"
        aria-label={ariaLabel}
        onScroll={() => {
          measure();
          onScrollTop?.(boxRef.current?.scrollTop ?? 0);
          setScrolling(true);
          if (scrollIdleTimer.current !== null) window.clearTimeout(scrollIdleTimer.current);
          scrollIdleTimer.current = window.setTimeout(() => setScrolling(false), 800);
        }}
        className={`tl-scroll h-full ${reduced ? '' : 'scroll-smooth'}`}
        style={{ overflowY: 'auto', height: '100%' }}
      >
        {children}
      </div>
      {thumb.visible && (
        <div
          data-dragging={dragging ? 'true' : undefined}
          role="scrollbar"
          aria-controls="tl-scroll-content"
          aria-orientation="vertical"
          aria-valuenow={Math.round(thumb.top)}
          tabIndex={-1}
          onPointerDown={(e) => {
            e.preventDefault();
            dragRef.current = {
              startY: e.clientY,
              startTop: boxRef.current?.scrollTop ?? 0,
            };
            setDragging(true);
          }}
          className="tl-scroll-thumb"
          style={{ height: thumb.height, transform: `translateY(${thumb.top}px)` }}
        />
      )}
    </div>
  );
}
