/**
 * MiniPalette —— 迷你唤起面板（V-03）。
 *
 * 三条硬约束：
 *  1. **预热隐藏窗口**（K-D 同类）：本面板在预览里常驻挂载但 `hidden`，
 *     唤起只做显示 + 聚焦，不重新挂载组件树（冷启动必超 80ms 预算）。
 *  2. **焦点不离开输入框**：面板内只有一个输入焦点，一旦丢出去面板就失焦隐藏，
 *     所以 Tab / Shift+Tab 一律 preventDefault，改当作"下一条 / 上一条"（见 onKeyDown）。
 *  3. **本视图 100% 本地**，不得出现任何网络请求相关字样。
 *
 * 1.4.0：结果区抽成 `PaletteResults`，与主窗口搜索共用同一套渲染规则。
 */
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { SearchInput } from '../atoms/SearchInput.tsx';
import { PaletteResults } from './PaletteResults.tsx';
import type { PaletteHit } from '../../lib/palette-source.ts';

export interface MiniPaletteProps {
  open: boolean;
  query: string;
  onQueryChange(v: string): void;
  hits: PaletteHit[];
  selectedIndex: number;
  onSelectIndex(i: number): void;
  iconFor(entryId: string): string | null;
  onOpen(hit: PaletteHit): void;
  /** 剪贴板候选行 / 本机程序行的「加为入口」：走主窗口那套预填编辑器。 */
  onAddToPersonal(hit: PaletteHit): void;
  /** Ctrl+回车（非剪贴板行）＝进入主窗口；面板窗口由调用方收起。 */
  onEnterMain(): void;
  onClose(): void;
  /** 固定 / 取消固定（右键菜单与固定格右上角的叉）。 */
  onTogglePin(entryId: string): void;
  /** 团队数据为空（从未成功同步）时追加一行说明 */
  teamUnavailable: boolean;
  /**
   * docked = 渲染在独立面板窗口里：面板铺满窗口，不再做居中浮层
   * （overlay 形态供主窗口内唤起用；两种形态共用同一套键盘与结果逻辑）。
   */
  docked?: boolean;
  /** entries=入口搜索（默认）；programs=Ctrl+Alt+F 打开的本机程序专用搜索。 */
  scope?: 'entries' | 'programs';
  /** 索引正在扫描 / 最近失败原因：程序范围的空态要如实说明。 */
  programScanning?: boolean;
  programError?: string | null;
}

