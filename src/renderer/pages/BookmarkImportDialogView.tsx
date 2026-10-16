/**
 * 「导入书签」对话框（2026-10-17 用户提议：读取浏览器书签来添加网页卡片）。
 *
 * 三条纪律：
 *  - **显式触发**：只在打开这个对话框时扫描一次（不后台巡逻、不监听文件变化）；
 *  - **只进本机**：书签是个人隐私——勾选结果写进 personal.json（本机、永不同步），
 *    不经过任何上报/同步通道；
 *  - 读不到就如实说（没装 Chrome/Edge、文件被占用），不摆假数据；Firefox 明确说"暂不支持"。
 *
 * 落库走 `personal.addEntries`（一次算完只落一次盘），容量由它统一判——不在这里另立一套。
 */
import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/atoms/Button.tsx';
import { Input } from '../components/atoms/Input.tsx';
import { Dialog } from '../components/organisms/Dialog.tsx';
import { api } from '../bridge/index.ts';
import type { BookmarkSource } from '../bridge/types.ts';
import { usePersonal } from '../store/personalStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { hostnameOf } from '../lib/format.ts';

export function BookmarkImportDialogView({ onClose }: { onClose(): void }) {
  const { addEntries } = usePersonal();
  const { push } = useToasts();
  const [sources, setSources] = useState<BookmarkSource[] | null>(null);
  const [pickedSource, setPickedSource] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.bookmarks
      .scan()
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const source = sources?.[pickedSource] ?? null;
  const rows = useMemo(() => {
    if (source === null) return [];
    const kw = keyword.trim().toLowerCase();
    return kw === ''
      ? source.items
      : source.items.filter((b) => b.title.toLowerCase().includes(kw) || b.url.toLowerCase().includes(kw));
  }, [source, keyword]);

  const toggle = (url: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const confirm = async (): Promise<void> => {
    if (source === null || picked.size === 0) return;
    setBusy(true);
    /* 按 url 去重（同一书签可能出现在多个文件夹里），名称取书签标题。 */
    const inputs = source.items
      .filter((b) => picked.has(b.url))
      .filter((b, i, arr) => arr.findIndex((x) => x.url === b.url) === i)
      .map((b) => ({ kind: 'web' as const, name: b.title, target: b.url }));
    const res = await addEntries(inputs);
    setBusy(false);
    // 本机用量统计（仅落本机、不上报）：书签导入的次数。
    if (res.added > 0) void api.usage.bump({ kind: 'feature', key: 'bookmarkImport' });
    push(
      res.added > 0
        ? { title: `已从书签导入 ${res.added} 个入口`, detail: res.reason, tone: 'success' }
        : { title: res.reason ?? '没能导入', tone: 'warn' },
    );
    onClose();
  };

  const body = (): React.ReactNode => {
    if (sources === null) {
      return <p className="t-sm text-[var(--muted)]">正在读取本机书签…</p>;
    }
    if (sources.length === 0) {
      return (
        <p className="t-sm m-0 text-[var(--fg-2)]">
          没有找到可读取的书签。目前支持 Chrome 与 Edge（读取它们的本机书签文件）；
          Firefox 暂不支持（它的书签存在被浏览器占用的数据库里）。
        </p>
      );
    }
    return (
      <>
        <div className="mb-2 flex items-center gap-2">
          <span className="t-xs text-[var(--muted)]">来源</span>
          <select
            value={pickedSource}
            aria-label="书签来源"
            onChange={(e) => {
              setPickedSource(Number(e.target.value));
              setPicked(new Set());
            }}
            className="h-8 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 t-sm text-[var(--fg)]"
          >
            {sources.map((s, i) => (
              <option key={`${s.browser}-${s.profile}`} value={i}>
                {s.browser} · {s.profile}（{s.items.length} 条）
              </option>
            ))}
          </select>
          <span className="ml-auto t-xs text-[var(--muted)]">已选 {picked.size} 条</span>
        </div>
        <Input
          value={keyword}
          aria-label="筛选书签"
          placeholder="按标题或网址筛选"
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="tl-scroll mt-2 max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          {rows.length === 0 ? (
            <p className="t-sm m-0 p-3 text-[var(--muted)]">没有匹配的书签</p>
          ) : (
            rows.map((b) => {
              const on = picked.has(b.url);
              return (
                <button
                  key={b.url}
                  type="button"
                  aria-pressed={on}
                  title={`${b.title}\n${b.url}`}
                  onClick={() => toggle(b.url)}
                  className="flex h-9 w-full items-center gap-2 border-b border-[var(--border-subtle)] px-2 text-left last:border-b-0 hover:bg-[var(--bg-surface-hover)]"
                >
                  <span
                    aria-hidden
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-[var(--radius-sm)] border"
                    style={{
                      borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
                      background: on ? 'var(--accent)' : 'transparent',
                      color: 'var(--accent-on, #fff)',
                    }}
                  >
                    {/* 勾选必须用图标组件：P0 扫描器禁止任何 emoji/符号当功能图形（2026-10-17 被它抓过一次）。 */}
                    {on ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
                  </span>
                  <span className="t-sm min-w-0 flex-1 truncate-1 text-[var(--fg)]">{b.title}</span>
                  <span className="t-xs shrink-0 text-[var(--meta)]">{hostnameOf(b.url)}</span>
                </button>
              );
            })
          )}
        </div>
      </>
    );
  };

  return (
    <Dialog
      title="从浏览器书签导入"
      width="normal"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onClose}>
            取消
          </Button>
          <Button
            tone="primary"
            size="lg"
            loading={busy}
            softDisabled={picked.size === 0 || source === null}
            onClick={() => void confirm()}
          >
            导入{picked.size > 0 ? `（${picked.size} 条）` : ''}
          </Button>
        </>
      }
    >
      <p className="t-sm mb-2 text-[var(--fg-2)]">
        只读本机书签、只加进你的「我的入口」（本机保存，不参与团队同步）；不会上传任何内容。
      </p>
      {body()}
    </Dialog>
  );
}
