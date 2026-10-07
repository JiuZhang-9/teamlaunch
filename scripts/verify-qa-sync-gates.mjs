#!/usr/bin/env node
/**
 * QA 独立验证 ⑥：同步三重闸门（脏数据 + 更高 revision 时必须保留旧缓存）
 *
 * 死规矩（syncClient 注释第 3 条）：HTTP 200 + zod 校验 + sha256 一致，
 * 三者全过才写盘；任一不过 → SYNC_DATA_REJECTED，**保留旧缓存、一个字节都不写**。
 *
 * 攻击者/故障模型里最难的一条是**服务端返回脏数据但 revision 更高**：
 * 此时"版本更新了"是真的、"内容可信"是假的。若实现是"revision 更高就覆盖"，
 * 员工端会拿一份坏配置替换掉好缓存，且管理员永远不会知道——
 * 因为服务端那边看起来一切正常。
 *
 * 因此这里逐个打穿三道闸，每次都断言：**缓存文件字节未变**。
 * 只断言 state === 'SYNC_DATA_REJECTED' 是不够的——状态对了但写了盘，
 * 界面上一样会显示坏数据（那正是"状态对、数据错"的沉默逻辑错误）。
 *
 * 另外两条是 AC-09 / AC-10 的硬边界：
 *   - 304 一轮不得触碰内存配置对象（不重绘）
 *   - 上一轮成功后本轮失败，必须退回 OFFLINE_CACHED，绝不沿用"已同步"
 *
 * 未验（必须两台机器）：UDP 广播可达性、跨机鉴权握手、真实防火墙入站规则生效性。
 *
 * 用法：npm run verify:qa-sync
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../src/server/app.ts';
import { resolvePaths } from '../src/repositories/paths.ts';
import { canReportTelemetry, createMemberSyncClient } from '../src/main/syncClient.ts';
import { computeContentHash } from '../src/shared/canonical-hash.ts';
import { SettingsSchema } from '../src/shared/schema/local.ts';
import { SCHEMA_VERSION } from '../src/shared/schema/common.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const note = (s) => console.log(`       └ ${s}`);

function pickLanAddress() {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n !== undefined && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  return candidates.find((ip) => ip.startsWith('192.168.'))
    ?? candidates.find((ip) => ip.startsWith('10.'))
    ?? candidates.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
    ?? '127.0.0.1';
}

const adminRoot = await mkdtemp(join(tmpdir(), 'tl-qa-sync-admin-'));
const memberRoot = await mkdtemp(join(tmpdir(), 'tl-qa-sync-member-'));
const CACHE = join(memberRoot, 'cache', 'team-current.json');

let server = null;
let client = null;

/** 构造一份结构合法、且 contentHash 由前后端同一份算法算出的团队配置。 */
function validConfig(instanceId, revision, name) {
  const groups = [
    {
      id: 'g-1',
      name: '日常办公',
      sort: 0,
      entries: [
        {
          id: `e-${revision}`,
          name,
          sort: 0,
          icon: { kind: 'fallback' },
          updatedAt: new Date().toISOString(),
          type: 'folder',
          target: 'D:\\共享\\2026 归档',
        },
      ],
    },
  ];
  const publishedAt = new Date().toISOString();
  const body = { schemaVersion: SCHEMA_VERSION, instanceId, publishedAt, groups };
  return { ...body, revision, contentHash: computeContentHash(body) };
}

const readCache = async () => {
  try {
    return await readFile(CACHE, 'utf8');
  } catch {
    return null;
  }
};

/** 当前注入的应答。每个场景改这一个变量即可。 */
let reply = null;
const transport = {
  fetchConfig: async () => reply,
  postFeedback: async () => ({ ok: false }),
};

