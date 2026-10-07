/**
 * EntryCard —— 三类入口共用同一张卡片骨架（152 × 132，圆角 12）。
 *
 * 九态矩阵实现位置：Default / Hover / Focus-visible / Active / Disabled / Loading /
 * Error / Empty（图标缺失回退）/ Selected。
 *
 * 三重类型通道（AC-03）：12px 类型角标图标 + 副标签里的类型文字前缀 + 容器 tint（第三通道）。
 */
import { forwardRef, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, GripVertical, MessageSquareWarning, Pencil, Star, TriangleAlert, Trash } from 'lucide-react';
import type { Entry } from '../../../shared/schema/entry.ts';
import { TYPE_META, failureSubtitleOf, subtitleOf, targetFull } from '../../lib/entry.ts';
import { Glyph, IconFrame, Monogram } from '../atoms/Icon.tsx';
import { Spinner } from '../atoms/Skeleton.tsx';
import { useEntryIcon } from '../../hooks/useEntryIcon.ts';
import { firstLetterOf } from '../../lib/entry.ts';

export type CardMode = 'readonly' | 'personal' | 'editing';

export interface EntryCardProps {
  entry: Entry;
  source: 'team' | 'personal';
  mode: CardMode;
  phase?: 'idle' | 'opening' | 'failed';
  /** 真实失败原因（workbench runtime），用于失败副标签说实话。 */
  failure?: import('../../bridge/types.ts').OpenFailure;
  /** HTML5 拖拽束（个人页与编辑态）：由 CardGrid 提供处理器与落点指示。 */
  drag?: import('../molecules/CardGrid.tsx').CardDragProps;
  selected?: boolean;
  disabled?: boolean;
  pendingFeedback?: boolean;
  tabIndex?: number;
  onOpen(): void;
  onEdit?(): void;
  onDelete?(): void;
  onContextMenu?(e: MouseEvent): void;
  /** 多选连锁启动（2026-10-05）：多选模式下点击=加入/移出清单，不打开。 */
  selecting?: boolean;
  /** 1 基的启动顺序；未选中为 null。 */
  selectionOrder?: number | null;
  onToggleSelect?(): void;
  /** 收藏（2026-10-05）：常驻右上星标——空心=未收藏，黄色实心=已收藏。 */
  favorite?: boolean;
  onToggleFavorite?(): void;
  onKeyDown?(e: KeyboardEvent<HTMLButtonElement>): void;
}

