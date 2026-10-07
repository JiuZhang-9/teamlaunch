/**
 * AnnouncementsEditorDialog —— 公告管理（2026-10-05 主页模块）。
 *
 * 入口：主页（管理员）与团队编辑态顶栏。操作的是**编辑草稿**里的公告，
 * 走既有的「发布」流程同步给全员——这里不直接落盘，与分组/入口同一纪律。
 * 正文为 Markdown 子集（渲染端转义重建，不透传原始 HTML）。
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../atoms/Button.tsx';
import { Input } from '../atoms/Input.tsx';
import { Textarea } from '../atoms/Textarea.tsx';
import { Dialog } from './Dialog.tsx';
import { useEdit } from '../../store/editStore.tsx';

export function AnnouncementsEditorDialog({ onClose }: { onClose(): void }) {
  const { draft, addAnnouncement, updateAnnouncement, removeAnnouncement, moveAnnouncement } = useEdit();
  const announcements = draft?.announcements ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = announcements.find((a) => a.id === selectedId) ?? null;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bgUrl, setBgUrl] = useState('');
  const [editing, setEditing] = useState(false);

  const startAdd = () => {
    // 不能走 startEdit：它读本次渲染的闭包列表，此刻查不到刚新增的 id。
    const id = addAnnouncement();
    console.log('[TL-ANN] add', id, 'willSelect');
    setSelectedId(id);
    setEditing(true);
    setTitle('新公告');
    setBody('');
    setBgUrl('');
  };

  const startEdit = (id: string) => {
    const a = announcements.find((x) => x.id === id);
    if (!a) return;
    setSelectedId(id);
    setEditing(true);
    setTitle(a.title);
    setBody(a.body);
    setBgUrl(a.backgroundImageUrl ?? '');
  };

  const saveEdit = () => {
    if (!selectedId || title.trim().length === 0) return;
    updateAnnouncement(selectedId, { title: title.trim(), body, backgroundImageUrl: bgUrl.trim() || null });
    setEditing(false);
    setSelectedId(null);
  };

  console.log('[TL-ANN] render', { annLen: announcements.length, selectedId, editing, hasSelected: !!selected });
  return (
    <Dialog title="公告管理" width="wide" onClose={onClose}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="t-sm text-[var(--muted)]">公告随团队配置发布（共 {announcements.length}/10 条），主页按顺序轮播。</p>
        <Button tone="secondary" size="sm" icon={Plus} onClick={startAdd}>
          新增公告
        </Button>
      </div>

      <div className="flex flex-col min-h-[64px] max-h-[300px] overflow-y-auto tl-scroll rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
        {announcements.length === 0 && (
          <p className="t-sm p-4 text-center text-[var(--muted)]">还没有公告。点「新增公告」写第一条。</p>
        )}
        {announcements.map((a, i) => (
          <div
            key={a.id}
            data-announcement-row={a.id}
            className="flex min-h-11 items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1.5 last:border-b-0"
          >
            <Megaphone size={14} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--meta)]" />
            <div className="min-w-0 flex-1">
              <p className="t-sm truncate-1 text-[var(--fg)]">{a.title}</p>
              <p className="t-2xs truncate-1 text-[var(--meta)]">{a.body.slice(0, 60) || '（空正文）'}</p>
            </div>
            <Button
              tone="ghost"
              size="sm"
              aria-label={'上移 ' + a.title}
              icon={ArrowUp}
              softDisabled={i === 0}
              onClick={() => moveAnnouncement(a.id, -1)}
            />
            <Button
              tone="ghost"
              size="sm"
              aria-label={'下移 ' + a.title}
              icon={ArrowDown}
              softDisabled={i === announcements.length - 1}
              onClick={() => moveAnnouncement(a.id, 1)}
            />
            <Button tone="ghost" size="sm" aria-label={'编辑 ' + a.title} icon={Pencil} onClick={() => startEdit(a.id)} />
            <Button
              tone="ghost"
              size="sm"
              aria-label={'删除 ' + a.title}
              icon={Trash2}
              onClick={() => {
                removeAnnouncement(a.id);
                if (selectedId === a.id) {
                  setEditing(false);
                  setSelectedId(null);
                }
              }}
            />
          </div>
        ))}
      </div>

      {editing && selected && (
        <div data-debug-annform="1" className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
          <p className="t-xs mb-1 text-[var(--muted)]">标题</p>
          <Input value={title} aria-label="公告标题" onChange={(e) => setTitle(e.target.value)} />
          <p className="t-xs mb-1 mt-2 text-[var(--muted)]">正文（Markdown：# 标题、**加粗**、- 列表、[链接](网址)、![图片](网址)）</p>
          <Textarea
            value={body}
            aria-label="公告正文"
            rows={6}
            placeholder={'# 维护通知\n本周五 20:00 例行维护，**预计 30 分钟**。\n- 详情见 [团队主页](https://example.org)'}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="t-xs mb-1 mt-2 text-[var(--muted)]">背景图地址（可选，https）</p>
          <Input
            value={bgUrl}
            mono
            aria-label="背景图地址"
            placeholder="https://example.org/bg.jpg"
            onChange={(e) => setBgUrl(e.target.value)}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              tone="ghost"
              size="lg"
              onClick={() => {
                setEditing(false);
                setSelectedId(null);
              }}
            >
              取消
            </Button>
            <Button tone="primary" size="lg" softDisabled={title.trim().length === 0} onClick={saveEdit}>
              保存公告
            </Button>
          </div>
          <p className="t-2xs mt-2 text-[var(--meta)]">保存进草稿后，用底部「发布」同步给全团队。</p>
        </div>
      )}
    </Dialog>
  );
}
