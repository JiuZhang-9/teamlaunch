/**
 * src/main/syncClient.ts —— 员工端同步客户端
 *
 * 本文件是**同步 8 态的唯一写入口**（K-B）：UI 只做「枚举 → 视觉」映射，
 * 这里只做「链路事实 → 枚举」，两边都不许推导对方的事。
 *
 * 一轮的完整顺序（顺序不可换）：
 *   1. L0→L3 发现端点（src/discovery/endpoint-resolver.ts，已写好，不重写）
 *   2. GET /config 带 If-None-Match；**304 立即 return** —— 不读盘、不重算、不重绘（AC-09）
 *   3. 三重闸门：HTTP 200 + TeamConfigSchema.safeParse + 本地重算 sha256 == contentHash
 *      任一不过 → SYNC_DATA_REJECTED，**保留旧缓存、一个字节都不写**
 *   4. 通过才原子写盘（cache/team-current.json）
 *   5. 在线即 flush 反馈队列
 *
 * 三条死规矩：
 *   - 新一轮没成功完成，必须退回离线/未知，**绝不沿用上一轮的"已同步"**（设计师头号红线）
 *   - 数据时间只认响应头的 X-TL-Published-At（或已验签正文里的 publishedAt），
 *     绝不用本机时钟推算（PRD §13）
 *   - 遥测在 telemetryNoticeAckedAt === null 时**零上报**（AC-18）
 */

import { KnownEndpointsRepository } from '../repositories/known-endpoints.repository.ts';
import { setUpdateFeedBase } from './updateFeed.ts';
import { resolvePaths, type StoragePaths } from '../repositories/paths.ts';
import { writeJsonAtomic } from '../repositories/atomic-json.ts';
import { TeamConfigRepository } from '../repositories/team-config.repository.ts';
import { EndpointResolver } from '../discovery/endpoint-resolver.ts';
import { loadCache, validateBody, type TeamCache } from './configGate.ts';
import { ChallengeService } from '../services/challenge.service.ts';
import { assertTrustedKdf, deriveVerifier } from '../shared/kdf.ts';
import { API_PREFIX } from '../shared/constants.ts';
import { CAPACITY } from '../shared/schema/common.ts';
import type { PublishRequest } from '../shared/schema/config.ts';
import type { Settings } from '../shared/schema/local.ts';
import type { FeedbackItem } from '../shared/schema/feedback.ts';
import type { FeedbackDelivery, SyncSnapshot, SyncState } from '../renderer/bridge/types.ts';
import type { OfflineReason } from '../renderer/bridge/types.ts';
import { createMutex } from '../utils/single-flight.ts';
import type { SyncServicePort } from './syncBridge.ts';
import { createFeedbackOutbox, type FeedbackOutbox } from './feedbackOutbox.ts';
import { fetchConfig, postFeedback, postTelemetry, type ConfigReply } from './syncTransport.ts';
import { postChallenge, postVerify, signedWrite, type ClientSession } from './authHandshake.ts';

export interface MemberSyncClient extends SyncServicePort {
  /** 提交失效反馈：先入队（PENDING），在线就试发，仅服务端 200 才转 SENT。 */
  submitFeedback(item: FeedbackItem): Promise<FeedbackDelivery>;
  /**
   * 走**完整** challenge → verify 链换取令牌（ADR-006）。
   *
   * 与管理员本机的 `verifyPassword()` 直调是两回事：那是同进程、无网络暴露面的捷径，
   * 只能在起服务那一侧用。跨机一律走这里：口令永不上网，本地派生出 verifier
   * 后只回 proof；拿到的令牌仅内存，且写请求还必须有 HMAC 签名。
   */
  unlock(passphrase: string): Promise<boolean>;
  /** 当前持有的会话（没有则 null）。仅内存，不落盘。 */
  currentSession(): ClientSession | null;
  /** 已持令牌时的签名发布（管理员把本机指向独立服务器时用）。 */
  publishSigned(req: PublishRequest): Promise<{ ok: boolean; status: number }>;
  /** 遥测上报。未过隐私门直接返回 false，一个字节都不发。 */
  reportTelemetry(batch: Parameters<typeof postTelemetry>[0]['batch']): Promise<boolean>;
  stop(): void;
}

export interface SyncClientOptions {
  root: string;
  deviceId: string;
  /** 读设置用回调：用户在设置面板改了 serviceUrl / 轮询间隔，下一轮就生效。 */
  getSettings(): Settings;
  /** 测试注入用；不传则走真实 HTTP。 */
  transport?: {
    fetchConfig(args: { baseUrl: string; deviceId: string; ifNoneMatch: string | null }): Promise<ConfigReply>;
    postFeedback(args: { baseUrl: string; deviceId: string; batch: { items: FeedbackItem[] } }): Promise<{ ok: boolean }>;
  };
}

