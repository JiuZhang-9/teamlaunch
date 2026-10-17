/**
 * 「导入书签」对话框（2026-10-17 用户提议：读取浏览器书签来添加网页卡片）。
 *
 * 两步走（2026-10-18 用户要求"先识别电脑上所有基于 Chrome 技术的浏览器，再选择读取"）：
 *   ① 打开时只问"装了哪些 Chromium 系浏览器"——**这一步不读书签内容**（主进程只 stat 目录）；
 *   ② 用户选定某个浏览器后，才读那一个浏览器的 Bookmarks 文件。
 * 也就是说：不选就不读，选哪个读哪个——比"打开对话框就把本机所有浏览器翻一遍"更收得住。
 *
 * 三条纪律：
 *  - **显式触发**：只在打开这个对话框时扫描（不后台巡逻、不监听文件变化）；
 *  - **只进本机**：书签是个人隐私——勾选结果写进 personal.json（本机、永不同步），
 *    不经过任何上报/同步通道；
 *  - 读不到就如实说（没装/文件被占用），不摆假数据；Firefox 明确说"暂不支持"。
 *
 * 落库走 `personal.addEntries`（一次算完只落一次盘），容量由它统一判——不在这里另立一套。
 */
import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/atoms/Button.tsx';
import { Input } from '../components/atoms/Input.tsx';
import { Dialog } from '../components/organisms/Dialog.tsx';
import { api } from '../bridge/index.ts';
import type { BookmarkBrowser, BookmarkSource } from '../bridge/types.ts';
import { usePersonal } from '../store/personalStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { hostnameOf } from '../lib/format.ts';

const SELECT_CLASS =
  'h-8 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 t-sm text-[var(--fg)]';

export function BookmarkImportDialogView({ onClose }: { onClose(): void }) {
  const { addEntries } = usePersonal();
  const { push } = useToasts();
  /** 第一步结果：检测到的浏览器（profiles 为空的也在这——"装了但没书签"要看得见）。 */
  const [browsers, setBrowsers] = useState<BookmarkBrowser[] | null>(null);
  /** 第二步：用户选定的浏览器 id（null = 还没选，也就还没读任何书签）。 */
  const [pickedBrowser, setPickedBrowser] = useState<string | null>(null);
  const [sources, setSources] = useState<BookmarkSource[] | null>(null);
  const [pickedSource, setPickedSource] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.bookmarks
      .browsers()
      .then((list) => {
        if (cancelled) return;
        setBrowsers(list);
        /* 只有一个浏览器有书签文件时替他选上——多一次点击没有信息量；
           有多个就停下来让他自己选（"再选择读取"正是这一步的意图）。 */
        const usable = list.filter((b) => b.profiles.length > 0);
        if (usable.length === 1) setPickedBrowser(usable[0].id);
      })
      .catch(() => {
        if (!cancelled) setBrowsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 选定浏览器后才真的读文件（每次切换都重读，不缓存上一次的结果）。 */
  useEffect(() => {
    if (pickedBrowser === null) {
      setSources(null);
      return;
    }
    let cancelled = false;
    setSources(null);
    setPickedSource(0);
    setPicked(new Set());
    void api.bookmarks
      .scan(pickedBrowser)
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch(() => {
        if (!cancelled) setSources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pickedBrowser]);

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
    /* 第一步（识别浏览器）还没回来时，什么都不读、也不列——先等它。 */
    if (browsers === null) {
      return <p className="t-sm text-[var(--muted)]">正在识别本机浏览器…</p>;
    }
    const empty = browsers.filter((b) => b.profiles.length === 0);
    if (browsers.length === 0) {
      return (
        <p className="t-sm m-0 text-[var(--fg-2)]">
          没有检测到基于 Chrome 技术的浏览器。我们查了本机常见的 Chromium 系浏览器
          （Chrome、Edge、Brave、Vivaldi、Chromium、Yandex、360 极速、QQ 浏览器、Opera）的
          用户数据目录；Firefox 暂不支持（它的书签存在被浏览器占用的数据库里）。
        </p>
      );
    }
    return (
      <>
        {/* 第一步：选浏览器（这一步还没读任何书签内容）。 */}
        <div className="mb-2 flex items-center gap-2">
          <span className="t-xs text-[var(--muted)]">浏览器</span>
          <select
            value={pickedBrowser ?? ''}
            aria-label="选择浏览器"
            onChange={(e) => setPickedBrowser(e.target.value === '' ? null : e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">请选择…</option>
            {browsers.map((b) => (
              <option key={b.id} value={b.id} disabled={b.profiles.length === 0}>
                {b.name}
                {b.profiles.length === 0 ? '（没有书签文件）' : ''}
              </option>
            ))}
          </select>
          <span className="ml-auto t-xs text-[var(--muted)]">只读本机文件</span>
        </div>

        {empty.length > 0 && (
          <p className="t-2xs mb-2 mt-0 text-[var(--meta)]">
            检测到但还没有书签文件的：{empty.map((b) => b.name).join('、')}
          </p>
        )}

        {/* 第二步：选完浏览器才读它的书签。 */}
        {pickedBrowser === null && (
          <p className="t-sm m-0 text-[var(--fg-2)]">
            选一个浏览器后，才会读取它的书签文件（未选之前我们不读任何书签内容）。
          </p>
        )}
        {pickedBrowser !== null && sources === null && (
          <p className="t-sm m-0 text-[var(--muted)]">正在读取书签…</p>
        )}
        {pickedBrowser !== null && sources !== null && sources.length === 0 && (
          <p className="t-sm m-0 text-[var(--fg-2)]">
            这个浏览器里没有读到书签（文件不存在、被占用或结构不认识），换一个浏览器试试。
          </p>
        )}
        {pickedBrowser !== null && sources !== null && sources.length > 0 && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <span className="t-xs text-[var(--muted)]">账户</span>
              <select
                value={pickedSource}
                aria-label="书签来源"
                onChange={(e) => {
                  setPickedSource(Number(e.target.value));
                  setPicked(new Set());
                }}
                className={SELECT_CLASS}
              >
                {sources.map((s, i) => (
                  <option key={`${s.browser}-${s.profile}`} value={i}>
                    {s.profile}（{s.items.length} 条）
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
        )}
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
        只读本机书签文件（不改、不动原文件），勾选后只加进你的「我的入口」（本机保存，不参与团队同步）。
      </p>
      {body()}
    </Dialog>
  );
}