export function MiniPalette(props: MiniPaletteProps) {
  const {
    open, query, onQueryChange, hits, selectedIndex, onSelectIndex, iconFor, onOpen, onAddToPersonal, onEnterMain, onClose, onTogglePin,
    teamUnavailable, docked = false, scope = 'entries', programScanning = false, programError = null,
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
    /* 输入法组词中：回车 / 空格 / 方向键都交给输入法，否则会"回车不跟手"或误开候选。
       这是 2026-10-27 用户反馈"回车很多时候不跟手"的根因之一。 */
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      /* ←/→ 与 ↑/↓ 都能移动选中项（2026-10-19 用户要求："变成按钮后，上下左右方向键是否也可以调整选中项"）：
         图标格是一行，左右是它的自然轴；上下继续沿用原来的线性游标（进入下方列表）。 */
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex + 1) % hits.length);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (hits.length) onSelectIndex((selectedIndex - 1 + hits.length) % hits.length);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      /* Ctrl+Tab（2026-10-19 用户改键，原 Ctrl+M）：收起面板并把主窗口拿到前台，
         不依赖选中项、不改动任何数据。必须排在下面 Tab 分支之前判定。
         2026-10-21：窗口内浮层形态还要 stopPropagation——主窗口新增了 Ctrl+Tab
         （主窗口 → 快捷面板），不拦住会变成"关浮层 + 把主窗口藏进托盘"。 */
      e.preventDefault();
      e.stopPropagation();
      onEnterMain();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) {
        // 剪贴板候选行 / 本机程序行：回车就是"直接打开"，**绝不弹任何窗口**；
        // 加为入口是第二个动作（Ctrl+回车），与回车分开，避免误触编辑器。
        if ((hit.kind === 'clip-new' || hit.kind === 'system') && (e.ctrlKey || e.metaKey)) onAddToPersonal(hit);
        else onOpen(hit);
      }
    } else if (e.key === ' ' || e.code === 'Space') {
      /* 空格进入（2026-10-27 用户要求，uTools 手感）：空查询时打开固定/最近/剪贴板，
         有查询词时打开当前选中结果。搜索是子串匹配，输入 `Visual` 就能出 `Visual Studio`，
         所以不需要为"打空格"再留一个键位。
         带 Shift/Alt/Ctrl 时不拦截：Shift+空格仍可输入字面空格，Ctrl+空格是全局热键。 */
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const hit = hits[selectedIndex];
      if (hit) onOpen(hit);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // 焦点不能离开输入框（丢出去面板就失焦隐藏），所以仍然吃掉默认行为；
      // 但 Shift+Tab 反向也一样——左手留在输入区就能上下选择（同 ↑↓ 的循环游标）。
      e.preventDefault();
      if (hits.length) {
        const dir = e.shiftKey ? -1 : 1;
        onSelectIndex((selectedIndex + dir + hits.length) % hits.length);
      }
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
                maxHeight: 'min(var(--palette-h), calc(100vh - 140px))',
                transform: 'translateX(-50%)',
                top: '18vh',
                background: 'var(--bg-overlay)',
                boxShadow: 'var(--elev-3)',
              }
        }
      >
        {/* 独立面板窗口没有标题栏：顶部留一条可拖动的抓手（1.5.1 用户要求可手动移动）。
            只在 docked 形态出现；主窗口内的浮层不需要拖窗口。 */}
        {docked && (
          <div
            aria-hidden
            className="mb-1 flex h-3 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
            style={{ WebkitAppRegion: 'drag' } as CSSProperties}
          >
            <span className="h-1 w-10 rounded-[var(--radius-pill)]" style={{ background: 'var(--border-strong)' }} />
          </div>
        )}
        <SearchInput
          ref={inputRef}
          variant="palette"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label={scope === 'programs' ? '搜索本机程序（开始菜单）' : '搜索入口、程序或路径'}
          placeholder={scope === 'programs' ? '搜索本机程序（开始菜单）' : '搜索入口、程序或路径'}
        />
        <div className="mt-2 h-px w-full bg-[var(--border-subtle)]" />

        <PaletteResults
          hits={hits}
          query={query}
          selectedIndex={selectedIndex}
          onSelectIndex={onSelectIndex}
          iconFor={iconFor}
          onOpen={onOpen}
          onAddToPersonal={onAddToPersonal}
          onTogglePin={onTogglePin}
          enablePinMenu
          showAltHints
          scope={scope}
          programScanning={programScanning}
          programError={programError}
          teamUnavailable={teamUnavailable}
          tileColumns={7}
          tileHeight={104}
          tileGap={8}
          tileIconSize={36}
          className="py-1"
        />

        <div className="mt-1 h-px w-full bg-[var(--border-subtle)]" />
        {/* 560px 的面板放不下更多字了：文案按实测收短（"直接打开"→"直开"），
            并整体 nowrap——宁可裁掉尾巴，也不能折成两行糊成一团（实测过一版就这样）。 */}
        <div className="flex h-9 items-center gap-1.5 overflow-hidden whitespace-nowrap px-3 t-2xs text-[var(--meta)]">
          <ChevronUp size={16} strokeWidth={2} aria-hidden />
          <ChevronDown size={16} strokeWidth={2} aria-hidden />
          <span>选择</span>
          <span className="mx-1">·</span>
          <span>Tab 切换</span>
          <span className="mx-1">·</span>
          <span>⏎ / 空格 打开</span>
          <span className="mx-1">·</span>
          <span>Ctrl+⏎ 加入口</span>
          <span>·</span>
          <span>右键固定</span>
          <span>·</span>
          <span className="w-emph">Ctrl+Tab 主窗口</span>
          <span>·</span>
          <span>Esc 收起</span>
        </div>
      </div>
    </div>
  );
}
