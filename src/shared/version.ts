/**
 * 版本号比较 —— 自动更新"选源"用的纯函数（ADR-009）。
 *
 * 为什么放在 shared：这是判定类纯函数，只活在主进程＝smoke 跑不到（工程纪律）。
 *
 * 它只回答一个问题：**两个源谁报的版本更新**（用来决定去问 GitHub 还是问局域网镜像）。
 * "要不要更新"的最终判定权仍在 electron-updater 手里——界面上的"发现新版本""已就绪"
 * 全部来自它的回调，绝不从这里推导，否则会出现"状态行说有新版、更新器却不动"的假象。
 *
 * 只支持本项目实际会发布的形状：`x.y.z` 与 `x.y.z-<预发布段>`。语义对齐 semver 的
 * 关键点：核心段逐段按**数值**比（1.0.9 < 1.0.10）；带预发布段的低于同核心版本
 * （1.0.22-rc.1 < 1.0.22）。任何畸形状（空串、非数字段）都按 0 处理、永不抛——
 * 更新链上不该有炸点，识别不了的东西老老实实当作"不必更新"。
 */

interface ParsedVersion {
  core: number[];
  pre: string[];
}

function parseVersion(raw: string): ParsedVersion {
  const text = String(raw ?? '').trim();
  const dash = text.indexOf('-');
  const coreText = dash >= 0 ? text.slice(0, dash) : text;
  const preText = dash >= 0 ? text.slice(dash + 1) : '';
  const core = coreText.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  while (core.length < 3) core.push(0);
  return { core, pre: preText === '' ? [] : preText.split('.') };
}

/** 预发布段比较（semver §11）：数字段 < 字母段，段数少的更小。 */
function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number.parseInt(x, 10);
    const ny = Number.parseInt(y, 10);
    const xNum = Number.isFinite(nx) && String(nx) === x;
    const yNum = Number.isFinite(ny) && String(ny) === y;
    if (xNum && yNum) {
      if (nx !== ny) return nx < ny ? -1 : 1;
      continue;
    }
    if (xNum !== yNum) return xNum ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 比较两个版本号：a 新于 b 返回 1，低于返回 -1，相同返回 0。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i += 1) {
    const x = va.core[i] ?? 0;
    const y = vb.core[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  const pre = comparePrerelease(va.pre, vb.pre);
  if (pre === 0) return 0;
  return pre < 0 ? -1 : 1;
}

/** candidate 是否比 current 新（只用于选源）。 */
export function isVersionNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
