/**
 * EntryEditDialog —— 团队入口的新建/编辑对话框（P0-09 的核心补件）。
 *
 * 此前管理员只能重命名、删除、上下移动：没有任何界面能设置入口的类型与目标
 * （exe 路径 / 文件夹 / 网址），意味着管理员**从零造不出一条可用的团队入口**。
 * 这里补齐三类型统一编辑：软件/文件夹走系统选择框，网页手填 URL。
 */
import { FolderOpen, Globe, Image as ImageIcon, MonitorSmartphone, Smile } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { api } from '../../bridge/index.ts';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { Textarea } from '../atoms/Textarea.tsx';
import { Dialog } from './Dialog.tsx';
import type { Entry } from '../../../shared/schema/entry.ts';
import { EMOJI_GROUPS } from '../../../shared/emoji-palette.ts';

export type EditorEntryType = 'app' | 'folder' | 'web';

export interface EntryEditDialogProps {
  mode: 'create' | 'edit';
  /** team = 团队草稿；personal = 我的入口（标题与落库语义不同，表单同构）。 */
  scope?: 'team' | 'personal';
  initial: Entry | null;
  /** personal 新建时可选的目标分组列表；缺省不渲染分组选择。 */
  groupOptions?: Array<{ id: string; name: string }>;
  /**
   * 已确定的目标分组（从「在此组添加」进入时非空）：
   * 此时**不渲染**分组选择、直接锁定——用户点的是哪个组就进哪个组，
   * 不该让他再选一遍（脱裤子放屁问题，用户原话）。
   */
  initialGroupId?: string | null;
  /** 编辑态的当前分组：只是预选值（可改组=编辑时顺带迁移），与 initialGroupId 的"锁死"不同。 */
  currentGroupId?: string | null;
  /** groupId 仅在渲染过分组选择时携带（personal 新建/编辑）。 */
  onConfirm(entry: Entry, groupId: string | null): void;
  onCancel(): void;
}

const TYPE_OPTIONS: Array<{ value: EditorEntryType; label: string; icon: ReactNode }> = [
  { value: 'app', label: '软件', icon: <MonitorSmartphone size={16} strokeWidth={2} aria-hidden /> },
  { value: 'folder', label: '文件夹', icon: <FolderOpen size={16} strokeWidth={2} aria-hidden /> },
  { value: 'web', label: '网页', icon: <Globe size={16} strokeWidth={2} aria-hidden /> },
];

function urlValid(url: string): boolean {
  return /^https?:\/\/\S+\.\S+/i.test(url.trim());
}

/** 从旧入口继承与类型无关的字段；类型相关字段由目标类型决定，绝不残留。 */
function baseFields(initial: Entry | null) {
  return {
    id: initial?.id ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? null,
    keywords: initial?.keywords,
  };
}

