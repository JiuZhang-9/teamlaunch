/**
 * 内嵌服务端口（D-02：同步服务内嵌在管理员客户端进程内）。
 *
 * 这里只定义契约与"服务未就绪"时的安全回落，**不实现业务逻辑** ——
 * 实现在 `src/server/**`（后端负责）。回落策略刻意保守：
 *  - 反馈：服务不可用 → `PENDING`（已排队，不是失败；AC-13）
 *  - 发布：服务不可用 → `NETWORK_UNREACHABLE`（草稿由渲染层保留，不得清空）
 *  - 巡检：服务不可用 → `null`（诊断页走 AC-10 的空状态，不得先显示"异常"再翻正）
 */
import type { DiagnosticSnapshot } from '../renderer/bridge/types.ts';
import type { FeedbackDelivery, PublishOutcome } from '../renderer/bridge/types.ts';
import type { PublishRequest } from '../shared/schema/config.ts';
import type { FeedbackBatch } from '../shared/schema/feedback.ts';

export interface ServerPort {
  submitFeedback(batch: FeedbackBatch): Promise<FeedbackDelivery>;
  publish(req: PublishRequest): Promise<PublishOutcome>;
  diagnostics(): Promise<DiagnosticSnapshot | null>;
  repairFirewall(): Promise<boolean>;
  verifyAdmin(passphrase: string): Promise<boolean>;
  /**
   * 口令是否已设置。未设置时 unlock 永远失败，界面必须先走 enroll——
   * 没有这一问，全新安装的机器会一直显示"口令不对"，而真实原因是"还没设过"。
   */
  /**
   * canEnroll 区分"这台机器能不能设置口令"与"口令是否已设置"——
   * 两者混为一谈会让全新安装的机器走到"输入口令"而永远无法设置。
   */
  adminStatus(): Promise<{ enrolled: boolean; role: 'admin' | 'member'; canEnroll: boolean }>;
  /** 失败原因一律通用文案，不回传"至少 N 位"之类的规则（PRD §14.1）。 */
  enrollAdmin(passphrase: string): Promise<{ ok: boolean; reason?: string }>;
}

let port: ServerPort | null = null;

export function installServerPort(next: ServerPort): void {
  port = next;
}

export const serverPort: ServerPort = {
  async submitFeedback(batch) {
    if (!port) return { status: 'PENDING', queuedAt: new Date().toISOString() };
    return port.submitFeedback(batch);
  },
  async publish(req) {
    if (!port) return { ok: false, error: 'NETWORK_UNREACHABLE' };
    return port.publish(req);
  },
  async diagnostics() {
    if (!port) return null;
    return port.diagnostics();
  },
  async repairFirewall() {
    if (!port) return false;
    return port.repairFirewall();
  },
  async verifyAdmin(passphrase) {
    if (!port) return false;
    return port.verifyAdmin(passphrase);
  },
  async adminStatus() {
    // 无端口 = 无法确认，按"未设置"回落：它会把界面引到 enroll，
    // 而 enroll 会如实失败并给出原因，比谎报"已设置"后让人反复输错口令安全。
    if (!port) return { enrolled: false, role: 'member', canEnroll: false };
    return port.adminStatus();
  },
  async enrollAdmin(passphrase) {
    if (!port) return { ok: false, reason: '服务未就绪，暂时无法设置口令' };
    return port.enrollAdmin(passphrase);
  },
};
