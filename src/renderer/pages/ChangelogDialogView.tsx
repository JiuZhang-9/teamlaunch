/**
 * 「更新日志」对话框（2026-10-17 批 5）：渲染**随包分发**的 CHANGELOG.md。
 *
 * 为什么随包而不是只跳 GitHub：内网员工机（以及公司网受限的机器）也能看——
 * 关于页另配一个「在浏览器打开」的外链按钮，两条路并存。
 * 读不到就如实说"随包版本读不到"，并把人指向 Releases 页，不装作没有更新日志。
 */
import { useEffect, useState } from 'react';
import { Button } from '../components/atoms/Button.tsx';
import { ScrollArea } from '../components/atoms/ScrollArea.tsx';
import { Dialog } from '../components/organisms/Dialog.tsx';
import { api } from '../bridge/index.ts';
import { renderMarkdown } from '../lib/markdown.ts';

export function ChangelogDialogView({ onClose }: { onClose(): void }) {
  /** undefined = 读取中；null = 读不到（打包时漏拷或开发态缺文件）。 */
  const [text, setText] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void api.about
      .changelog()
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dialog
      title="更新日志"
      width="xwide"
      onClose={onClose}
      footer={
        <>
          <Button tone="ghost" size="lg" onClick={onClose}>
            关闭
          </Button>
          <Button
            tone="primary"
            size="lg"
            onClick={() => void api.entries.openExternal('https://github.com/JiuZhang-9/teamlaunch/releases')}
          >
            在浏览器打开 Releases
          </Button>
        </>
      }
    >
      <ScrollArea className="max-h-[62vh]" ariaLabel="更新日志">
        {text === undefined ? (
          <p className="t-sm m-0 text-[var(--muted)]">正在读取更新日志…</p>
        ) : text === null ? (
          <p className="t-sm m-0 text-[var(--fg-2)]">
            这个安装包里的更新日志读不到（打包时可能漏拷）。可以点右下角按钮到 Releases 页看。
          </p>
        ) : (
          <div className="md-body t-sm pr-2 text-[var(--fg-2)]" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        )}
      </ScrollArea>
    </Dialog>
  );
}
