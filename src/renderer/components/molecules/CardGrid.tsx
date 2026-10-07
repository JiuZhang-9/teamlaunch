/**
 * CardGrid —— 卡片网格容器 + roving tabindex 键盘导航 + HTML5 拖拽排序/跨组移动。
 *
 * 列数**由可用宽度推导**，不写死：`floor((W + 16) / (140 + 16))`。
 * 992px → 6 列（列宽 152）；704px 最小窗口 → 4 列。
 * 配合覆盖式滚动条（原生条宽度归零）才能保证 992 不被挤成 982（K-A）。
 *
 * 拖拽：dragEnabled 时卡片可拖动；拖到本组卡片上 = 按左右半区插到其前/后；
 * 拖到另一组的网格 = 跨组移动（dataTransfer 携带入口 id，落点组各自接住）。
 * 指示器：悬停卡片左/右缘显示 2px 强调色竖线。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

const GAP = 16;
const MIN_CARD = 140;
const DRAG_MIME = 'text/tl-entry';

export interface CardDragProps {
  draggable: boolean;
  onDragStart(e: DragEvent<HTMLButtonElement>): void;
  onDragOver(e: DragEvent<HTMLButtonElement>): void;
  onDrop(e: DragEvent<HTMLButtonElement>): void;
  onDragEnd(e: DragEvent<HTMLButtonElement>): void;
  /** 当前指针悬停的插入侧（仅拖拽进行中且悬停在本卡时非空）。 */
  dropSide: 'before' | 'after' | null;
  /** 本卡是拖拽源（压暗显示）。 */
  dragging: boolean;
}

export interface CardFocusProps {
  tabIndex: number;
  onFocus(): void;
  onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
  cardRef: Ref<HTMLButtonElement>;
  drag?: CardDragProps;
}

export interface CardGridProps<T> {
  items: T[];
  getKey(item: T): string;
  render(item: T, focus: CardFocusProps, index: number): ReactNode;
  onActivate(item: T): void;
  ariaLabel?: string;
  /**
   * Alt+↑/↓ 重排序（组内换位）。提供时方向键在 Alt 修饰下从"移动焦点"变为"移动卡片"。
   * 整理顺序提示文案承诺的就是这个行为——此前从未接线，点了没反应。
   */
  onReorder?(item: T, delta: -1 | 1): void;
  /** 开启 HTML5 拖拽（个人页与团队编辑态；只读团队页不可拖）。 */
  dragEnabled?: boolean;
  /** 拖放落点在本组网格内：draggedId + 插入位置（落点前移除语义）。 */
  onDropEntry?(draggedId: string, toIndex: number): void;
  /** 拖拽开始时上报给上层（跨网格共享拖拽态）。 */
  onDragStartEntry?(entryId: string): void;
  /**
   * 跨网格读取当前拖拽 id：Chromium 对非受信任事件的 dataTransfer.getData()
   * 一律返回空串（安全限制），跨组投放时只能靠上层共享的 ref 传 id。
   */
  externalDraggingId?(): string | null;
  /** 拖拽结束（drop/dragend）时通知上层清共享态。 */
  onDragEndEntry?(): void;
}