export const EntryCard = forwardRef<HTMLButtonElement, EntryCardProps>(function EntryCard(
  {
    entry,
    source,
    mode,
    phase = 'idle',
    failure,
    drag,
    selected = false,
    disabled = false,
    pendingFeedback = false,
    tabIndex = -1,
    onOpen,
    onEdit,
    onDelete,
    onContextMenu,
    selecting = false,
    selectionOrder = null,
    onToggleSelect,
    favorite = false,
    onToggleFavorite,
    onKeyDown,
  },
  ref,
) {
  const meta = TYPE_META[entry.type];
  const emojiChar = entry.icon.kind === 'emoji' ? entry.icon.char : null;
  // 表情图标内联渲染，不走提取管道：换表情立刻生效（含编辑草稿态），也无缓存时效问题。
  const iconUrl = useEntryIcon(entry, entry.icon.kind === 'local');
  const lastOpen = useRef(0);
  const failed = phase === 'failed';
  const loading = phase === 'opening';
  const editing = mode === 'editing';

  const border = failed
    ? '1px solid var(--danger-solid)'
    : editing
      ? '1px solid var(--card-border-editing)'
      : selected
        ? '2px solid var(--accent)'
        : '1px solid var(--card-border)';

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={disabled ? 0 : tabIndex}
      aria-disabled={disabled || undefined}
      aria-selected={selected || undefined}
      data-mode={mode}
      data-state={failed ? 'error' : loading ? 'loading' : 'default'}
      draggable={selecting ? false : drag?.draggable}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
      onClick={(e) => {
        if (disabled) return;
        // Ctrl+点击：不开多选模式也能把卡片按顺序加入连锁清单（方案 A，2026-10-06 用户拍板）。
        if ((e.ctrlKey || e.metaKey) && onToggleSelect) {
          e.preventDefault();
          onToggleSelect();
          return;
        }
        if (selecting && onToggleSelect) {
          onToggleSelect();
          return;
        }
        // 双击不得打开两次：同一个事件循环内的第二次点击在 350ms 窗口内被吞掉。
        const now = Date.now();
        if (now - lastOpen.current < 350) return;
        lastOpen.current = now;
        onOpen();
      }}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      title={targetFull(entry)}
      aria-label={`${entry.name}，${meta.label}，${source === 'team' ? '团队入口' : '我的入口'}`}
      className={[
        'group relative flex flex-col items-start text-left',
        'rounded-lg p-3 w-full',
        /* 背景/静置阴影走类：内联会压过 hover:/focus-visible:/active: 的同名规则，
           悬浮亮度、悬浮阴影、键盘焦点环全部失效（2026-10-03 实测定位）。 */
        'bg-[var(--card-bg)] shadow-[var(--card-elev)]',
        'transition-[background-color,border-color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        'focus-visible:shadow-[var(--ring-focus)]',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        selected ? '' : 'active:bg-[var(--card-bg-active)]',
        failed ? '' : 'hover:-translate-y-0.5 hover:bg-[var(--card-bg-hover)] hover:shadow-[var(--card-elev-hover)]',
        drag?.dragging ? 'opacity-40' : '',
      ].join(' ')}
      style={{
        height: 'var(--card-h)',
        border,
      }}
    >
      {/* 多选/Ctrl+点选：左上勾选圈 + 右上顺序徽标（顺序=点击顺序，即连锁启动顺序） */}
      {(selecting || selectionOrder != null) && (
        <span
          aria-hidden
          className="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full border"
          style={{
            background: selectionOrder ? 'var(--accent)' : 'var(--bg-surface)',
            borderColor: selectionOrder ? 'var(--accent)' : 'var(--border-strong)',
            color: selectionOrder ? 'var(--accent-on, #fff)' : 'var(--meta)',
          }}
        >
          {selectionOrder ? <Check size={12} strokeWidth={3} /> : null}
        </span>
      )}
      {selectionOrder != null && (
        <span
          aria-hidden
          className="absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] leading-none font-[var(--weight-emphasize)]"
          style={{ background: 'var(--accent)', color: 'var(--accent-on, #fff)' }}
        >
          {selectionOrder}
        </span>
      )}
      {onToggleFavorite && !selecting && (
        <button
          type="button"
          aria-label={favorite ? '取消收藏 ' + entry.name : '收藏 ' + entry.name}
          aria-pressed={favorite || undefined}
          title={favorite ? '取消收藏' : '收藏到主页'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
        >
          <Star
            size={15}
            strokeWidth={2}
            aria-hidden
            style={
              favorite
                ? { color: 'var(--favorite-star)', fill: 'var(--favorite-star)' }
                : { color: 'var(--meta)', fill: 'transparent', strokeDasharray: '2.5 2.5' }
            }
          />
        </button>
      )}
      {/* 拖拽落点指示：悬停侧缘 2px 强调色竖线 */}
      {drag?.dropSide && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-full"
          style={{
            width: 2,
            background: 'var(--accent)',
            [drag.dropSide === 'before' ? 'left' : 'right']: -4,
          }}
        />
      )}
      {/* S1 定稿：非编辑态 hover 左缘 2px 主题色竖条（编辑态左上已有常驻 grip，不叠加） */}
      {!editing && (
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100"
          style={{ background: 'var(--accent)' }}
        />
      )}
      {/* 编辑态：左上常驻句柄（"这张卡能拖"的持续信号，不靠 hover） */}
      {editing && (
        <span
          aria-hidden
          className="absolute left-0.5 top-1 text-[var(--meta)]"
          style={{ width: 24, height: 24, display: 'grid', placeItems: 'center' }}
        >
          <GripVertical size={16} strokeWidth={2} />
        </span>
      )}

      {/* 右上操作区：编辑态常驻；个人页 hover/focus 出现。命中区 24×24，视觉 16。 */}
      {(editing || mode === 'personal') && (
        <span
          className={[
            'absolute top-1 flex items-center gap-1',
            onToggleFavorite ? 'right-[30px]' : 'right-0.5',
            editing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            'transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
          ].join(' ')}
        >
          {mode === 'personal' && (
            <span
              aria-hidden
              className="grid text-[var(--meta)]"
              style={{ width: 24, height: 24, placeItems: 'center' }}
            >
              <GripVertical size={16} strokeWidth={2} />
            </span>
          )}
          {onEdit && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`编辑 ${entry.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="grid text-[var(--fg-2)] hover:bg-surface-hover hover:text-fg rounded-sm"
              style={{ width: 24, height: 24, placeItems: 'center' }}
            >
              <Pencil size={16} strokeWidth={2} />
            </span>
          )}
          {onDelete && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={`删除 ${entry.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="grid text-[var(--fg-2)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger-fg)] rounded-sm"
              style={{ width: 24, height: 24, placeItems: 'center' }}
            >
              <Trash size={16} strokeWidth={2} />
            </span>
          )}
        </span>
      )}

      <span className="relative">
        <IconFrame tint={meta.tint}>
          {loading ? (
            <Spinner size={24} />
          ) : emojiChar ? (
            <span
              aria-hidden
              className="grid place-items-center"
              style={{ fontSize: 26, lineHeight: 1 }}
            >
              {emojiChar}
            </span>
          ) : iconUrl ? (
            <img
              src={iconUrl}
              alt=""
              width={32}
              height={32}
              className="rounded-sm"
              style={{ objectFit: 'contain' }}
            />
          ) : entry.icon.kind === 'fallback' ? (
            <Monogram letter={firstLetterOf(entry.name)} size={17} />
          ) : (
            <Glyph icon={meta.icon} size={24} />
          )}
        </IconFrame>
        {/* 类型角标：永远显示，是关闭颜色后的第一通道 */}
        <span
          className="absolute grid place-items-center rounded-sm bg-[var(--bg-surface)]"
          style={{ right: -2, bottom: -2, width: 12, height: 12 }}
        >
          <Glyph icon={meta.icon} size={12} micro />
        </span>
        {failed && (
          <span
            className="absolute grid place-items-center rounded-sm bg-[var(--bg-surface)]"
            style={{ right: -4, top: -4, width: 12, height: 12, color: 'var(--danger-fg)' }}
          >
            <TriangleAlert size={12} strokeWidth={1.75} />
          </span>
        )}
      </span>

      <span className="mt-1.5 w-full">
        <span
          className={[
            't-sm w-emph clamp-2',
            disabled ? 'text-[var(--disabled-fg)]' : 'text-[var(--card-title)]',
          ].join(' ')}
        >
          {entry.name || '未命名入口'}
        </span>
        <span
          className={[
            't-xs w-read mt-0.5 truncate-1',
            failed
              ? 'text-[var(--danger-fg)]'
              : disabled
                ? 'text-[var(--disabled-fg)]'
                : 'text-[var(--card-subtitle)]',
          ].join(' ')}
        >
          {failed ? failureSubtitleOf(entry, failure) : subtitleOf(entry)}
        </span>
      </span>

      {/* 待发送反馈角标（AC-13）：排队 ≠ 送达，角标只说明"有一条还没发出去" */}
      {pendingFeedback && (
        <span
          aria-label="有一条待发送的失效反馈"
          title="有一条待发送的失效反馈"
          className="absolute bottom-1 right-1 grid place-items-center text-[var(--warn-fg)]"
          style={{ width: 16, height: 16 }}
        >
          <MessageSquareWarning size={12} strokeWidth={1.75} />
        </span>
      )}
    </button>
  );
});
