/**
 * GroupHeader —— 分组标题行（h32）。右侧计数是默认槽位，编辑态另有操作按钮注入。
 * id 供侧栏分组锚点平滑滚动定位（tl-group-{encodeURIComponent(name)}）。
 *
 * 点名字直接改名（2026-10-18 用户要求："希望能直接点击编辑重命名，而不是必须去右上角三个点里操作"）：
 * 传了 `onRename` 才可编辑——只读团队页不传，那里名字仍是纯文本（不出现"点了没反应"的假入口）。
 * 交互：回车 / 失焦提交，Esc 取消，清空或没改动＝放弃（名字不允许变空）。
 * 同名 / 超长这类业务校验留在上层（只有它知道同页还有哪些组名）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CountBadge } from '../atoms/Tag.tsx';

export interface GroupHeaderProps {
  name: string;
  count: number;
  /** 锚点定位用 DOM id；缺省由调用方用 encodeURIComponent(name) 生成。 */
  id?: string;
  right?: ReactNode;
  /** 提供即可点名字改名；收到的是**已 trim**的新名字（空串不会传下来）。 */
  onRename?(name: string): void;
}

export function GroupHeader({ name, count, id, right, onRename }: GroupHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    // 外部改名（侧栏菜单 / 撤销）时同步草稿，免得下次进编辑态还是旧名字。
    if (!editing) setDraft(name);
  }, [name, editing]);

  const commit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next.length === 0 || next === name) {
      setDraft(name);
      return;
    }
    onRename?.(next);
  };

  return (
    <div id={id} className="flex h-8 shrink-0 scroll-mt-2 items-center gap-2">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label="分组名称"
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(name);
              setEditing(false);
            }
            // 名字里可能有空格等按键：编辑期间不让全局热键抢（与卡片重命名输入同一纪律）。
            e.stopPropagation();
          }}
          className="t-sm w-emph h-7 min-w-0 max-w-[280px] rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--bg-surface)] px-1.5 text-[var(--fg)] outline-none"
        />
      ) : (
        /* min-w-0：组名超长时收缩并出省略号，而不是把右侧操作按钮挤成竖排。 */
        <h2 className="t-sm w-emph min-w-0 truncate-1 text-[var(--fg)]">
          {onRename ? (
            <button
              type="button"
              title="点击重命名"
              aria-label={`重命名分组 ${name}`}
              onClick={() => setEditing(true)}
              className="-mx-1 max-w-full cursor-text truncate-1 rounded-[var(--radius-sm)] px-1 text-left transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]"
            >
              {name}
            </button>
          ) : (
            name
          )}
        </h2>
      )}
      <CountBadge count={count} />
      <div className="flex-1" />
      {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
    </div>
  );
}
