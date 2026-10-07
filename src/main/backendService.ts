/**
 * 内嵌同步服务的装配与生命周期（D-02）。
 *
 * 角色闸门：`settings.role === 'admin'` 才起服务。默认 member（安全默认值：
 * 不显式开启就不起服务、不开防火墙依赖）—— 这条不能反。
 *
 * 依赖方向：main → server 单向；`src/server/**` 不得 import electron
 * （守卫 scripts/guard-server.mjs，接完必须仍通过）。
 *
 * 保守回落一律保留：服务不可用时反馈 PENDING / 发布 NETWORK_UNREACHABLE / 巡检 null，
 * 只是管理员本机上它们会被真实实现取代。
 */
import { join } from 'node:path';
import { resolvePaths, type StoragePaths } from '../repositories/paths.ts';
import { createServer, type SyncServer } from '../server/app.ts';
import type { ServiceContext } from '../server/container.ts';
import { AppError } from '../shared/errors.ts';
import { TeamConfigBodySchema } from '../shared/schema/config.ts';
import { utf8Bytes } from '../shared/schema/common.ts';
import { checkCapacity } from '../services/capacity.service.ts';
import type { DiagnosticSnapshot, FeedbackDelivery, PublishOutcome, SyncSnapshot } from '../renderer/bridge/types.ts';
import type { PublishRequest } from '../shared/schema/config.ts';
import type { FeedbackBatch } from '../shared/schema/feedback.ts';
import type { ServerPort } from './serverPort.ts';
import { NEVER_SYNCED_SNAPSHOT, type SyncServicePort } from './syncBridge.ts';
import { runCommand } from '../platform/process-runner.ts';
import { ensureDeviceIdentity } from './deviceIdentity.ts';
import { setUpdateFeedBase } from './updateFeed.ts';

let server: SyncServer | null = null;
let ctx: ServiceContext | null = null;
let deviceId = 'unknown';

/**
 * 管理员端口的"发言"钩子：本机发布成功后立即推一次新快照给渲染层。
 * 没有它，发布成功后团队页要等下一次手动刷新才会变化（AC-08 的本机零延迟版）。
 */
let notifyAdminSnapshot: (() => void) | null = null;

export const isServiceRunning = (): boolean => server !== null;

