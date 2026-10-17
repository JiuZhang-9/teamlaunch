/**
 * 更新状态的两句人话（状态行与工作区小窗共用，2026-10-18）。
 *
 * 放 shared 的理由与其它判定类纯函数一致：它是**纯函数**，进 smoke 才有人真跑过它；
 * 留在某个组件里，另一处（工作区小窗）就只能抄一份，抄完两边文案迟早分叉。
 *
 * 文案口径（沿用设置·关于页已定的纪律）：
 *  - 顺序即优先级：已就绪 > 下载中 > 两个源都够不着 > 本轮失败 > 自动检查已关 > 尚未检查 > 已是最新；
 *  - 刻意不给"够不着"加红色/感叹号——公开用户没有局域网镜像、公司网封 GitHub 都是这个
 *    部署形态的常态，界面不该把它说成故障；
 *  - 关掉自动检查不隐瞒、也不冒充"已是最新"：如实说它没在自动查。
 */

/** 与 renderer/bridge/types.ts 的 AppUpdateStatus 结构一致（只用得到的那几项，避免反向依赖）。 */
export interface UpdateStatusLike {
  active: boolean;
  autoCheck: boolean;
  source: 'github' | 'mirror' | null;
  lastResult: 'latest' | 'unreachable' | null;
  availableVersion: string | null;
  readyToInstall: boolean;
  downloadPercent: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
}

/** 更新源的显示名。 */
export function updateSourceLabel(source: 'github' | 'mirror' | null): string {
  if (source === 'github') return 'GitHub';
  if (source === 'mirror') return '局域网镜像';
  return '来源未知';
}

/** 更新状态的一句话。`null` = 还没读到状态。 */
export function updateStatusLine(s: UpdateStatusLike | null): string {
  if (s === null) return '更新状态未知（读取失败）';
  if (!s.active) return '开发态运行：更新检查未启用';
  if (s.readyToInstall && s.availableVersion) return `v${s.availableVersion} 已下载，点右侧按钮安装并重启`;
  if (s.availableVersion) {
    const pct = s.downloadPercent;
    if (typeof pct === 'number' && pct > 0) {
      return `发现 v${s.availableVersion}（${updateSourceLabel(s.source)}），正在后台下载 ${pct}%`;
    }
    return `发现 v${s.availableVersion}（${updateSourceLabel(s.source)}），正在后台下载`;
  }
  if (s.lastResult === 'unreachable') return '暂时连不上更新源（不影响使用）';
  if (s.lastError !== null) return `上次检查未成功：${s.lastError}`;
  if (!s.autoCheck) {
    return s.lastCheckedAt === null
      ? '自动检查已关闭（仍可点右侧手动检查）'
      : `自动检查已关闭 · 上次检查 ${new Date(s.lastCheckedAt).toLocaleString()}`;
  }
  if (s.lastCheckedAt === null) return '尚未检查';
  return `已是最新版本 · 来源 ${updateSourceLabel(s.source)} · ${new Date(s.lastCheckedAt).toLocaleString()}`;
}
