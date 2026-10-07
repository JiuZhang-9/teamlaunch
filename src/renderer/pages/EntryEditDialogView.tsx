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
import { useWorkbench } from '../store/workbenchStore.tsx';
import { EntryEditDialog } from '../components/organisms/EntryEditDialog.tsx';
import type { Entry } from '../../shared/schema/entry.ts';

export function EntryEditDialogView() {
  const { entryEditor, closeEntryEditor } = useWorkbench();
  const edit = useEdit();
  const personal = usePersonal();
  if (!entryEditor) return null;

  const mode = entryEditor.mode;
  const scope = entryEditor.scope;
  // edit 用原入口；create 的 prefill = 粘贴快捷添加的预填内容（确认时重新生成 id）。
  const initial = entryEditor.mode === 'edit' ? entryEditor.entry : (entryEditor.prefill ?? null);

  const onConfirm = (entry: Entry, groupId: string | null) => {
    if (mode === 'create') {
      if (scope === 'personal') void personal.addEntryObject(entry, groupId);
      else edit.createEntry(groupId, entry);
    } else if (scope === 'personal') {
      void personal.updateEntryObject(entry, groupId);
    } else {
      edit.saveEntry(entry);
    }
    closeEntryEditor();
  };

  const groupOptions =
    scope === 'personal'
      ? (personal.config.groups.length > 0
          ? personal.config.groups.map((g) => ({ id: g.id, name: g.name }))
          : [{ id: '', name: '我的入口' }])
      : undefined;

  /** 新建：来自「在此组添加」的锁定目标；编辑：预选入口当前所在组（分组选择器仍可改）。 */
  const initialGroupId =
    mode === 'create' ? (entryEditor.groupId ?? null) : null;
  const currentGroupId =
    mode === 'edit' && initial
      ? (personal.config.groups.find((g) => g.entries.some((e) => e.id === initial.id))?.id ?? null)
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
