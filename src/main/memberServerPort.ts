/**
 * src/main/memberServerPort.ts —— 员工机的能力端口
 *
 * 反馈是**真实投递**（入队 + 在线即发）；解锁与发布只在**已持令牌**时才走真实链路，
 * 其余保持保守回落。
 *
 * 为什么不无条件给巡检/修防火墙：它们依赖"本机是权威源"这个前提，
 * 员工机上给一个"能点、但点了会失败"的入口，比不给更糟。
 * 保守回落本来就是安全态（反馈 PENDING / 发布 NETWORK_UNREACHABLE / 巡检 null）。
 */
import type { FeedbackDelivery } from '../renderer/bridge/types.ts';
import type { FeedbackBatch } from '../shared/schema/feedback.ts';
import type { PublishRequest } from '../shared/schema/config.ts';
import type { ServerPort } from './serverPort.ts';
import type { MemberSyncClient } from './syncClient.ts';

export function createMemberServerPort(client: MemberSyncClient): ServerPort {
  return {
    async submitFeedback(batch: FeedbackBatch): Promise<FeedbackDelivery> {
      let dropped: 'EXPIRED' | 'QUEUE_FULL' | null = null;
      let pending: string | null = null;
      let allSent = true;
      for (const item of batch.items) {
        const result = await client.submitFeedback(item);
        if (result.status === 'DROPPED') dropped = result.reason;
        else if (result.status === 'PENDING') {
          pending = result.queuedAt;
          allSent = false;
        }
      }
      // 丢弃要可见（AC-13）：只要有一条被丢弃，就不能报成"已排队"。
      if (dropped !== null) return { status: 'DROPPED', reason: dropped };
      if (pending !== null) return { status: 'PENDING', queuedAt: pending };
      return allSent ? { status: 'SENT' } : { status: 'PENDING', queuedAt: new Date().toISOString() };
    },

    async publish(req: PublishRequest) {
      // 没解锁就没有令牌，构不出签名——此时只能如实说"发不出去"，草稿由界面保留。
      if (client.currentSession() === null) return { ok: false, error: 'NETWORK_UNREACHABLE' };
      const reply = await client.publishSigned(req);
      if (reply.ok) return { ok: true, revision: 0, changedCount: 0 };
      return { ok: false, error: reply.status === 401 ? 'SIGNATURE_INVALID' : 'NETWORK_UNREACHABLE' };
    },

    async diagnostics() {
      return null;
    },

    async repairFirewall() {
      return false;
    },

    /**
     * 跨机解锁：走 challenge → verify，不是本机直调 verifyPassword。
     * 那条同进程捷径没有网络暴露面，只能用在起服务的那一侧；
     * 口令错了就是错了，不回退到"试试直调"。
     */
    async verifyAdmin(passphrase: string): Promise<boolean> {
      return client.unlock(passphrase);
    },

    /**
     * 员工机本机没有凭据库——口令存在管理员机上，所以**不能在员工机上设置口令**。
     *
     * 这里曾经恒返回 `enrolled: true`，后果很严重：一台全新安装的机器点「启用管理员模式」
     * 时，界面直接弹出"请输入口令"，而口令根本不存在、界面上也没有任何设置入口，
     * 用户被彻底卡死。现在如实回报 canEnroll=false，界面据此引导先开启管理员角色。
     */
    async adminStatus(): Promise<{ enrolled: boolean; role: 'admin' | 'member'; canEnroll: boolean }> {
      return { enrolled: false, role: 'member', canEnroll: false };
    },

    /** 口令只能在管理员电脑上设置：这里如实拒绝，不伪造成功。 */
    async enrollAdmin(): Promise<{ ok: boolean; reason?: string }> {
      return { ok: false, reason: '口令只能在管理员电脑上设置' };
    },
  };
}
