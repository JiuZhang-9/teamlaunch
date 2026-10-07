/**
 * src/server/listen.ts —— 端口绑定与漂移（ADR-004）
 *
 * 首选 17890，被占用就依次试到 17899。漂移不是异常而是设计：
 * 管理员机上可能已经跑了别的服务，服务起不来比端口不是首选严重得多。
 *
 * 真实端口必须回写给 `ListenInfo` 并由 `/health` 与 UDP 信标广播出去。
 * 客户端写死首选端口的话，漂移时会"发现成功但连不上"，
 * 而且是间歇性的——这是本项目最难归因的故障形态之一。
 *
 * `listen.port` 是**漂移起点**，不是"必须用这个端口"：
 * 曾经这里恒定从 `PREFERRED_TCP_PORT` 起跳，把调用方传进来的 port 静默忽略——
 * 调用方以为自己指定了端口，实际被漂移逻辑吃掉了。
 * 越界一律抛错而不是悄悄退回首选：静默改掉调用方的意图，比拒绝它更难查。
 *
 * ---------------------------------------------------------------------------
 * 自连探测：为什么"bind 成功"不等于"这个端口是我的"
 * ---------------------------------------------------------------------------
 * Windows 的 SO_REUSEADDR 允许在**别人已在监听**的端口上 bind 成功，
 * 于是 `EADDRINUSE` 判不出来。后果不是"连错人"（客户端 `/health` 的
 * instanceId 校验能挡住那个），而是**连不上**：两个 socket 抢同一个连接，
 * 客户端表现为时好时坏的握手失败，现场必然被当成网络问题查。
 *
 * 因此绑定**之前**先自连一次本机该端口，按三态判定：
 *   ours    → 是自己的另一个实例：照常尝试 bind，由 EADDRINUSE 正常漂移
 *   foreign → 拿到了响应但不是我们：**正向证据**，跳过该端口
 *   unknown → 连不上/超时：证据不足，接受（不能因为环境怪异就启不来服务）
 *
 * 判定必须三态。用二态（"是我的 / 不是我的"）会把"有响应但不是我们"
 * 和"压根没响应"混为一谈，而这两者的处置完全相反——
 * 实测 Clash 占 17890 时回的是 400 空正文，正是"有响应但不是我们"。
 *
 * 探测放在 bind **之前**，是为了不需要"close 后重新 listen"——
 * Fastify 实例 close 之后能否复用并不保证，那会引入新的启动失败路径。
 */

import type { FastifyInstance } from 'fastify';
import { API_PREFIX, TCP_PORT_RANGE } from '../shared/constants.ts';
import type { ListenInfo } from './container.ts';

/** 自连探测上限。拿不到响应就按"证据不足"处理，不能拖住启动。 */
const SELF_PROBE_TIMEOUT_MS = 1200;

export function isAddrInUse(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'EADDRINUSE' || code === 'EACCES';
}

export type PortOwnership = 'ours' | 'foreign' | 'unknown';

export interface PortProbe {
  /** 拿到了 HTTP 响应——哪怕 400 / 500 / 不是我们的 JSON。 */
  responded: boolean;
  /** 响应里解出来的 instanceId；解不出来为 null。 */
  instanceId: string | null;
}

/**
 * 三态判定（纯函数，可脱离网络验证）。
 *
 * 顺序有讲究：先看 `responded`，再看 instanceId。
 * 反过来写就会把"拿到了 400"判成 unknown，从而照常绑定一个别人的端口。
 */
export function judgePortProbe(probe: PortProbe, expectedInstanceId: string): PortOwnership {
  if (!probe.responded) return 'unknown';
  if (probe.instanceId === expectedInstanceId) return 'ours';
  return 'foreign';
}

/**
 * 自连本机某端口的 /health。
 *
 * `fetch` 抛错（连接被拒 / 超时 / DNS）才算"没响应"；
 * 只要拿到了 response，哪怕 400、哪怕正文不是 JSON，都算"有响应"。
 * 这一条是三态判定的前提，不能复用 `fetchHealth`——它把两种情况都返回 null。
 */
export async function probePortOwner(port: number, host = '127.0.0.1'): Promise<PortProbe> {
  try {
    const response = await fetch(`http://${host}:${port}${API_PREFIX}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(SELF_PROBE_TIMEOUT_MS),
    });
    let instanceId: string | null = null;
    try {
      const body = (await response.json()) as { code?: number; data?: { instanceId?: unknown } };
      if (body.code === 0 && typeof body.data?.instanceId === 'string') {
        instanceId = body.data.instanceId;
      }
    } catch {
      instanceId = null;
    }
    return { responded: true, instanceId };
  } catch {
    return { responded: false, instanceId: null };
  }
}

export async function listenWithDrift(
  app: FastifyInstance,
  listen: ListenInfo,
  selfInstanceId: string,
): Promise<void> {
  const start = listen.port;
  if (!Number.isInteger(start) || start < TCP_PORT_RANGE.start || start > TCP_PORT_RANGE.end) {
    throw new Error(
      `漂移起点 ${String(start)} 不在允许区间 ${TCP_PORT_RANGE.start}-${TCP_PORT_RANGE.end} 内`,
    );
  }

  let lastError: unknown = null;
  for (let port = start; port <= TCP_PORT_RANGE.end; port += 1) {
    const owner = judgePortProbe(await probePortOwner(port), selfInstanceId);
    if (owner === 'foreign') {
      lastError = new Error(`端口 ${port} 上已有其他服务在响应，跳过`);
      continue;
    }
    try {
      await app.listen({ host: listen.address, port });
      // 只有 bind 成功才回写：漂移前对外报旧端口比报"不知道"更糟。
      listen.port = port;
      return;
    } catch (err) {
      if (!isAddrInUse(err)) throw err;
      lastError = err;
    }
  }
  throw new Error(
    `端口区间 ${start}-${TCP_PORT_RANGE.end} 全部不可用`,
    lastError === null ? undefined : { cause: lastError },
  );
}
