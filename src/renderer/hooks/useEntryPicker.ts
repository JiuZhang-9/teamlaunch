/**
 * 入口采集的共用逻辑：从本机挑程序 / 文件夹，以及扫描开始菜单。
 *
 * 这三条路径此前**完全不存在**：界面上有菜单、点了只有一句提示，
 * 后端也没有对应的能力。现在主进程（picker.ts）与状态层（addEntry）都已补齐，这里把它们接起来。
 *
 * scan 只返回结果、不持有状态：候选列表对话框由调用方渲染（个人页负责），
 * 避免在壳层再塞一份跨组件的瞬态状态。
 */
import { useCallback } from 'react';
import { api } from '../bridge/index.ts';
import { usePersonal } from '../store/personalStore.tsx';
import { useToasts } from '../store/toastStore.tsx';
import type { PickResult, ScanCandidate, ScanResult } from '../bridge/types.ts';

export interface EntryPicker {
  /** 打开选择框挑一个程序（exe / lnk），解析后加入「我的入口」。 */
  addApp(): Promise<void>;
  /** 打开选择框挑一个文件夹，加入「我的入口」。 */
  addFolder(): Promise<void>;
  /** 扫描开始菜单，返回候选列表；调用方负责渲染选择对话框。 */
  scan(): Promise<ScanCandidate[] | null>;
  /** 选择对话框确认后批量落盘，返回实际添加数量。 */
  commitScan(picked: ScanCandidate[]): Promise<number>;
}

function pickedOrNull(r: PickResult): PickResult | null {
  // 取消不是错误，不提示；只有真失败（reason 非空且不是"已取消"）才需要告知用户
  if (!r.ok) return r.reason && r.reason !== '已取消' ? r : null;
  return r;
}

export function useEntryPicker(): EntryPicker {
  const { addEntry, addEntries } = usePersonal();
  const { push } = useToasts();

  const addOne = useCallback(
    async (kind: 'app' | 'folder') => {
      const picked = pickedOrNull(await api.entries.pick(kind));
      if (!picked) return;
      if (!picked.ok) {
        push({ title: picked.reason ?? '选择失败', tone: 'danger' });
        return;
      }
      const res = await addEntry({
        kind: picked.kind,
        name: picked.name,
        target: picked.target,
        sourcePath: picked.sourcePath,
      });
      push(
        res.ok
          ? { title: `已添加「${picked.name}」`, tone: 'success' }
          : { title: res.reason ?? '添加失败', tone: 'danger' },
      );
    },
    [addEntry, push],
  );

  const addApp = useCallback(() => addOne('app'), [addOne]);
  const addFolder = useCallback(() => addOne('folder'), [addOne]);

  const scan = useCallback(async (): Promise<ScanCandidate[] | null> => {
    const result: ScanResult = await api.entries.scanStartMenu();
    if (!result.ok || result.items.length === 0) {
      push({ title: result.reason ?? '没有扫描到可用程序', tone: 'info' });
      return null;
    }
    return result.items;
  }, [push]);

  /** 供选择对话框确认时调用：批量落盘并如实反馈实际添加数量。 */
  const commitScan = useCallback(
    async (picked: ScanCandidate[]) => {
      const res = await addEntries(
        picked.map((p) => ({ kind: 'app' as const, name: p.name, target: p.target, sourcePath: p.sourcePath })),
      );
      push({
        title: res.added > 0 ? `已添加 ${res.added} 个程序` : (res.reason ?? '没有添加任何程序'),
        tone: res.added > 0 ? 'success' : 'danger',
      });
      return res.added;
    },
    [addEntries, push],
  );

  return { addApp, addFolder, scan, commitScan };
}
