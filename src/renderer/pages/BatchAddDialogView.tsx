/**
 * 批量添加（多行粘贴）—— 个人页与团队编辑态共用的对话框（scope 区分落点）。
 *
 * 三条纪律：
 *  - **逐行识别、逐行给原因**：识别不出来的行如实写明为什么，绝不静默丢弃；
 *  - 识别要对每行做本机探测（路径是否存在），几十行必须限并发 + 给进度；
 *  - 落库走 store 的批量动作（个人 `addEntries` 一次落盘 / 团队 `createEntries` 一次 mutate
 *    ＝一步撤销），容量由 store 统一判——不在这里另立一套。
 *
 * 与快捷面板的剪贴板识别**完全分开**：那边只认单行、不做批量；这里是显式打开的对话框。
 */
import { useState } from 'react';
import { Button } from '../components/atoms/Button.tsx';
import { Textarea } from '../components/atoms/Textarea.tsx';
import { Dialog } from '../components/organisms/Dialog.tsx';
import { api } from '../bridge/index.ts';
import { useEdit } from '../store/editStore.tsx';
import { usePersonal } from '../store/personalStore.tsx';
import { useToasts } from '../store/toastStore.tsx';

/** 一次最多处理多少行：再多就该分批了（界面上也会说清）。 */
const MAX_LINES = 50;
/** 并发上限：识别带本机探测，UNC 掉线路径不能把整个流程拖死。 */
const CONCURRENCY = 4;

interface Row {
  line: string;
  ok: boolean;
  kind?: 'web' | 'app' | 'folder';
  name?: string;
  target?: string;
  reason?: string;
}

const TYPE_LABEL: Record<'web' | 'app' | 'folder', string> = { web: '网页', app: '软件', folder: '文件夹' };

export function BatchAddDialogView({ onClose, scope = 'personal' }: { onClose(): void; scope?: 'personal' | 'team' }) {
  const personal = usePersonal();
  const edit = useEdit();
  const { push } = useToasts();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [group, setGroup] = useState('');

  const groups = (scope === 'personal' ? personal.config.groups : edit.draft.groups).map((g) => g.name);

  const runIdentify = async (): Promise<void> => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) {
      push({ title: '先贴几行网址或路径（一行一个）', tone: 'info' });
      return;
    }
    const capped = lines.slice(0, MAX_LINES);
    if (lines.length > MAX_LINES) {
      push({ title: `一次最多处理 ${MAX_LINES} 行，多余的已忽略`, tone: 'warn' });
    }
    setBusy(true);
    setProgress(0);
    setUnchecked(new Set());
    const out: Row[] = new Array(capped.length);
    const queue = capped.map((line, i) => ({ line, i }));
    let done = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const job = queue.shift();
          if (!job) return;
          const identified = await api.entries.identify(job.line);
          out[job.i] =
            identified.kind === 'none'
              ? { line: job.line, ok: false, reason: identified.reason }
              : {
                  line: job.line,
                  ok: true,
                  kind: identified.kind,
                  name: identified.name,
                  target: identified.kind === 'web' ? identified.url : identified.target,
                };
          done += 1;
          setProgress(done);
        }
      }),
    );
    setRows(out);
    setBusy(false);
  };

  const okCount = (rows ?? []).filter((r, i) => r.ok && !unchecked.has(i)).length;

  const confirm = async (): Promise<void> => {
    const picked = (rows ?? []).filter((r, i) => r.ok && !unchecked.has(i));
    if (picked.length === 0) return;
    const inputs = picked.map((r) => ({
      kind: r.kind ?? ('app' as const),
      name: r.name ?? '',
      target: r.target ?? '',
      sourcePath: r.kind === 'app' ? (r.target ?? null) : null,
    }));
    const target = group.trim().length > 0 ? group.trim() : undefined;
    const res = scope === 'personal'
      ? await personal.addEntries(inputs.map((x) => ({ ...x, groupName: target })))
      : edit.createEntries(inputs, target);
    /* 部分加入（放不下）也要说清：added 与 reason 同时出现不是矛盾，是"放下的都加了"。 */
    push(
      res.added > 0
        ? { title: `已添加 ${res.added} 个入口`, detail: res.reason, tone: 'success' }
        : { title: res.reason ?? '没能添加', tone: 'warn' },
    );
    onClose();
  };

  return (
    <Dialog
      title="批量添加"
      width="normal"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onClose}>
            取消
          </Button>
          {rows === null ? (
            <Button tone="primary" size="lg" loading={busy} onClick={() => void runIdentify()}>
              {busy ? `识别中 ${progress}` : '识别'}
            </Button>
          ) : (
            <Button tone="primary" size="lg" softDisabled={okCount === 0} onClick={() => void confirm()}>
              添加{okCount > 0 ? `（${okCount} 个）` : ''}
            </Button>
          )}
        </>
      }
    >
      <p className="t-sm mb-2 text-[var(--fg-2)]">
        {scope === 'personal'
          ? `一行一个：网址、程序路径（exe / lnk）或文件夹路径，最多 ${MAX_LINES} 行。识别成功的一次加入「我的入口」。`
          : `一行一个：网址、程序路径（exe / lnk）或文件夹路径，最多 ${MAX_LINES} 行。识别成功的加入团队草稿，发布后员工才看得到。`}
      </p>

      <Textarea
        value={text}
        rows={6}
        aria-label="批量输入"
        placeholder={'https://oa.example.com\nD:\\Program Files\\Obsidian\\Obsidian.exe\nD:\\共享\\报价目录'}
        onChange={(e) => {
          setText(e.target.value);
          setRows(null);
        }}
      />

      {rows !== null && (
        <>
          <div className="mt-3 mb-1 flex items-center gap-2">
            <span className="t-xs text-[var(--muted)]">
              识别结果：可用 {rows.filter((r) => r.ok).length} 行 / 不可用 {rows.filter((r) => !r.ok).length} 行
            </span>
            <span className="ml-auto flex items-center gap-1">
              <span className="t-xs text-[var(--muted)]">加入分组</span>
              <select
                value={group}
                aria-label="加入分组"
                onChange={(e) => setGroup(e.target.value)}
                className="h-8 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 t-sm text-[var(--fg)]"
              >
                <option value="">{scope === 'personal' ? '（默认：我的入口）' : '（默认：第一个分组）'}</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="tl-scroll max-h-56 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
            {rows.map((r, i) => {
              const on = r.ok && !unchecked.has(i);
              return (
                <button
                  key={`${i}-${r.line}`}
                  type="button"
                  disabled={!r.ok}
                  aria-pressed={on}
                  title={r.line}
                  onClick={() =>
                    setUnchecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className={[
                    'flex w-full items-start gap-2 px-3 py-2 text-left t-sm transition-colors duration-[var(--motion-fast)]',
                    !r.ok
                      ? 'cursor-not-allowed text-[var(--muted)]'
                      : on
                        ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]'
                        : 'text-[var(--fg)] hover:bg-[var(--bg-surface-hover)]',
                  ].join(' ')}
                >
                  <span aria-hidden className="w-emph shrink-0 font-mono t-xs">
                    {r.ok ? (on ? '[x]' : '[ ]') : '[–]'}
                  </span>
                  <span className="min-w-0 flex-1">
                    {r.ok ? (
                      <>
                        <span className="block truncate-1">{r.name}</span>
                        <span className="block truncate-1 t-2xs text-[var(--muted)]">
                          {TYPE_LABEL[r.kind ?? 'app']} · {r.target}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block truncate-1">{r.line}</span>
                        <span className="block truncate-1 t-2xs text-[var(--muted)]">{r.reason}</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Dialog>
  );
}
