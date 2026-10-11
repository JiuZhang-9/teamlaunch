/**
 * 扫描「入口点」的结果 —— 勾选要添加的程序，批量加入「我的入口」。
 *
 * 扫描一次可能返回几百条（开始菜单 + 桌面 + 任务栏 + 已安装程序），所以：
 *  - **能筛**：搜索框按名称过滤；
 *  - **能成段选**：在某行按下拖动 = 连续勾选（从已勾的行开始拖 = 连续取消，同资源管理器）；
 *    Shift+点击 = 从"上次点的那行"到"这行"整段勾选，若这行本来已勾则整段取消；
 *  - **能一眼看出状态**：复选框是图形（空心方框 / 主题色实底 + 对勾），不是纯颜色；
 *  - **滚动条**：用项目标准的 ScrollArea（滚动时显示、停手 800ms 淡出）。
 *
 * 已经在清单里的目标标出来、并**默认不勾**——默认勾上就等于默默制造重复项。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { ScrollArea } from '../atoms/ScrollArea.tsx';
import { Dialog } from './Dialog.tsx';
import type { ScanCandidate } from '../../bridge/types.ts';

export interface ScanPickerDialogProps {
  items: ScanCandidate[];
  /** 已在「我的入口」里的目标路径（标出来并默认不勾）。 */
  existingTargets?: string[];
  onCancel(): void;
  onConfirm(picked: ScanCandidate[]): void;
}

