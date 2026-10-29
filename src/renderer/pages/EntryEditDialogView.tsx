/**
 * EntryEditDialogView —— 入口编辑器的视图层：把请求映射成对应存储的写入。
 *
 * create + team → editStore.createEntry（目标分组为空时自动回落/建组）；
 * create + personal → personalStore.addEntryObject（同一套类型/目标表单，支持网页）；
 * edit + team → editStore.saveEntry（原 id 整条替换）；
 * edit + personal → personalStore.updateEntryObject（原 id 整条替换，改了组就迁移）。
 * 确认成功即关编辑器；校验失败对话框内部已经挡住，这里不重复判。
 */
import { useEdit } from '../store/editStore.tsx';
import { usePersonal } from '../store/personalStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import { useWorkbench } from '../store/workbenchStore.tsx';
import { api } from '../bridge/index.ts';
import { EntryEditDialog } from '../components/organisms/EntryEditDialog.tsx';
import type { Entry } from '../../shared/schema/entry.ts';

export function EntryEditDialogView() {
  const { entryEditor, closeEntryEditor } = useWorkbench();
  const edit = useEdit();
  const personal = usePersonal();
  const { push } = useToasts();
  if (!entryEditor) return null;

  const mode = entryEditor.mode;
  const scope = entryEditor.scope;
  // edit 用原入口；create 的 prefill = 粘贴快捷添加的预填内容（确认时重新生成 id）。
  const initial = entryEditor.mode === 'edit' ? entryEditor.entry : (entryEditor.prefill ?? null);

  /** 写入失败都要说出来（容量撞上限是常见原因）：此前团队侧的结果被丢掉，点了没反应。 */
  const reportFailure = (r: { ok: boolean; reason?: string }): void => {
    if (!r.ok && r.reason) push({ title: r.reason, tone: 'warn' });
  };

  const onConfirm = (entry: Entry, groupId: string | null) => {
    if (mode === 'create') {
      // 本机用量统计（仅落本机、不上报）：新建入口的次数。
      void api.usage.bump({ kind: 'feature', key: 'newEntry' });
      if (scope === 'personal') void personal.addEntryObject(entry, groupId).then(reportFailure);
      else reportFailure(edit.createEntry(groupId, entry));
    } else if (scope === 'personal') {
      void personal.updateEntryObject(entry, groupId).then(reportFailure);
    } else {
      edit.saveEntry(entry);
    }
    closeEntryEditor();
  };

  /* 团队编辑态新建也给出分组选择（方案 A 的团队快捷添加必须能选落点）：
     草稿里已有多个分组时渲染下拉；只有一个/没有时 createEntry 自己回落到首组或「其他」。
     团队**编辑**仍不提供改组——saveEntry 只做原位替换，不给一个改了不生效的控件。 */
  const teamGroups = edit.draft?.groups ?? [];
  const groupOptions =
    scope === 'personal'
      ? (personal.config.groups.length > 0
          ? personal.config.groups.map((g) => ({ id: g.id, name: g.name }))
          : [{ id: '', name: '我的入口' }])
      : mode === 'create'
        ? teamGroups.map((g) => ({ id: g.id, name: g.name }))
        : undefined;

  /** 新建：来自「在此组添加」的锁定目标；编辑：预选入口当前所在组（分组选择器仍可改）。 */
  const initialGroupId =
    mode === 'create' ? (entryEditor.groupId ?? null) : null;
  const currentGroupId =
    mode === 'edit' && initial
      ? scope === 'personal'
        ? (personal.config.groups.find((g) => g.entries.some((e) => e.id === initial.id))?.id ?? null)
        : (teamGroups.find((g) => g.entries.some((e) => e.id === initial.id))?.id ?? null)
      : null;

  return (
    <EntryEditDialog
      mode={mode}
      scope={scope}
      initial={initial}
      groupOptions={groupOptions}
      initialGroupId={initialGroupId}
      currentGroupId={currentGroupId}
      onConfirm={onConfirm}
      onCancel={closeEntryEditor}
    />
  );
}
