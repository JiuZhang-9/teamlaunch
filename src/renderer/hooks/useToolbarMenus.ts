/**
 * 侧栏/工具栏共用的导出动作。
 *
 * 「更多操作」菜单已整体移除（用户明确要求）：从本机添加软件/文件夹由
 * 「添加入口」对话框的「浏览…」承担（同一条系统选择链路，且个人页内容区本就有
 * 同功能按钮）；分组按名称排序移到侧栏分组右键菜单（仅个人页）。
 */
import { useCallback } from 'react';
import { api } from '../bridge/index.ts';
import { usePersonal } from '../store/personalStore.tsx';
import { useToasts } from '../store/toastStore.tsx';

export interface ToolbarMenus {
  doExport(): void;
}

export function useToolbarMenus(): ToolbarMenus {
  const { exportJson } = usePersonal();
  const { push } = useToasts();

  const doExport = useCallback(() => {
    void exportJson().then((result) => {
      if (result.ok) {
        push({
          title: `我的入口已导出到 ${result.path}（共 ${result.count} 项）`,
          tone: 'success',
          duration: 6000,
          actions: [{ label: '复制路径', onSelect: () => void api.clipboard.write(result.path) }],
        });
      } else {
        push({ title: result.reason, tone: 'danger' });
      }
    });
  }, [exportJson, push]);

  return { doExport };
}
