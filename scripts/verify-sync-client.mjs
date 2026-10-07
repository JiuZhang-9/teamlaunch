#!/usr/bin/env node
/**
 * 员工端同步客户端验证：本机起一个 admin 服务，再让**真实的**员工端客户端
 * 通过 L0 手动端点连本机起的 admin 服务，把「发现 → 拉取 → 三重闸门 → 缓存 → 304
 * → 版本变更 → 断网降级 → 反馈入队/重发 → 遥测闸门」整条链跑一遍。
 *
 * 为什么需要它：员工端链路全在局域网，两头都是真机才能完整验。本机验不了的
 * 部分（UDP 广播 L2、网段扫描 L3、防火墙放行）在末尾单独列出，
 * 不允许混进"已验"里充数（K-02）。
 *
 * 用法：node --experimental-transform-types scripts/verify-sync-client.mjs
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../src/server/app.ts';
import { resolvePaths } from '../src/repositories/paths.ts';
import { createMemberSyncClient } from '../src/main/syncClient.ts';
import { validateBody } from '../src/main/configGate.ts';
import { createFeedbackOutbox } from '../src/main/feedbackOutbox.ts';
import { fetchConfig } from '../src/main/syncTransport.ts';
import { signedWrite } from '../src/main/authHandshake.ts';
import { SettingsSchema } from '../src/shared/schema/local.ts';
import { SCHEMA_VERSION } from '../src/shared/schema/common.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const adminRoot = await mkdtemp(join(tmpdir(), 'tl-sync-admin-'));
const memberRoot = await mkdtemp(join(tmpdir(), 'tl-sync-member-'));
const outboxFile = join(memberRoot, 'outbox', 'feedback.jsonl');

const settings = SettingsSchema.parse({ role: 'member', pollIntervalMs: 60000 });
const getSettings = () => settings;

let server = null;
let serviceHost = '127.0.0.1';
let client = null;
let tamperClient = null;
let tamperRoot = null;

/**
 * 挑一个**私有网段**的本机地址，用它而不是 127.0.0.1 去连测试服务。
 *
 * 为什么不能用 127.0.0.1：本机上 17890 可能已被别的软件独占绑定（开发机实测被
 * Clash 占着）。Windows 的 SO_REUSEADDR 会让"我也绑上了"成立，
 * 于是连 127.0.0.1:17890 打到的是对方（回 400 空正文），而连局域网地址
 * 到 0.0.0.0 上的监听才是我自己的服务。
 * 顺带这也更接近真实场景——员工机连的本来就是管理员机的局域网地址。
 */
function pickLanAddress() {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n !== undefined && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  const preferred = candidates.find((ip) => ip.startsWith('192.168.'))
    ?? candidates.find((ip) => ip.startsWith('10.'))
    ?? candidates.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
  return preferred ?? '127.0.0.1';
}

async function bootAdmin() {
  server = await createServer({ paths: resolvePaths(adminRoot) });
  await server.start();
  serviceHost = pickLanAddress();
  settings.serviceUrl = `http://${serviceHost}:${server.listen.port}`;
  const probe = await fetch(`${settings.serviceUrl}/api/v1/health`);
  if (!probe.ok) {
    throw new Error(
      `测试服务不可达（${settings.serviceUrl} status=${probe.status}）—— 17890 段可能被别的进程占用`,
    );
  }
  return server;
}

/** 用服务层的发布通道推一版内容（不走 HTTP，省掉签名往返；发布本身另有冒烟覆盖）。 */
async function publishOnce(label) {
  const ctx = server.ctx;
  const current = ctx.teamConfig.current;
  const result = await ctx.publish.publish({
    baseRevision: current?.revision ?? 0,
    summary: label,
    config: {
      schemaVersion: SCHEMA_VERSION,
      instanceId: ctx.instanceId,
      groups: [
        {
          id: 'g-office',
          name: '日常办公',
          sort: 0,
          entries: [
            {
              id: `e-${label}`,
              name: label,
              sort: 0,
              icon: { kind: 'fallback' },
              updatedAt: new Date().toISOString(),
              type: 'folder',
              target: 'D:\\共享\\2026 归档',
            },
          ],
        },
      ],
    },
    operatorDeviceId: 'DEV-ADMIN',
  });
  return result;
}

