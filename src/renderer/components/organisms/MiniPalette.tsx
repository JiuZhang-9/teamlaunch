/**
 * MiniPalette —— 迷你唤起面板（V-03）。
 *
 * 三条硬约束：
 *  1. **预热隐藏窗口**（K-D 同类）：本面板在预览里常驻挂载但 `hidden`，
 *     唤起只做显示 + 聚焦，不重新挂载组件树（冷启动必超 80ms 预算）。
 *  2. **Tab 禁用**：面板内只有一个输入焦点，Tab 会把焦点丢出面板。
 *  3. **本视图 100% 本地**，不得出现任何网络请求相关字样。
 */
import { ChevronDown, ChevronUp, RotateCcwClock, Search } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { SearchInput } from '../atoms/SearchInput.tsx';
import { EmptyBlock } from '../molecules/EmptyBlock.tsx';
import { ResultRow } from '../molecules/ResultRow.tsx';
import { SourceTag } from '../atoms/Tag.tsx';
import type { Entry } from '../../../shared/schema/entry.ts';

export interface PaletteHit {
  entry: Entry;
  subtitle: string;
  source: '团队' | '本机';
}

export interface MiniPaletteProps {
  open: boolean;
  query: string;
  onQueryChange(v: string): void;
  hits: PaletteHit[];
  selectedIndex: number;
  onSelectIndex(i: number): void;
  iconFor(entryId: string): string | null;
  onOpen(hit: PaletteHit): void;
  onClose(): void;
  /** 团队数据为空（从未成功同步）时追加一行说明 */
  teamUnavailable: boolean;
  /**
   * docked = 渲染在独立面板窗口里：面板铺满窗口，不再做居中浮层
   * （overlay 形态供主窗口内唤起用；两种形态共用同一套键盘与结果逻辑）。
   */
  docked?: boolean;
}

export function MiniPalette(props: MiniPaletteProps) {
  const {
    open, query, onQueryChange, hits, selectedIndex, onSelectIndex, iconFor, onOpen, onClose, teamUnavailable,
    docked = false,
  } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) onOpen(hit);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // 面板内只有一个焦点，Tab 必须吃掉
      e.preventDefault();
    } else if (e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const hit = hits[Number(e.key) - 1];
      if (hit) onOpen(hit);
    }
  };

  return (
    <div
      className="absolute inset-0 z-[var(--z-drag)]"
      onKeyDown={onKeyDown}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="迷你唤起面板"
        className={[
          'absolute flex flex-col overflow-hidden p-[var(--space-2)]',
          docked ? 'inset-0' : 'left-1/2 rounded-[var(--radius-xl)] border border-[var(--border-subtle)]',
        ].join(' ')}
        style={
          docked
            ? { background: 'var(--bg-overlay)' }
            : {
                width: 'var(--palette-w)',
                maxHeight: 'var(--palette-h)',
                transform: 'translateX(-50%)',
                top: '18vh',
                background: 'var(--bg-overlay)',
                boxShadow: 'var(--elev-3)',
              }
        }
      >
        <SearchInput
          ref={inputRef}
          variant="palette"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="搜索入口、分组或路径"
          placeholder="搜索入口、分组或路径"
        />
        <div className="mt-2 h-px w-full bg-[var(--border-subtle)]" />

        <div className="tl-scroll min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label="搜索结果">
          {hits.length === 0 ? (
            <EmptyBlock
              compact
              icon={Search}
              title={`没有找到「${query}」相关的入口`}
              detail="换个词试试，或到我的入口里添加"
            />
          ) : (
            <>
              {query.length === 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1 t-2xs text-[var(--muted)]">
                  <RotateCcwClock size={16} strokeWidth={2} aria-hidden />
                  最近打开
                </div>
              )}
              {hits.slice(0, 7).map((hit, i) => (
                <ResultRow
                  key={hit.entry.id}
                  id={`tl-palette-hit-${i}`}
                  entry={hit.entry}
                  subtitle={hit.subtitle}
                  iconUrl={iconFor(hit.entry.id)}
                  glyphSize={16}
                  iconSize={24}
                  selected={i === selectedIndex}
                  onOpen={() => onOpen(hit)}
                  trailing={
                    <span className="flex shrink-0 items-center gap-2">
                      <SourceTag source={hit.source} />
                      <span className="t-2xs t-mono text-[var(--meta)]">Alt+{i + 1}</span>
                    </span>
                  }
                />
              ))}
            </>
          )}
          {teamUnavailable && (
            <p className="px-3 py-1 t-2xs text-[var(--meta)]">
              团队入口还没有同步，当前只显示我的入口
            </p>
          )}
        </div>

        <div className="mt-1 h-px w-full bg-[var(--border-subtle)]" />
        <div className="flex h-9 items-center gap-1.5 px-3 t-2xs text-[var(--meta)]">
          <span className="w-emph">全局快捷窗口</span>
          <span className="mx-1">·</span>
          <ChevronUp size={16} strokeWidth={2} aria-hidden />
          <ChevronDown size={16} strokeWidth={2} aria-hidden />
          <span>选择</span>
          <span className="mx-1">·</span>
          <span>⏎ 打开</span>
          <span className="mx-1">·</span>
          <span>Alt+1…7 直接打开</span>
          <span className="mx-1">·</span>
          <span>Esc 收起</span>
        </div>
      </div>
    </div>
  );
}