export function ScanPickerDialog({ items, existingTargets = [], onCancel, onConfirm }: ScanPickerDialogProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  /** 上一次点击的行（Shift 段选的锚点）。 */
  const lastIndexRef = useRef<number | null>(null);
  /** 拖拽状态：base=按下那一刻的选中集（每帧基于它重算，避免来回拖动累积脏数据）。 */
  const dragRef = useRef<{ base: string[]; target: boolean; anchor: number } | null>(null);

  const existing = useMemo(
    () => new Set(existingTargets.map((t) => t.trim().replace(/\//g, '\\').toLowerCase())),
    [existingTargets],
  );
  /** 同一条目标算不算"已经在清单里"：与主进程同一口径（反斜杠 + 忽略大小写）。 */
  const isExisting = (item: ScanCandidate): boolean =>
    existing.has(item.target.trim().replace(/\//g, '\\').toLowerCase());

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((i) => i.name.toLowerCase().includes(kw));
  }, [items, keyword]);

  const sources = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of items) {
      const s = i.source ?? '其他';
      seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    return [...seen.entries()].map(([s, n]) => `${s} ${n}`).join(' · ');
  }, [items]);

  /* 拖拽选择：pointermove 时用命中测试拿到所在行，把 [anchor..该行] 整段设为拖拽开始时决定的状态。
     list/picked 通过 ref 读最新值——effect 只挂一次，拖动过程中不反复装卸监听。 */
  const listRef = useRef(list);
  listRef.current = list;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  useEffect(() => {
    const applyRange = (from: number, to: number, target: boolean, base: string[]) => {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const next = new Set(base);
      for (let i = lo; i <= hi; i += 1) {
        const t = listRef.current[i]?.target;
        if (t === undefined) continue;
        if (target) next.add(t);
        else next.delete(t);
      }
      setPicked([...next]);
    };
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-scan-row]');
      if (!(row instanceof HTMLElement)) return;
      const j = Number(row.dataset.scanRow);
      if (Number.isNaN(j)) return;
      applyRange(drag.anchor, j, drag.target, drag.base);
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  /** 按下：Shift = 段选（按锚点整段勾/取消）；否则进入拖拽（单击等价于只拖一行）。 */
  const onRowPointerDown = (index: number, e: React.PointerEvent) => {
    const item = list[index];
    if (!item) return;
    const target = !picked.includes(item.target);
    if (e.shiftKey && lastIndexRef.current !== null) {
      const lo = Math.min(lastIndexRef.current, index);
      const hi = Math.max(lastIndexRef.current, index);
      const next = new Set(picked);
      for (let i = lo; i <= hi; i += 1) {
        const t = list[i]?.target;
        if (t === undefined) continue;
        if (target) next.add(t);
        else next.delete(t);
      }
      setPicked([...next]);
      lastIndexRef.current = index;
      return;
    }
    lastIndexRef.current = index;
    dragRef.current = { base: picked, target, anchor: index };
    const next = new Set(picked);
    if (target) next.add(item.target);
    else next.delete(item.target);
    setPicked([...next]);
  };

  /** 键盘触发（Space/Enter）走 click（detail===0）；鼠标点击已在 pointerdown 处理，避免双触发。 */
  const onRowClick = (index: number, e: React.MouseEvent) => {
    if (e.detail !== 0) return;
    const item = list[index];
    if (!item) return;
    setPicked((prev) => (prev.includes(item.target) ? prev.filter((t) => t !== item.target) : [...prev, item.target]));
    lastIndexRef.current = index;
  };

  const pickAllVisible = () => {
    const next = new Set(picked);
    for (const i of list) next.add(i.target);
    setPicked([...next]);
  };

  return (
    <Dialog
      title="扫描本机程序"
      width="normal"
      onClose={onCancel}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onCancel}>
            取消
          </Button>
          <Button
            tone="primary"
            size="lg"
            softDisabled={picked.length === 0}
            onClick={() => onConfirm(items.filter((i) => picked.includes(i.target)))}
          >
            添加{picked.length > 0 ? `（${picked.length} 个）` : ''}
          </Button>
        </>
      }
    >
      <p className="t-sm mb-1 text-[var(--fg-2)]">
        找到 {items.length} 个候选程序（{sources}）。勾选要加入「我的入口」的；标着「已在清单中」的默认不勾。
      </p>
      {items.length >= 300 && (
        <p className="t-xs mb-2 text-[var(--warn-fg)]">已达扫描上限，可能还有没列出来的程序。</p>
      )}

      <div className="mb-2 flex items-center gap-2">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索程序名"
          aria-label="搜索程序名"
          className="min-w-0 flex-1"
        />
        <Button tone="ghost" size="sm" className="shrink-0" onClick={pickAllVisible}>
          全选筛选结果（{list.length}）
        </Button>
        <Button
          tone="ghost"
          size="sm"
          className="shrink-0"
          softDisabled={picked.length === 0}
          onClick={() => setPicked([])}
        >
          清空选择
        </Button>
      </div>

      <ScrollArea className="h-64 rounded-[var(--radius-md)] border border-[var(--border-subtle)]" ariaLabel="扫描到的程序">
        {list.map((item, index) => {
          const on = picked.includes(item.target);
          const dup = isExisting(item);
          return (
            <button
              key={item.target}
              type="button"
              data-scan-row={index}
              /* 拖动经过的行不能被原生选中高亮干扰 */
              onPointerDown={(e) => onRowPointerDown(index, e)}
              onClick={(e) => onRowClick(index, e)}
              aria-pressed={on}
              title={item.target}
              className={[
                'flex w-full items-center gap-2 px-3 py-2 text-left t-sm transition-colors duration-[var(--motion-fast)] [user-select:none]',
                on ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--fg)] hover:bg-[var(--bg-surface-hover)]',
              ].join(' ')}
            >
              {/* 复选框：图形而不是文字标记（对勾形状本身可辨，不靠颜色） */}
              <span
                aria-hidden
                className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border"
                style={{
                  background: on ? 'var(--accent)' : 'transparent',
                  borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
                  color: 'var(--accent-on, #fff)',
                }}
              >
                {on && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {dup && <span className="shrink-0 t-2xs text-[var(--meta)]">已在清单中</span>}
              {item.source !== undefined && <span className="shrink-0 t-2xs text-[var(--meta)]">{item.source}</span>}
            </button>
          );
        })}
        {list.length === 0 && <p className="px-3 py-4 t-sm text-[var(--meta)]">没有匹配的程序</p>}
      </ScrollArea>
      <p className="t-2xs mt-1 text-[var(--meta)]">
        提示：按住所选行上下拖动可连续勾选（从已勾的行开始拖则是取消）；按住 Shift 点击可整段选中或取消。
      </p>
    </Dialog>
  );
}