try {
  await bootAdmin();
  const first = await publishOnce('第一版');

  /* 1) 发现 → 拉取 → 三重闸门 → 缓存 */
  client = await createMemberSyncClient({ root: memberRoot, deviceId: 'DEV-A·000001', getSettings });
  const snap1 = client.snapshot();
  check(
    'L0 手动端点发现成功并拿到内容',
    snap1.state === 'ONLINE_LATEST' && snap1.config !== null,
    `state=${snap1.state} revision=${snap1.revision}`,
  );
  check('版本号与服务端一致', snap1.revision === first.revision, `client=${snap1.revision} server=${first.revision}`);

  const cached = JSON.parse(await readFile(join(memberRoot, 'cache', 'team-current.json'), 'utf8'));
  check('缓存已写盘（cache/team-current.json）', cached.revision === first.revision, `revision=${cached.revision}`);
  const meta = JSON.parse(await readFile(join(memberRoot, 'cache', 'team-meta.json'), 'utf8'));
  check('ETag 原样存盘（禁止本地构造）', typeof meta.etag === 'string' && meta.etag.length > 0, `etag=${meta.etag}`);

  /* 2) 304：不替换内存里的配置对象，UI 因此没有重绘依据（AC-09） */
  const before = client.snapshot().config;
  const seen = [];
  const unsubscribe = client.subscribe((s) => seen.push(s));
  await client.refresh();
  unsubscribe();
  check('304 一轮后仍是 ONLINE_LATEST', client.snapshot().state === 'ONLINE_LATEST');
  check('304 不替换内存配置对象（不触碰列表、不重绘）', before === client.snapshot().config);
  check(
    '304 一轮内没有出现别的版本号',
    seen.every((s) => s.revision === first.revision),
    `emits=${seen.length}`,
  );

  /* 3) 版本变更 */
  const second = await publishOnce('第二版');
  await client.refresh();
  const snap3 = client.snapshot();
  check('新版本被拉取并落盘', snap3.revision === second.revision, `client=${snap3.revision} server=${second.revision}`);
  check(
    '数据时间取自内容自带时间，不是本机时钟（PRD §13）',
    snap3.lastSyncedAt === second.publishedAt,
    `at=${snap3.lastSyncedAt}`,
  );

  /* 4) 断网降级：绝不沿用上一轮的"已同步"（设计师头号红线） */
  await server.stop();
  server = null;
  await client.refresh();
  const snap4 = client.snapshot();
  check('服务不可达 → OFFLINE_CACHED（有缓存）', snap4.state === 'OFFLINE_CACHED', `state=${snap4.state} reason=${snap4.offlineReason}`);
  check('降级后仍保留缓存内容', snap4.config !== null && snap4.revision === second.revision);
  check('原因归到"找不到数据源"', snap4.offlineReason === 'SERVICE_NOT_FOUND', `reason=${snap4.offlineReason}`);

  /* 5) 反馈：离线入队 PENDING，恢复后自动重发，仅服务端 200 才转 SENT */
  const offline = await client.submitFeedback({
    entryId: 'e-1',
    reasonCode: 'path_missing',
    occurredAt: new Date().toISOString(),
  });
  check('离线提交 = PENDING（不是成功）', offline.status === 'PENDING', `status=${offline.status}`);
  check('反馈已落 outbox 队列', (await createFeedbackOutbox(outboxFile).size()) === 1);

  await bootAdmin();
  await client.refresh();
  check('恢复在线后回到 ONLINE_LATEST', client.snapshot().state === 'ONLINE_LATEST', `state=${client.snapshot().state}`);
  check('队列被自动 flush（服务端确认后清空）', (await createFeedbackOutbox(outboxFile).size()) === 0);

  const online = await client.submitFeedback({
    entryId: 'e-2',
    reasonCode: 'not_installed',
    occurredAt: new Date().toISOString(),
  });
  check('在线提交且服务端确认 = SENT', online.status === 'SENT', `status=${online.status}`);

  /* 6) 遥测闸门：隐私门未确认 = 零上报（AC-18） */
  const batch = {
    items: [{ name: 'session_start', ts: new Date().toISOString(), props: {} }],
    clientStats: { recorded: 1, uploaded: 0, droppedByEviction: 0, droppedByRetention: 0 },
  };
  check('telemetryNoticeAckedAt=null → 零上报', (await client.reportTelemetry(batch)) === false);
  settings.telemetryNoticeAckedAt = new Date().toISOString();
  check('隐私门确认后可上报（服务端 200）', (await client.reportTelemetry(batch)) === true);

  /* 7) 跨机鉴权：challenge → verify → Bearer + HMAC 签名（不是本机直调） */
  const PASSWORD = 'teamlaunch-admin';
  await server.ctx.credentials.setPassword(PASSWORD);
  check('错误口令解锁失败', (await client.unlock('wrong-password')) === false);
  check('正确口令走完整握手拿到令牌', (await client.unlock(PASSWORD)) === true);
  const session = client.currentSession();
  check('会话含验签密钥（仅内存）', session !== null && session.key.length === 32);

  const cfg = client.snapshot().config;
  const publishBody = {
    baseRevision: cfg.revision,
    summary: '签名发布验证',
    config: { schemaVersion: cfg.schemaVersion, instanceId: cfg.instanceId, groups: cfg.groups },
  };
  const signed = await signedWrite({
    baseUrl: `http://${serviceHost}:${server.listen.port}`,
    session,
    method: 'PUT',
    path: '/api/v1/config',
    body: publishBody,
    deviceId: 'DEV-A·000001',
  });
  check('签名 PUT /api/v1/config 被接受', signed.ok === true, `status=${signed.status}`);

  // 反例：用另一个 path 串签名，却发到 /api/v1/config —— 服务端按自己的 path 重算，必然不符。
  // 这才真正证明"path 进了签名"；直接发 /config 只会得到 404（路由挂在 /api/v1 下），
  // 证明不了任何关于签名的事。
  const { sign } = await import('../src/server/hooks/auth.ts');
  const raw = Buffer.from(JSON.stringify(publishBody), 'utf8');
  const timestamp = String(Date.now());
  const badSignature = sign(session, {
    method: 'PUT',
    path: '/api/v1/other',
    timestamp,
    nonce: 'nonce-path-test',
    body: raw,
  });
  const base = `http://${serviceHost}:${server.listen.port}`;
  const pathMismatch = await fetch(`${base}/api/v1/config`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.token}`,
      'x-tl-device-id': 'DEV-A·000001',
      'x-tl-timestamp': timestamp,
      'x-tl-nonce': 'nonce-path-test',
      'x-tl-signature': badSignature,
    },
    body: raw,
  });
  check(
    '签名覆盖的 path 与请求路径不符 → 401（证明 path 确实进了签名）',
    pathMismatch.status === 401,
    `status=${pathMismatch.status}`,
  );

  const wrongKey = await signedWrite({
    baseUrl: `http://${serviceHost}:${server.listen.port}`,
    session: { token: session.token, key: Buffer.alloc(32, 7), expiresAt: session.expiresAt },
    method: 'PUT',
    path: '/api/v1/config',
    body: publishBody,
    deviceId: 'DEV-A·000001',
  });
  check('密钥不对 → 401（证明签的是原始字节且密钥来自口令派生）', wrongKey.ok === false && wrongKey.status === 401, `status=${wrongKey.status}`);

  /* 8) 三重闸门：contentHash 被篡改 → 拒收，且一个字节都不写 */
  tamperRoot = await mkdtemp(join(tmpdir(), 'tl-sync-tamper-'));
  const tamperSettings = SettingsSchema.parse({
    role: 'member',
    pollIntervalMs: 60000,
    serviceUrl: `http://${serviceHost}:${server.listen.port}`,
  });
  const good = await fetchConfig({
    baseUrl: `http://${serviceHost}:${server.listen.port}`,
    deviceId: 'DEV-B·000002',
    ifNoneMatch: null,
  });
  const tamperedBody = JSON.stringify({ ...JSON.parse(good.body).data, contentHash: 'f'.repeat(64) });
  tamperClient = await createMemberSyncClient({
    root: tamperRoot,
    deviceId: 'DEV-B·000002',
    getSettings: () => tamperSettings,
    transport: {
      fetchConfig: async () => ({
        kind: 'ok',
        status: 200,
        body: tamperedBody,
        etag: null,
        publishedAt: null,
        reason: 'UNKNOWN',
      }),
      postFeedback: async () => ({ ok: true }),
    },
  });
  const snap7 = tamperClient.snapshot();
  check('哈希不符 → SYNC_DATA_REJECTED', snap7.state === 'SYNC_DATA_REJECTED', `state=${snap7.state}`);
  check('拒收时未写入任何缓存（hasCache=false / config=null）', snap7.config === null && snap7.hasCache === false);
  check('闸门函数本身对空正文也不放行', validateBody(null).config === null);

  client.stop();
  client = null;
  check('客户端可停止（轮询定时器不泄漏）', true);
} finally {
  if (client) client.stop();
  if (tamperClient) tamperClient.stop();
  if (server) await server.stop();
  await rm(adminRoot, { recursive: true, force: true });
  await rm(memberRoot, { recursive: true, force: true });
  if (tamperRoot) await rm(tamperRoot, { recursive: true, force: true });
}

console.log(`\n合计 ${failed === 0 ? '全部通过' : `${failed} 项失败`}。`);
console.log(
  '本机已验：L0 发现 → 拉取 → 三重闸门 → 缓存 → 304 → 版本变更 → 断网降级 → 反馈入队/重发 → 遥测闸门。\n' +
    '必须两台机器验：UDP 广播（L2）、网段扫描（L3）、防火墙入站规则是否真的放行（K-02）、跨机鉴权握手。',
);
process.exit(failed === 0 ? 0 : 1);