/** 局域网通信必须绕过系统代理，否则"能连外网但连不上隔壁工位"（现象诡异且难查）。 */
export function bypassLanProxy(): void {
  const entries = ['127.0.0.1', 'localhost', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'];
  const value = entries.join(',');
  process.env.NO_PROXY = value;
  process.env.no_proxy = value;
}

/**
 * 启动内嵌服务。
 *
 * `userDataRoot` 由调用方注入（Electron 侧传 `app.getPath('userData')`）——
 * 刻意不在本文件 import electron，这样接线层可以在纯 Node 里被真实验证。
 */
export async function startEmbeddedService(userDataRoot: string, role: string | undefined): Promise<boolean> {
  if (role !== 'admin') return false;

  const root = userDataRoot;
  const paths: StoragePaths = resolvePaths(root);
  deviceId = (await ensureDeviceIdentity(root)).deviceId;

  server = await createServer({
    paths,
    // 自动更新文件目录：管理员把构建产物（latest.yml + 安装包）丢进来即对全团队生效。
    updatesDir: join(root, 'updates'),
    accessLog: undefined,
    errorLog: undefined,
  });
  ctx = server.ctx;
  await server.start();
  // 管理员机的更新源就是自己（回环地址，端口可能漂移，以实际监听为准）。
  setUpdateFeedBase(`http://127.0.0.1:${server.listen.port}`);
  return true;
}

export async function stopEmbeddedService(): Promise<void> {
  if (!server) return;
  try {
    await server.stop();
  } finally {
    server = null;
    ctx = null;
    // 旧端口的发言权随服务一起收回，避免停止后还对外推过期快照。
    notifyAdminSnapshot = null;
    setUpdateFeedBase(null);
  }
}

/** 定时清扫挑战/令牌/nonce/限流窗口。服务内不起定时器，由主进程驱动。 */
export function sweepService(): void {
  if (!server) return;
  server.sweep();
}

/* ------------------------------------------------------------------ *
 * ServerPort：管理员本机直接走服务层，不经 HTTP（同进程，无需签名往返）
 * ------------------------------------------------------------------ */

export function createLocalServerPort(): ServerPort {
  return {
    async submitFeedback(batch: FeedbackBatch): Promise<FeedbackDelivery> {
      if (!ctx) return { status: 'PENDING', queuedAt: new Date().toISOString() };
      try {
        const result = await ctx.feedbackService.submit(deviceId, batch.items);
        if (result.rejected > 0 && result.accepted === 0) return { status: 'RATE_LIMITED' };
        if (result.accepted === 0) return { status: 'PENDING', queuedAt: new Date().toISOString() };
        return { status: 'SENT' };
      } catch (err) {
        const code = err instanceof AppError ? err.code : '';
        if (code === 'ERR_RATE_LIMITED') return { status: 'RATE_LIMITED' };
        // 落不到服务端就是排队，不是失败（AC-13：不得显示"提交失败"）
        return { status: 'PENDING', queuedAt: new Date().toISOString() };
      }
    },

    async publish(req: PublishRequest): Promise<PublishOutcome> {
      if (!ctx) return { ok: false, error: 'NETWORK_UNREACHABLE' };
      // 容量闸先于 schema（与服务端 HTTP 路径同一顺序：先分清"量太大"和"内容错"）。
      // Spec §10：容量是服务端强制，本机端口直连服务层也不能绕过。
      const groups = req.config?.groups ?? [];
      const entryCount = groups.reduce((n, g) => n + g.entries.length, 0);
      try {
        checkCapacity({
          bodyBytes: utf8Bytes(JSON.stringify(req.config ?? null)),
          groupCount: groups.length,
          entryCount,
        });
      } catch {
        return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
      }
      // 本机端口是同进程权威源：instanceId 由这里盖戳（渲染层草稿不可能预知服务身份）。
      // 盖戳必须发生在 schema 校验**之前**——首跑草稿的 instanceId 是空串，
      // 先校验再盖戳会让校验永远失败（发布必报 VALIDATION_FAILED 的根因）。
      const gate = TeamConfigBodySchema.safeParse({ ...req.config, instanceId: ctx.instanceId });
      if (!gate.success) return { ok: false, error: 'VALIDATION_FAILED' };
      // 变更判定比整份配置（含公告）：只比 groups 会让"仅改公告"的发布报 0 项变更。
      // 变更**数**必须喂 groups 数组 + 公告各计 1——countChanged 按数组差集实现，
      // 1.0.8 曾把整份配置对象直接喂进去，flatMap 抛 TypeError 被 catch 吞成
      // NETWORK_UNREACHABLE：落盘早已完成，界面却报"发不到管理员电脑"，且
      // 每点一次发布版本号照涨（发布实际成功却报失败的说谎事故，此处已是第二次踩）。
      const prevConfig = ctx.teamConfig.current;
      const before = JSON.stringify({
        groups: prevConfig?.groups ?? [],
        announcements: prevConfig?.announcements ?? [],
      });
      try {
        const result = await ctx.publish.publish({
          baseRevision: req.baseRevision,
          summary: req.summary,
          config: { ...gate.data, instanceId: ctx.instanceId },
          operatorDeviceId: deviceId,
        });
        const after = JSON.stringify({
          groups: gate.data.groups,
          announcements: gate.data.announcements ?? [],
        });
        notifyAdminSnapshot?.();
        const unchanged = before === after;
        const groupsChanged = unchanged ? 0 : countChanged(JSON.stringify(prevConfig?.groups ?? []), JSON.stringify(gate.data.groups));
        const announcementsChanged =
          unchanged || JSON.stringify(prevConfig?.announcements ?? []) === JSON.stringify(gate.data.announcements ?? []) ? 0 : 1;
        return {
          ok: true,
          revision: result.revision,
          changedCount: groupsChanged + announcementsChanged,
        };
      } catch (err) {
        // 未知异常绝不能无声吞掉：吞掉就是把"发布成功但报错"这类自伤事故
        // 伪装成环境问题（网络不通）。写日志留证据，归类仍走保守回落。
        if (!(err instanceof AppError)) {
          console.error('[publish] 服务端未知异常（配置可能已落盘）:', err);
        }
        const code = err instanceof AppError ? err.code : '';
        const map: Record<string, string> = {
          ERR_REVISION_CONFLICT: 'REVISION_CONFLICT',
          ERR_INSTANCE_MISMATCH: 'INSTANCE_MISMATCH',
          ERR_SIGNATURE_INVALID: 'SIGNATURE_INVALID',
          ERR_VALIDATION_FAILED: 'VALIDATION_FAILED',
          ERR_PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
          ERR_RATE_LIMITED: 'RATE_LIMITED',
        };
        const error = map[code] ?? 'NETWORK_UNREACHABLE';
        return { ok: false, error } as PublishOutcome;
      }
    },

    async diagnostics(): Promise<DiagnosticSnapshot | null> {
      if (!ctx) return null;
      const info = await ctx.diagnostics.inspect();
      const profile = info.activeNetworkProfile === 'Public' ? '公用' : '专用';
      const ruleOk = info.firewallRules.every((r) => r.exists && r.enabled);
      const rows: DiagnosticSnapshot['rows'] = [
        { key: '服务监听地址', value: `${info.listening.address}:${info.listening.port}`, level: 'ok' },
        {
          key: '实际端口',
          value: String(info.listening.port),
          level: info.portDrifted ? 'warn' : 'ok',
        },
        { key: '防火墙入站规则', value: ruleOk ? '已创建' : '未创建', level: ruleOk ? 'ok' : 'bad' },
        { key: '活动网络配置文件', value: profile, level: profile === '公用' ? 'warn' : 'ok' },
        { key: '服务版本', value: '1.0.0', level: 'ok' },
        { key: '团队数据版本', value: `v${info.revision}`, level: 'ok' },
        { key: '本机设备标识', value: deviceId, level: 'ok' },
        { key: '交叉验证提示', value: info.peerCheckHint, level: 'ok' },
      ];

      const conclusion: DiagnosticSnapshot['conclusion'] =
        info.topIssue === 'FIREWALL_RULE_MISSING'
          ? {
              level: 'bad',
              title: '入站防火墙规则不存在，其他电脑连不上这台',
              detail: '需要一次管理员权限才能创建规则。',
              actions: [{ id: 'repair', label: '一键修复' }],
            }
          : info.topIssue === 'PUBLIC_NETWORK_PROFILE'
            ? {
                level: 'warn',
                title: '当前网络是「公用」，防火墙规则不会生效',
                detail: '把网络切换为「专用」后重试，或让管理员一键修复。',
                actions: [
                  { id: 'switch-guide', label: '切换引导' },
                  { id: 'repair', label: '一键修复' },
                ],
              }
            : info.topIssue === 'PORT_DRIFTED'
              ? {
                  level: 'warn',
                  title: '服务端口与首选端口不一致',
                  detail: `首选端口被占用，已漂移到 ${info.listening.port}。真实端口靠信标广播告知客户端。`,
                  actions: [{ id: 'view-settings', label: '查看设置' }],
                }
              : null;

      return { rows, conclusion, raw: JSON.stringify(info, null, 2) };
    },

    async repairFirewall(): Promise<boolean> {
      // 建规则需要提权；失败不谎报成功，返回 false 让 UI 走引导文案。
      const res = await runCommand(
        `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\netsh.exe`,
        [
          'advfirewall',
          'firewall',
          'add',
          'rule',
          'name=TeamLaunch 同步服务 (TCP 17890-17899)',
          'dir=in',
          'action=allow',
          'protocol=TCP',
          'localport=17890-17899',
          'remoteip=LocalSubnet',
          'profile=DOMAIN,PRIVATE',
        ],
        8000,
      );
      return !res.spawnFailed && !res.timedOut && res.exitCode === 0;
    },

    async verifyAdmin(passphrase: string): Promise<boolean> {
      if (!ctx) return false;
      try {
        return await ctx.credentials.verifyPassword(passphrase);
      } catch {
        return false;
      }
    },

    /**
     * 管理员机：本机就有凭据库，所以可以**设置**口令；enrolled 表示是否已经设过。
     *
     * canEnroll 与 enrolled 必须分开回报——混在一起会让没设过口令的机器走到"请输入口令"，
     * 而用户既不知道口令、也找不到设置入口（全新安装被卡死的那个事故）。
     */
    async adminStatus(): Promise<{ enrolled: boolean; role: 'admin' | 'member'; canEnroll: boolean }> {
      return { enrolled: ctx?.credentials.hasCredential() ?? false, role: 'admin', canEnroll: true };
    },

    /**
     * 设置口令：服务层抛的是通用文案，这里原样透传，不替它补细节。
     * 补一句"至少 N 位"就等于把口令规则告诉了正在猜口令的人（PRD §14.1）。
     */
    async enrollAdmin(passphrase: string): Promise<{ ok: boolean; reason?: string }> {
      if (!ctx) return { ok: false, reason: '服务未就绪，暂时无法设置口令' };
      try {
        await ctx.credentials.setPassword(passphrase);
        return { ok: true };
      } catch (err) {
        const message = err instanceof AppError ? err.message : '口令设置失败，请重试';
        return { ok: false, reason: message };
      }
    },
  };
}

function countChanged(before: string, after: string): number {
  // before 为空串 = 首次发布（此前没有已发布内容）：全部条目都是"新增"。
  // 绝不能让 JSON.parse('') 的 SyntaxError 逃出去——它会被 catch 吞成
  // NETWORK_UNREACHABLE，发布实际成功却向界面报失败（界面说谎事故）。
  const prev = before
    ? new Set((JSON.parse(before) as Array<{ entries: Array<{ id: string }> }>).flatMap((g) => g.entries.map((e) => e.id)))
    : new Set<string>();
  const next = new Set((JSON.parse(after) as Array<{ entries: Array<{ id: string }> }>).flatMap((g) => g.entries.map((e) => e.id)));
  let n = 0;
  for (const id of next) if (!prev.has(id)) n += 1;
  for (const id of prev) if (!next.has(id)) n += 1;
  return n;
}

/* ------------------------------------------------------------------ *
 * SyncServicePort：管理员本机即权威源，直接给真实快照
 * ------------------------------------------------------------------ */

/**
 * 管理员本机即权威源。
 *
 * 关键区分（架构 T3.6.2）：服务**连通但还没人发布内容**时，
 * 状态必须是 ONLINE_LATEST（链路正常），`hasCache=false` + `config=null`
 * 交给 UI 走正常空状态「团队入口还没有内容」。
 * 不得归成 NEVER_SYNCED，更不得显示"离线"或"同步失败"——
 * 服务端返回 404 是一次成功应答，不是连通性失败。
 * `hasCache` 只表达"本机是否曾有成功缓存"，不借壳表达"从未发布"。
 *
 * 与员工端口不同，这里没有外部事件可等：发布/刷新就是状态变化的全部来源，
 * 所以 subscribe 之外还暴露 emit（经 notifyAdminSnapshot 钩子），
 * 发布成功与手动刷新都会立刻把新快照推给渲染层。
 */
export function createAdminSyncPort(): SyncServicePort {
  const listeners = new Set<(s: SyncSnapshot) => void>();
  let lastKey = '';

  const snapshot = (): SyncSnapshot => {
    if (!ctx) return NEVER_SYNCED_SNAPSHOT;
    const config = ctx.teamConfig.current;
    if (!config) {
      return {
        state: 'ONLINE_LATEST',
        offlineReason: null,
        hasCache: false,
        lastSyncedAt: null,
        revision: ctx.teamConfig.revision,
        config: null,
      };
    }
    return {
      state: 'ONLINE_LATEST',
      offlineReason: null,
      hasCache: true,
      lastSyncedAt: config.publishedAt,
      revision: config.revision,
      config,
    };
  };

  /** AC-09：键不变不重发（subscribe 的首次播报除外——新听众永远要拿到当前值）。 */
  const emit = (): void => {
    if (listeners.size === 0) return;
    const snap = snapshot();
    const key = `${snap.state}|${snap.offlineReason}|${snap.hasCache}|${snap.revision}`;
    if (key === lastKey) return;
    lastKey = key;
    for (const listener of listeners) listener(snap);
  };

  notifyAdminSnapshot = emit;

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    async refresh() {
      sweepService();
      emit();
    },
  };
}

/**
 * 装配失败的保守回落：如实报 NEVER_SYNCED，手动刷新触发重试重装。
 * 绝不伪造"已同步"，也不把失败吞成永远不变的冻结快照。
 */
export function createFallbackSyncPort(retry: () => Promise<void>): SyncServicePort {
  return {
    snapshot: () => NEVER_SYNCED_SNAPSHOT,
    subscribe(listener) {
      listener(NEVER_SYNCED_SNAPSHOT);
      return () => undefined;
    },
    async refresh() {
      await retry();
    },
  };
}

export function currentListenPort(): number | null {
  return server?.listen.port ?? null;
}
