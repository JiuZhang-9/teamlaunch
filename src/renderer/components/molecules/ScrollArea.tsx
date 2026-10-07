/**
 * 覆盖式滚动容器 —— K-A 的正面解法。
 *
 * 占位式滚动条会把内容区可用宽度从 992 变成 982，6 列立刻掉成 5 列，
 * 而这个问题在代码审查里几乎看不出来（只能肉眼数卡片）。
 *
 * 做法：原生滚动容器保留（滚轮 / 触控板 / 键盘全部原生可用），
 * 原生滚动条宽度归零（不占布局），另画一条绝对定位的覆盖式滑块。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const THUMB_MIN = 28;
const IDLE_MS = 900;

export function ScrollArea({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ height: 0, top: 0, visible: false });
  const idle = useRef<number | null>(null);
  const dragging = useRef<{ startY: number; startScroll: number } | null>(null);

  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumb((t) => ({ ...t, visible: false }));
      return;
    }
    const ratio = clientHeight / scrollHeight;
    const height = Math.max(THUMB_MIN, ratio * clientHeight);
    const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height);
    setThumb({ height, top, visible: true });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [measure, children]);

  const keepAwake = useCallback(() => {
    if (idle.current) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      setThumb((t) => (dragging.current ? t : { ...t, visible: false }));
    }, IDLE_MS);
  }, []);

  const onScroll = useCallback(() => {
    measure();
    keepAwake();
  }, [measure, keepAwake]);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return;
    dragging.current = { startY: e.clientY, startScroll: el.scrollTop };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = boxRef.current;
    const start = dragging.current;
    if (!el || !start) return;
    const track = el.clientHeight - thumb.height;
    const delta = ((e.clientY - start.startY) / Math.max(1, track)) * (el.scrollHeight - el.clientHeight);
    el.scrollTop = start.startScroll + delta;
  };

  const endDrag = (e: React.PointerEvent) => {
    dragging.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    measure();
  };

  return (
    <div className={`relative ${className}`}>
      <div
        ref={boxRef}
        onScroll={onScroll}
        onPointerEnter={keepAwake}
        onPointerMove={keepAwake}
        className="tl-scroll h-full overflow-y-auto overflow-x-hidden"
        aria-label={label}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 h-full"
        style={{
          width: 'var(--scrollbar-size)',
          opacity: thumb.visible ? 1 : 0,
          transition: 'opacity var(--motion-fast) var(--ease-standard)',
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="pointer-events-auto absolute right-0 rounded-pill"
          style={{
            width: 'var(--scrollbar-size)',
            height: thumb.height,
            transform: `translateY(${thumb.top}px)`,
            background: 'var(--scrollbar-thumb)',
          }}
        />
      </div>
    </div>
  );
}