try {
  server = await createServer({ paths: resolvePaths(adminRoot) });
  await server.start();
  const instanceId = server.ctx.instanceId;
  const host = pickLanAddress();
  const baseUrl = `http://${host}:${server.listen.port}`;
  process.env.NO_PROXY = `${host},127.0.0.1,localhost`;
  process.env.no_proxy = process.env.NO_PROXY;

  const settings = SettingsSchema.parse({ role: 'member', serviceUrl: baseUrl, pollIntervalMs: 300000 });

  console.log('QA 独立验证 ⑥：同步三重闸门（脏数据 / 更高 revision / 304 / 断网降级）');
  console.log(`  数据源：${baseUrl} · 员工端根：${memberRoot}`);
  console.log('');

  /* ---------- 1. 首次：服务端还没发布（404 是一次成功应答） ---------- */
  reply = { kind: 'notPublished', status: 404, body: null, etag: null, publishedAt: null, reason: 'UNKNOWN' };
  client = await createMemberSyncClient({ root: memberRoot, deviceId: 'QA-MEMBER-001', getSettings: () => settings, transport });
  let snap = client.snapshot();
  check(
    '1｜404（尚未发布）→ ONLINE_LATEST 且不显示离线（2026-09-30 变更口径）',
    snap.state === 'ONLINE_LATEST' && snap.offlineReason === null,
    `state=${snap.state} reason=${snap.offlineReason}`,
  );
  check('1｜404 时 hasCache=false 且 config=null（走正常空状态，不是故障态）', snap.hasCache === false && snap.config === null, `hasCache=${snap.hasCache}`);

  /* ---------- 2. 正常拉到第一版 ---------- */
  const v1 = validConfig(instanceId, 1, '第一版');
  reply = { kind: 'ok', status: 200, body: JSON.stringify({ code: 0, data: v1 }), etag: 'W/"1-aaa"', publishedAt: v1.publishedAt, reason: 'UNKNOWN' };
  await client.refresh();
  snap = client.snapshot();
  check('2｜合法配置 → ONLINE_LATEST 且落盘', snap.state === 'ONLINE_LATEST' && snap.revision === 1, `state=${snap.state} revision=${snap.revision}`);
  const cacheV1 = await readCache();
  check('2｜缓存已写盘', cacheV1 !== null && JSON.parse(cacheV1).revision === 1, `revision=${cacheV1 ? JSON.parse(cacheV1).revision : '-'}`);

  /* ---------- 3. 脏数据 + 更高 revision：sha256 不一致 ---------- */
  const dirty = { ...validConfig(instanceId, 2, '第二版'), contentHash: '0'.repeat(64) };
  reply = { kind: 'ok', status: 200, body: JSON.stringify({ code: 0, data: dirty }), etag: 'W/"2-bbb"', publishedAt: dirty.publishedAt, reason: 'UNKNOWN' };
  await client.refresh();
  snap = client.snapshot();
  check('3｜脏数据（revision 更高但 sha256 不符）→ SYNC_DATA_REJECTED', snap.state === 'SYNC_DATA_REJECTED', `state=${snap.state}`);
  check('3｜脏数据一轮后缓存仍是第一版（revision 未前进）', snap.revision === 1, `revision=${snap.revision}`);
  check('3｜缓存文件字节未变（不是"状态对了但写了盘"）', (await readCache()) === cacheV1);
  if (snap.state !== 'SYNC_DATA_REJECTED') note(`实测 state=${snap.state}：脏数据被当成成功，旧缓存已被覆盖。`);

  /* ---------- 4. 脏数据：schema 不通过（201 条入口） ---------- */
  const tooMany = validConfig(instanceId, 3, '第三版');
  tooMany.groups = [
    {
      id: 'g-1',
      name: 'x',
      sort: 0,
      entries: Array.from({ length: 201 }, (_, k) => ({
        id: `e-${k}`,
        name: `n${k}`,
        sort: 0,
        icon: { kind: 'fallback' },
        updatedAt: new Date().toISOString(),
        type: 'folder',
        target: `D:\\${k}`,
      })),
    },
  ];
  reply = { kind: 'ok', status: 200, body: JSON.stringify({ code: 0, data: tooMany }), etag: 'W/"3-ccc"', publishedAt: tooMany.publishedAt, reason: 'UNKNOWN' };
  await client.refresh();
  snap = client.snapshot();
  check('4｜schema 不通过（201 条）→ SYNC_DATA_REJECTED 且缓存未变', snap.state === 'SYNC_DATA_REJECTED' && (await readCache()) === cacheV1, `state=${snap.state}`);

  /* ---------- 5. 脏数据：正文不是 JSON ---------- */
  reply = { kind: 'ok', status: 200, body: '<html>502 Bad Gateway</html>', etag: null, publishedAt: null, reason: 'UNKNOWN' };
  await client.refresh();
  snap = client.snapshot();
  check('5｜正文不是 JSON（被代理/安全软件插了一脚）→ SYNC_DATA_REJECTED 且缓存未变', snap.state === 'SYNC_DATA_REJECTED' && (await readCache()) === cacheV1, `state=${snap.state}`);

  /* ---------- 6. 脏数据：空正文 ---------- */
  reply = { kind: 'ok', status: 200, body: '', etag: null, publishedAt: null, reason: 'UNKNOWN' };
  await client.refresh();
  snap = client.snapshot();
  check('6｜空正文 → SYNC_DATA_REJECTED 且缓存未变', snap.state === 'SYNC_DATA_REJECTED' && (await readCache()) === cacheV1, `state=${snap.state}`);

  /* ---------- 7. 304：不触碰内存配置对象、不重绘 ---------- */
  const beforeObj = client.snapshot().config;
  const seen = [];
  const off = client.subscribe((s) => seen.push(s));
  reply = { kind: 'notModified', status: 304, body: null, etag: 'W/"1-aaa"', publishedAt: null, reason: 'UNKNOWN' };
  await client.refresh();
  off();
  check('7a｜304 → 仍是 ONLINE_LATEST', client.snapshot().state === 'ONLINE_LATEST', `state=${client.snapshot().state}`);
  check('7a｜304 不替换内存配置对象（列表不重绘、滚动位置不丢）', beforeObj === client.snapshot().config);
  check(
    '7a｜304 一轮推给渲染层的快照里，revision/hasCache/config 全部未变（无重绘依据）',
    seen.every((s) => s.revision === 1 && s.hasCache === true && s.config === beforeObj),
    `push=${seen.length} 状态=${seen.map((s) => s.state).join('>')}`,
  );

  /* 7b. 后台轮询（非用户发起）跑一轮 304：一次都不许推（AC-09 的"不显示干扰提示"） */
  const bgRoot = await mkdtemp(join(tmpdir(), 'tl-qa-sync-bg-'));
  let bgClient = null;
  try {
    const bgSettings = SettingsSchema.parse({ role: 'member', serviceUrl: baseUrl, pollIntervalMs: 5000 });
    reply = { kind: 'ok', status: 200, body: JSON.stringify({ code: 0, data: v1 }), etag: 'W/"1-aaa"', publishedAt: v1.publishedAt, reason: 'UNKNOWN' };
    // 注意：后台轮询一轮要 5 秒，这里只等一轮，避免把整个门禁拖慢。
    bgClient = await createMemberSyncClient({ root: bgRoot, deviceId: 'QA-MEMBER-BG', getSettings: () => bgSettings, transport });
    reply = { kind: 'notModified', status: 304, body: null, etag: 'W/"1-aaa"', publishedAt: null, reason: 'UNKNOWN' };
    const bgSeen = [];
    const bgOff = bgClient.subscribe((s) => bgSeen.push(s));
    const atSubscribe = bgSeen.length; // subscribe 的立即回调（同步，必然有 1 次）
    await new Promise((r) => setTimeout(r, 5600));
    bgOff();
    check(
      '7b｜后台轮询跑 304：零次额外推送（不闪"正在同步"，不触发重绘）',
      bgSeen.length === atSubscribe,
      `subscribe 时=${atSubscribe} 5.6s 后=${bgSeen.length}`,
    );
  } finally {
    bgClient?.stop();
    await rm(bgRoot, { recursive: true, force: true });
  }

  /* ---------- 8. 上一轮成功后本轮失败：必须退回 OFFLINE_CACHED ---------- */
  reply = { kind: 'error', status: 0, body: null, etag: null, publishedAt: null, reason: 'CONNECTION_BLOCKED' };
  await client.refresh();
  snap = client.snapshot();
  check(
    '8｜成功后断网 → OFFLINE_CACHED（绝不沿用上一轮的"已同步"）',
    snap.state === 'OFFLINE_CACHED' && snap.hasCache === true,
    `state=${snap.state} hasCache=${snap.hasCache}`,
  );
  check('8｜断网时 lastSyncedAt 仍是缓存自带的数据时间（不是本机时钟）', snap.lastSyncedAt === v1.publishedAt, `lastSyncedAt=${snap.lastSyncedAt}`);
  check('8｜断网时卡片仍可点：config 不为 null', snap.config !== null);

  /* ---------- 9. 恢复后重新拉到更高版本 ---------- */
  const v2 = validConfig(instanceId, 2, '第二版（真的）');
  reply = { kind: 'ok', status: 200, body: JSON.stringify({ code: 0, data: v2 }), etag: 'W/"2-ddd"', publishedAt: v2.publishedAt, reason: 'UNKNOWN' };
  await client.refresh();
  snap = client.snapshot();
  check('9｜恢复后拉到 revision 2 → ONLINE_LATEST 且缓存前进', snap.state === 'ONLINE_LATEST' && snap.revision === 2, `state=${snap.state} revision=${snap.revision}`);

  /* ---------- 10. AC-11：从未成功同步 + 管理员不可达 → OFFLINE_EMPTY（不是空白页） ---------- */
  const freshRoot = await mkdtemp(join(tmpdir(), 'tl-qa-sync-fresh-'));
  let freshClient = null;
  try {
    const deadSettings = SettingsSchema.parse({ role: 'member', serviceUrl: 'http://127.0.0.1:9', pollIntervalMs: 300000 });
    reply = { kind: 'error', status: 0, body: null, etag: null, publishedAt: null, reason: 'UNKNOWN' };
    freshClient = await createMemberSyncClient({ root: freshRoot, deviceId: 'QA-MEMBER-FRESH', getSettings: () => deadSettings, transport });
    const s = freshClient.snapshot();
    check(
      '10｜从未成功同步 + 数据源不可达 → OFFLINE_EMPTY（有明确的空状态，不是空白页）',
      s.state === 'OFFLINE_EMPTY' && s.hasCache === false && s.config === null,
      `state=${s.state} hasCache=${s.hasCache}`,
    );
    check('10｜OFFLINE_EMPTY 与 OFFLINE_CACHED 是两个不同的态（不得合并成一个"离线"）', s.state !== 'OFFLINE_CACHED');
  } finally {
    freshClient?.stop();
    await rm(freshRoot, { recursive: true, force: true });
  }

  /* ---------- 11. AC-18：隐私门未确认 = 零上报；关遥测 = 立即停 ---------- */
  const gate = (patch) => canReportTelemetry(SettingsSchema.parse(patch));
  check('11｜隐私说明未确认（telemetryNoticeAckedAt=null）→ 零上报', gate({ telemetryEnabled: true, telemetryNoticeAckedAt: null }) === false);
  check('11｜已确认 + 开启 → 可上报', gate({ telemetryEnabled: true, telemetryNoticeAckedAt: new Date().toISOString() }) === true);
  check('11｜关闭遥测 → 立即停（不是"只停上行"）', gate({ telemetryEnabled: false, telemetryNoticeAckedAt: new Date().toISOString() }) === false);
  check('11｜未确认 + 关闭 → 零上报', gate({ telemetryEnabled: false, telemetryNoticeAckedAt: null }) === false);
} finally {
  client?.stop();
  if (server) await server.stop();
  await rm(adminRoot, { recursive: true, force: true });
  await rm(memberRoot, { recursive: true, force: true });
}

console.log('');
console.log('未验（必须两台机器或真机 GUI）：UDP 广播 L2 可达性、网段扫描 L3、跨机鉴权握手、真实防火墙入站规则生效性。');
console.log(`合计 ${failed === 0 ? '全部通过' : `${failed} 项失败`}。`);
process.exit(failed === 0 ? 0 : 1);