export function CardGrid<T>({
  items,
  getKey,
  render,
  onActivate,
  ariaLabel,
  onReorder,
  dragEnabled = false,
  onDropEntry,
  onDragStartEntry,
  externalDraggingId,
  onDragEndEntry,
}: CardGridProps<T>) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cells = useRef<Array<HTMLButtonElement | null>>([]);
  const [columns, setColumns] = useState(6);
  const [focusIndex, setFocusIndex] = useState(0);
  /** 拖拽悬停指示：落点索引 + 相对侧；draggingId 用于压暗源卡。 */
  const [dropAt, setDropAt] = useState<{ index: number; side: 'before' | 'after' } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  /** 最近一次"卡片级"悬停的精确落点：drop 读它而不是 state——
      卡片 dragover 会冒泡到网格容器，容器的 append 语义不能覆盖精确落点。 */
  const lastCardHoverRef = useRef<{ index: number; side: 'before' | 'after' } | null>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setColumns(Math.max(1, Math.floor((el.clientWidth + GAP) / (MIN_CARD + GAP))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (focusIndex > items.length - 1) setFocusIndex(Math.max(0, items.length - 1));
  }, [items.length, focusIndex]);

  const move = useCallback((next: number) => {
    setFocusIndex(next);
    cells.current[next]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLButtonElement>, item: T) => {
      const col = index % columns;
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (col < columns - 1 && index + 1 < items.length) move(index + 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (col > 0) move(index - 1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          // Alt 修饰 = 组内重排序（与「整理顺序」提示文案一致）；否则是网格导航。
          if (e.altKey && onReorder) {
            onReorder(item, 1);
            break;
          }
          if (index + columns < items.length) move(index + columns);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (e.altKey && onReorder) {
            onReorder(item, -1);
            break;
          }
          if (index - columns >= 0) move(index - columns);
          break;
        case 'Home':
          e.preventDefault();
          move(0);
          break;
        case 'End':
          e.preventDefault();
          move(items.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onActivate(item);
          break;
        default:
          break;
      }
    },
    [columns, items.length, move, onActivate, onReorder],
  );

  /* ---------------- HTML5 拖拽（组内排序 + 跨组移动） ---------------- */
  const readDraggedId = (e: DragEvent<HTMLElement>): string =>
    e.dataTransfer.getData(DRAG_MIME) || draggingIdRef.current || externalDraggingId?.() || '';

  const clearDrag = useCallback(() => {
    setDropAt(null);
    setDraggingId(null);
    draggingIdRef.current = null;
    onDragEndEntry?.();
  }, [onDragEndEntry]);

  const makeDrag = useCallback(
    (item: T, index: number): CardDragProps | undefined => {
      if (!dragEnabled) return undefined;
      const id = getKey(item);
      return {
        draggable: true,
        dragging: draggingId === id,
        dropSide:
          dropAt && dropAt.index < items.length && getKey(items[dropAt.index]) === id ? dropAt.side : null,
        onDragStart: (e) => {
          e.dataTransfer.setData(DRAG_MIME, id);
          e.dataTransfer.effectAllowed = 'move';
          draggingIdRef.current = id;
          setDraggingId(id);
          onDragStartEntry?.(id);
        },
        onDragOver: (e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          // 必须阻断冒泡：网格容器的 onDragOver 是"追加到组尾"语义，
          // 卡片 dragover 冒泡过去会把精确落点覆盖成组尾（往左拖无效的根因）。
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const before = e.clientX < rect.left + rect.width / 2;
          const hit = { index: before ? index : index + 1, side: (before ? 'before' : 'after') as 'before' | 'after' };
          lastCardHoverRef.current = hit;
          setDropAt(hit);
        },
        onDrop: (e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          const draggedId = readDraggedId(e);
          // 落点优先读 ref（最后悬停的精确位置），state 只是指示器的渲染源。
          const target = lastCardHoverRef.current?.index ?? dropAt?.index ?? index + 1;
          lastCardHoverRef.current = null;
          if (draggedId && draggedId !== id) onDropEntry?.(draggedId, target);
          clearDrag();
        },
        onDragEnd: clearDrag,
      };
    },
    // draggingId 必须在依赖里：漏掉会让 makeDrag 闭包停在旧值，拖拽源永远不压暗。
    [dragEnabled, getKey, dropAt, items, draggingId, onDropEntry, onDragStartEntry, clearDrag],
  );

  /** 网格空白区（组尾）也接受投放：追加到本组末尾。 */
  const gridDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!dragEnabled || !e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropAt({ index: items.length, side: 'after' });
    },
    [dragEnabled, items.length],
  );

  const gridDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!dragEnabled || !e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      const draggedId = readDraggedId(e);
      if (draggedId) onDropEntry?.(draggedId, items.length);
      clearDrag();
    },
    [dragEnabled, items.length, onDropEntry, clearDrag],
  );

  return (
    <div
      ref={gridRef}
      role="list"
      aria-label={ariaLabel}
      className="grid"
      style={{ gap: 'var(--grid-gap)', gridTemplateColumns: 'repeat(auto-fill, minmax(var(--card-w-min), 1fr))' }}
      onDragOver={gridDragOver}
      onDrop={gridDrop}
    >
      {/* 空组必须有可悬停的投放区：零高度网格收不到任何 dragover——"空组拖不进"的根因。 */}
      {dragEnabled && items.length === 0 && (
        <div
          aria-hidden
          className="col-span-full grid place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] t-xs text-[var(--meta)]"
          style={{ minHeight: 72, background: dropAt ? 'var(--accent-tint)' : 'transparent' }}
        >
          {dropAt ? '松开鼠标，移动到这个分组' : '把卡片拖到这里'}
        </div>
      )}
      {items.map((item, i) => (
        <div key={getKey(item)} role="listitem" className="min-w-0">
          {render(
            item,
            {
              tabIndex: i === focusIndex ? 0 : -1,
              onFocus: () => setFocusIndex(i),
              onKeyDown: (e) => onKeyDown(i, e, item),
              cardRef: (el) => {
                cells.current[i] = el;
              },
              drag: makeDrag(item, i),
            },
            i,
          )}
        </div>
      ))}
    </div>
  );
}