export function EntryEditDialog({ mode, scope = 'team', initial, groupOptions, initialGroupId, currentGroupId, onConfirm, onCancel }: EntryEditDialogProps) {
  const [type, setType] = useState<EditorEntryType>(initial?.type ?? 'app');
  const [name, setName] = useState(baseFields(initial).name);
  const [target, setTarget] = useState(initial && initial.type !== 'web' ? initial.target : '');
  const [url, setUrl] = useState(initial?.type === 'web' ? initial.url : '');
  const [description, setDescription] = useState(baseFields(initial).description ?? '');
  const lockedGroupId = initialGroupId ?? null;
  const [groupId, setGroupId] = useState<string | null>(lockedGroupId ?? currentGroupId ?? groupOptions?.[0]?.id ?? null);
  const [picking, setPicking] = useState(false);
  const [emojiPick, setEmojiPick] = useState<string | null>(
    initial && initial.icon.kind === 'emoji' ? (initial.icon.char ?? null) : null,
  );
  const [emojiOpen, setEmojiOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const isPersonal = scope === 'personal';

  const trimmedName = name.trim();
  const isWeb = type === 'web';
  const targetFilled = isWeb ? urlValid(url) : target.trim().length > 0;
  const canConfirm = trimmedName.length > 0 && targetFilled;

  const browse = async () => {
    setPicking(true);
    try {
      const picked = await api.entries.pick(type === 'web' ? 'folder' : type);
      if (picked.ok) {
        setTarget(picked.target);
        if (trimmedName.length === 0) setName(picked.name);
      }
    } finally {
      setPicking(false);
    }
  };

  const confirm = () => {
    if (!canConfirm) return;
    const now = new Date().toISOString();
    /* 未选表情时的图标回退：非表情引用原样保留；原来是表情（即用户点了
       「恢复自动图标」）必须重置成该类型的默认引用，否则按钮等于白点。 */
    const iconWithoutEmoji =
      initial && initial.icon.kind !== 'emoji'
        ? initial.icon
        : type === 'web'
          ? { kind: 'fallback' as const }
          : { kind: 'local' as const };
    const common = {
      // create 一律新生成 id：prefill（粘贴快捷添加）会带来占位 id ''，绝不能落库。
      id: mode === 'create' ? `e-new-${Date.now()}` : (initial?.id ?? ''),
      name: trimmedName,
      sort: initial?.sort ?? 0,
      description: description.trim().length > 0 ? description.trim() : null,
      keywords: initial?.keywords,
      updatedAt: now,
    };
    const entry: Entry =
      type === 'web'
        ? { ...common, type: 'web', url: url.trim(), icon: emojiPick ? { kind: 'emoji', char: emojiPick } : iconWithoutEmoji, iconAssetHash: null }
        : type === 'app'
          ? {
              ...common,
              type: 'app',
              target: target.trim(),
              sourcePath: initial?.type === 'app' ? (initial.sourcePath ?? null) : target.trim(),
              args: initial?.type === 'app' ? (initial.args ?? '') : '',
              cwd: initial?.type === 'app' ? (initial.cwd ?? '') : '',
              expandEnv: initial?.type === 'app' ? initial.expandEnv : true,
              icon: emojiPick ? { kind: 'emoji', char: emojiPick } : iconWithoutEmoji,
              iconAssetHash: null,
            }
          : {
              ...common,
              type: 'folder',
              target: target.trim(),
              icon: emojiPick ? { kind: 'emoji', char: emojiPick } : iconWithoutEmoji,
              iconAssetHash: null,
            };
    onConfirm(entry, groupId);
  };

  return (
    <Dialog
      title={
        mode === 'edit'
          ? isPersonal ? '编辑入口' : '编辑团队入口'
          : isPersonal ? '新建入口' : '新建团队入口'
      }
      width="normal"
      onClose={onCancel}
      initialFocus={nameRef}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onCancel}>
            取消
          </Button>
          <Button tone="primary" size="lg" softDisabled={!canConfirm} onClick={confirm}>
            {mode === 'create' ? (isPersonal ? '添加' : '添加到草稿') : '保存'}
          </Button>
        </>
      }
    >
      <p className="t-xs mb-1 text-[var(--muted)]">类型</p>
      <div role="radiogroup" aria-label="入口类型" className="mb-3 flex items-center gap-1">
        {TYPE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === type}
            onClick={() => setType(o.value)}
            className={[
              'flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] px-3 t-sm',
              'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
            ].join(' ')}
            style={{
              background: o.value === type ? 'var(--tab-bg-selected)' : 'transparent',
              color: o.value === type ? 'var(--fg)' : 'var(--fg-2)',
            }}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>

      <p className="t-xs mb-1 text-[var(--muted)]">图标（可选）</p>
      <div className="relative mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEmojiOpen((v) => !v)}
          className="flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-2 t-sm text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--fg)]"
        >
          {emojiPick ? <span className="text-[18px] leading-none">{emojiPick}</span> : <><Smile size={16} strokeWidth={2} aria-hidden />挑个表情</>}
        </button>
        {emojiPick && (
          <>
            <Button tone="ghost" size="sm" icon={ImageIcon} onClick={() => setEmojiPick(null)}>
              恢复自动图标
            </Button>
            <span className="t-2xs text-[var(--meta)]">已选表情将替代系统提取的图标</span>
          </>
        )}
        {emojiOpen && (
          <div
            className="absolute left-0 top-9 z-[var(--z-dropdown)] max-h-[260px] w-[300px] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-2"
            style={{ background: 'var(--menu-bg)', boxShadow: 'var(--menu-elev)' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {EMOJI_GROUPS.map((g) => (
              <div key={g.label} className="mb-2 last:mb-0">
                <p className="t-2xs mb-1 px-0.5 text-[var(--meta)]">{g.label}</p>
                <div className="grid grid-cols-8 gap-0.5">
                  {g.chars.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={'选择表情 ' + c}
                      onClick={() => {
                        setEmojiPick(c);
                        setEmojiOpen(false);
                      }}
                      className={[
                        'grid h-8 place-items-center rounded-[var(--radius-sm)] text-[18px] leading-none',
                        'transition-colors duration-[var(--motion-fast)] hover:bg-[var(--bg-surface-hover)]',
                        emojiPick === c ? 'bg-[var(--tab-bg-selected)]' : '',
                      ].join(' ')}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {groupOptions && groupOptions.length > 1 && lockedGroupId === null && (
        <>
          <p className="t-xs mb-1 text-[var(--muted)]">所属分组</p>
          <select
            value={groupId ?? ''}
            aria-label="所属分组"
            onChange={(e) => setGroupId(e.target.value || null)}
            className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 t-sm text-[var(--fg)]"
          >
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </>
      )}

      <p className="t-xs mb-1 text-[var(--muted)]">名称</p>
      <Input
        ref={nameRef}
        value={name}
        aria-label="入口名称"
        placeholder="给这个入口起个能认出它的名字"
        onChange={(e) => setName(e.target.value)}
      />
      {trimmedName.length === 0 && <p className="mt-1 t-xs text-[var(--danger-fg)]">名称不能为空</p>}

      <p className="t-xs mb-1 mt-3 text-[var(--muted)]">{isWeb ? '网址' : '目标位置'}</p>
      {isWeb ? (
        <>
          <Input
            value={url}
            mono
            aria-label="网页地址"
            placeholder="https://example.com"
            onChange={(e) => setUrl(e.target.value)}
          />
          {url.trim().length > 0 && !urlValid(url) && (
            <p className="mt-1 t-xs text-[var(--danger-fg)]">请填写 http(s) 开头的完整网址</p>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Input
              value={target}
              mono
              aria-label={type === 'app' ? '程序路径' : '文件夹路径'}
              placeholder={type === 'app' ? 'C:\\…\\程序.exe 或快捷方式' : 'D:\\共享\\项目目录'}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <Button tone="secondary" className="shrink-0" loading={picking} onClick={() => void browse()}>
            浏览…
          </Button>
        </div>
      )}
      {type === 'app' && (
        <p className="mt-1 t-2xs text-[var(--meta)]">选 .lnk 快捷方式会自动解析成真实程序路径</p>
      )}

      <p className="t-xs mb-1 mt-3 text-[var(--muted)]">说明（可选）</p>
      <Textarea
        value={description}
        aria-label="入口说明"
        placeholder="这个入口用来做什么"
        rows={2}
        onChange={(e) => setDescription(e.target.value)}
      />
    </Dialog>
  );
}
