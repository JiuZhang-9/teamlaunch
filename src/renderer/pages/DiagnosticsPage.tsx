/**
 * V-10 诊断页的视图层。
 *
 * Loading 期间不渲染结论块——先显示"异常"再翻正会让用户以为确实坏了（10 §7.6）。
 * 这是全应用唯一允许出现 IP / 端口的地方。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../bridge/index.ts';
import { DiagnosticsView } from '../components/organisms/DiagnosticsView.tsx';
import type { DiagnosticSnapshot } from '../bridge/types.ts';
import { useToasts } from '../store/toastStore.tsx';

export function DiagnosticsPage({ onClose }: { onClose(): void }) {
  const { push } = useToasts();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const next = await api.diagnostics.fetch();
    setSnapshot(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyText = () =>
    (snapshot?.rows ?? []).map((r) => `${r.key} ${r.value}`).join('\n');

  return (
    <DiagnosticsView
      loading={loading}
      snapshot={snapshot}
      copyError={copyError}
      onClose={onClose}
      onRefresh={() => void load()}
      onCopy={() => {
        void api.clipboard.write(copyText()).then((ok) => {
          if (ok) {
            setCopyError(null);
            push({ title: '诊断信息已复制', tone: 'success' });
          } else {
            setCopyError('没能写入剪贴板，请手动选择文本复制');
          }
        });
      }}
      onRepair={() => {
        void api.diagnostics.repair().then((ok) => {
          push({ title: ok ? '防火墙规则已创建' : '修复没能完成，请联系管理员或 IT', tone: ok ? 'success' : 'danger' });
          void load();
        });
      }}
      onSwitchGuide={() =>
        push({
          title: '把当前网络切换为「专用」',
          detail: '设置 → 网络和 Internet → 属性 → 网络配置文件类型 → 专用。切换后回到这里再刷新一次。',
          tone: 'info',
          duration: 8000,
        })
      }
    />
  );
}