export async function createMemberSyncClient(options: SyncClientOptions): Promise<MemberSyncClient> {
  const paths: StoragePaths = resolvePaths(options.root);
  const teamConfig = new TeamConfigRepository(paths);
  const resolver = new EndpointResolver(new KnownEndpointsRepository(paths));
  const outbox: FeedbackOutbox = createFeedbackOutbox(paths.feedbackOutbox);
  const transport = options.transport ?? {
    fetchConfig: (args: { baseUrl: string; deviceId: string; ifNoneMatch: string | null }) => fetchConfig(args),
    postFeedback: (args: { baseUrl: string; deviceId: string; batch: { items: FeedbackItem[] } }) => postFeedback(args),
  };

  const roundMutex = createMutex();
  const listeners = new Set<(s: SyncSnapshot) => void>();

  let cache: TeamCache | null = await loadCache(teamConfig, paths);
  let state: SyncState = 'SYNCING';
  let reason: OfflineReason | null = null;
  let lastBaseUrl: string | null = null;
  let session: ClientSession | null = null;
  let everSucceeded = false;
  let timer: NodeJS.Timeout | null = null;

  /** 还没发现成功时用设置里的手动端点（L0）——它本身就是"迁到独立服务器"的开关。 */
  const manualBaseUrl = (): string | null => {
    const raw = options.getSettings().serviceUrl;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };

  const snapshot = (): SyncSnapshot => ({
    state,
    offlineReason: reason,
    hasCache: cache !== null,
    // 数据时间 = 内容自带的时间，不是"我什么时候拉到的"（PRD §13）。
    lastSyncedAt: cache?.config.publishedAt ?? null,
    revision: cache?.config.revision ?? null,
    config: cache?.config ?? null,
  });

  let lastKey = '';
  function setState(next: SyncState, nextReason: OfflineReason | null = null): void {
    state = next;
    reason = nextReason;
    const snap = snapshot();
    // 变化抑制在**服务侧**做（syncBridge 明确不替 UI 兜这件事）：
    // 304 那一轮因此天然不会推给渲染层，也就不会触发重绘。
    const key = `${snap.state}|${snap.offlineReason}|${snap.hasCache}|${snap.revision}`;
    if (key === lastKey) return;
    lastKey = key;
    for (const listener of listeners) listener(snap);
  }

  async function runRound(userInitiated: boolean): Promise<void> {
    return roundMutex(async () => {
      // 后台轮询不进 SYNCING：30 秒一次的"正在同步…"会变成每半分钟闪一次的噪音。
      // 只有用户手动刷新、或还没有任何可渲染内容时才把"正在同步"显式说出来。
      if (userInitiated || cache === null || !everSucceeded) setState('SYNCING');

      const settings = options.getSettings();
      const outcome = await resolver.resolve({
        deviceId: options.deviceId,
        serviceUrl: settings.serviceUrl,
        allowLanScan: true,
      });
      if (outcome.endpoint === null) {
        setUpdateFeedBase(null);
        setState(cache !== null ? 'OFFLINE_CACHED' : 'OFFLINE_EMPTY', 'SERVICE_NOT_FOUND');
        return;
      }
      lastBaseUrl = outcome.endpoint.baseUrl;
      // 端点可用的同时就是更新源（同一台管理员机）：自动更新检查用它。
      setUpdateFeedBase(outcome.endpoint.baseUrl);

      const knownRevision = cache?.config.revision ?? -1;
      if (outcome.endpoint.revision > knownRevision) setState('ONLINE_UPDATE_PENDING');

      const reply = await transport.fetchConfig({
        baseUrl: outcome.endpoint.baseUrl,
        deviceId: options.deviceId,
        ifNoneMatch: cache?.etag ?? null,
      });

      // 304：立即 return，不做任何后续工作。
      // 唯一的例外是补发反馈：**链路已确认在线**，这正是"离线期间攒下的反馈"该发的时机。
      // 少了这一步，攒下的反馈要等到下一次内容变更才会发出去，可能永远等不到。
      if (reply.kind === 'notModified') {
        await flushOutbox(outcome.endpoint.baseUrl);
        setState('ONLINE_LATEST');
        return;
      }
      // 404 是一次成功应答：服务端明确说"还没发布过"，走正常空状态，
      // 禁止归成离线/同步失败（架构 T3.6.2）。
      if (reply.kind === 'notPublished') {
        await flushOutbox(outcome.endpoint.baseUrl);
        setState('ONLINE_LATEST');
        return;
      }
      if (reply.kind === 'error') {
        setState(cache !== null ? 'OFFLINE_CACHED' : 'OFFLINE_EMPTY', reply.reason);
        return;
      }

      const gate = validateBody(reply.body);
      if (gate.config === null) {
        // 三重闸门任一不过：保留旧缓存，绝不落盘，也绝不当成"同步成功"。
        setState('SYNC_DATA_REJECTED');
        return;
      }

      cache = { config: gate.config, etag: reply.etag };
      // 写盘走仓储（与管理员端同一个写入点），保证两边的文件格式永远一致。
      await teamConfig.save(gate.config);
      await writeJsonAtomic(paths.teamMeta, { etag: reply.etag });
      everSucceeded = true;
      setState('ONLINE_LATEST');

      await flushOutbox(outcome.endpoint.baseUrl);
    });
  }

  async function flushOutbox(baseUrl: string | null): Promise<boolean> {
    if (baseUrl === null) return false;
    const pending = await outbox.pending();
    if (pending.length === 0) return false;
    const items = pending.slice(0, CAPACITY.MAX_FEEDBACK_BATCH).map((row) => row.item);
    const reply = await transport.postFeedback({ baseUrl, deviceId: options.deviceId, batch: { items } });
    // 429 也留在队列里：限流是"稍后再试"，不是"这条不要了"。
    if (!reply.ok) return false;
    await outbox.clearSent(items);
    return true;
  }

  const client: MemberSyncClient = {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    async refresh() {
      await runRound(true);
    },
    async submitFeedback(item) {
      const outcome = await outbox.enqueue(item);
      if (outcome.status === 'DROPPED') return { status: 'DROPPED', reason: outcome.reason };
      const sent = await flushOutbox(lastBaseUrl);
      // 入队成功但没发出去 = 仍是待发送，不是成功（AC-13）。
      return sent ? { status: 'SENT' } : { status: 'PENDING', queuedAt: outcome.queuedAt };
    },
    async unlock(passphrase) {
      const baseUrl = lastBaseUrl ?? manualBaseUrl();
      if (baseUrl === null) return false;

      const info = await postChallenge({ baseUrl, deviceId: options.deviceId });
      if (info === null) return false;
      try {
        // K-11：先与本地常量比对，**不一致就拒绝、绝不尝试派生**。
        // 被冒充的实例只要回一个 N=2^20，一次派生就能吃掉 1 GB 内存。
        assertTrustedKdf(info.kdf);
      } catch {
        return false;
      }
      const key = await deriveVerifier(passphrase, Buffer.from(info.salt, 'base64'), info.kdf);
      const proof = ChallengeService.proofOf(key, {
        challengeId: info.challengeId,
        challenge: info.challenge,
        deviceId: options.deviceId,
        serverId: info.serverId,
      });
      const issued = await postVerify({
        baseUrl,
        deviceId: options.deviceId,
        challengeId: info.challengeId,
        challenge: info.challenge,
        proof,
      });
      if (issued === null) return false;
      session = { token: issued.token, key, expiresAt: Date.parse(issued.expiresAt) };
      return true;
    },

    currentSession() {
      if (session === null) return null;
      if (Date.now() > session.expiresAt) {
        session = null;
        return null;
      }
      return session;
    },

    async publishSigned(req) {
      const active = client.currentSession();
      const baseUrl = lastBaseUrl ?? manualBaseUrl();
      if (active === null || baseUrl === null) return { ok: false, status: 0 };
      return signedWrite({
        baseUrl,
        session: active,
        method: 'PUT',
        // path 必须是含 /api/v1 前缀、不含查询串的完整路径——与服务端签名口径一致。
        path: `${API_PREFIX}/config`,
        body: req,
        deviceId: options.deviceId,
      });
    },

    async reportTelemetry(batch) {
      if (!canReportTelemetry(options.getSettings())) return false;
      if (lastBaseUrl === null) return false;
      const reply = await postTelemetry({ baseUrl: lastBaseUrl, deviceId: options.deviceId, batch });
      return reply.ok;
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };

  // 首轮立刻跑：用户看到的第一帧不该是"尚未获取团队入口"然后干等 30 秒。
  await runRound(false);
  const pollMs = options.getSettings().pollIntervalMs;
  timer = setInterval(() => void runRound(false), pollMs);
  return client;
}

/**
 * 遥测闸门（AC-18）：隐私说明未确认 = 零记录、零上报。
 * 关掉遥测同样是彻底停止，不是"只停上行、继续本地记"。
 */
export function canReportTelemetry(settings: Settings): boolean {
  return settings.telemetryEnabled === true && settings.telemetryNoticeAckedAt !== null;
}
