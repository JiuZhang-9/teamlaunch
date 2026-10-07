/**
 * scripts/smoke-server.mjs —— 内嵌同步服务的集成自检
 *
 * 串起一条真实链路：起服务 → 挑战应答 → 发布 → 拉取 → 条件请求 304
 * → 版本冲突 409 → 签名无效 401 → 还原 → 反馈 → 遥测 → 巡检 → 信标应答。
 *
 * 运行（必须用 transform-types，services 用了 TS 参数属性）：
 *   node --experimental-transform-types scripts/smoke-server.mjs
 *
 * 刻意不 mock：真实起 Fastify、真实走 scrypt 派生、真实算 HMAC。
 * 只有这样才能验出"键序/空格/编码任何一处不同就 401"这类问题。
 *
 * **本脚本验不了什么**：跨机鉴权与跨机发现。那需要两台机器，
 * 这里的 UDP 信标只验"查询→单播应答"这一段，不验真实广播跨机可达性。
 */

import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolvePaths } from '../src/repositories/paths.ts';
import { createServer } from '../src/server/app.ts';
import { DiscoveryBeacon } from '../src/server/beacon.ts';
import { sign } from '../src/server/hooks/auth.ts';
import { ChallengeService } from '../src/services/challenge.service.ts';
import { AUTH, BEACON_MAGIC, UDP_DISCOVERY_PORT, DISCOVERY_PERSIST_THROTTLE_MS, PREFERRED_TCP_PORT } from '../src/shared/constants.ts';
import { assertTrustedKdf, deriveVerifier, isTrustedKdf, scryptMemoryBytes, UntrustedKdfError } from '../src/shared/kdf.ts';
import { SettingsRepository } from '../src/repositories/settings.repository.ts';
import { PersonalRepository } from '../src/repositories/personal.repository.ts';
import { PersonalService } from '../src/services/personal.service.ts';
import { checkPersonalSave } from '../src/shared/personal-save.ts';
import { listenWithDrift, judgePortProbe, probePortOwner } from '../src/server/listen.ts';
import { parseBeaconMessage } from '../src/discovery/protocol.ts';
import { EndpointResolver } from '../src/discovery/endpoint-resolver.ts';
import { KnownEndpointsRepository } from '../src/repositories/known-endpoints.repository.ts';
import { decideTopIssue } from '../src/services/diagnostics.service.ts';
import { ACCESS_LOG_FIELDS } from '../src/server/hooks/logging.ts';

const PASSWORD = 'teamlaunch-smoke';
const DEVICE_ID = 'smoke-device';
const nowIso = () => new Date().toISOString();

const results = [];
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * 断言"必须抛错"，并且抛出来的错要**符合预期文案**。
 *
 * 只 assert 抛错是不够的：静默失败和"抛了个看不懂的 schema 报错"都会让
 * 用户对着没反应的界面猜，因此这里连 message 一起验。
 */
async function assertThrows(fn, predicate, message) {
  let thrown;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }
  if (thrown === undefined) throw new Error(`应当报错但没有报错：${message}`);
  if (!predicate(thrown)) {
    const actual = thrown instanceof Error ? thrown.message : String(thrown);
    throw new Error(`${message}（实际：${actual}）`);
  }
}

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? 'ok' });
    process.stdout.write(`  PASS  ${name}${detail ? ` — ${detail}` : ''}\n`);
  } catch (err) {
    failures += 1;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail: message });
    process.stdout.write(`  FAIL  ${name} — ${message}\n`);
  }
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'teamlaunch-smoke-'));
  const paths = resolvePaths(root);
  const accessLog = [];

  const server = await createServer({
    paths,
    address: '127.0.0.1',
    port: 17890,
    accessLog: (entry) => accessLog.push(entry),
  });
  await server.ctx.credentials.setPassword(PASSWORD);
  await server.start();

  const port = server.listen.port;
  const base = `http://127.0.0.1:${port}/api/v1`;
  process.stdout.write(`\nTeamLaunch 同步服务自检 @ ${base}\n`);
  process.stdout.write(`存储根：${root}\n\n`);

  const json = async (method, path, { body, headers = {}, raw = false } = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = raw ? body : JSON.stringify(body);
      if (init.headers['content-type'] === undefined) init.headers['content-type'] = 'application/json';
    }
    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let parsed = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, headers: res.headers, text, body: parsed };
  };

  let token = '';
  let verifier = Buffer.alloc(0);
  let etag = '';
  let revisionAfterPublish = 0;
  let challenge;

  await step('GET /health 返回服务身份与实际端口', async () => {
    const res = await json('GET', '/health');
    assert(res.status === 200, `状态 ${res.status}`);
    assert(res.body?.code === 0, `code=${res.body?.code}`);
    assert(res.body.data.role === 'admin', `role=${res.body.data.role}`);
    assert(res.body.data.httpPort === port, `httpPort=${res.body.data.httpPort} 期望 ${port}`);
    assert(res.body.data.instanceId === server.ctx.instanceId, 'instanceId 不一致');
    return `serviceId=${res.body.data.serviceId} revision=${res.body.data.revision}`;
  });

  await step('POST /auth/challenge 返回挑战与 KDF 参数', async () => {
    const res = await json('POST', '/auth/challenge', { body: { deviceId: DEVICE_ID } });
    assert(res.status === 200, `状态 ${res.status}`);
    const data = res.body.data;
    assert(typeof data.challengeId === 'string' && data.challengeId.length > 0, 'challengeId 缺失');
    assert(data.kdf.name === 'scrypt', `kdf=${data.kdf?.name}`);
    assert(res.headers.get('x-ratelimit-limit') !== null, '缺少 X-RateLimit 头');
    challenge = data;
    return `challengeId=${data.challengeId.slice(0, 8)}… N=${data.kdf.N}`;
  });

  await step('POST /auth/verify 用 proof 换到令牌', async () => {
    // 客户端口：先夹紧线上参数，再派生。顺序不能反——反了就已经被打到了。
    assertTrustedKdf(challenge.kdf);
    verifier = await deriveVerifier(PASSWORD, Buffer.from(challenge.salt, 'base64'), challenge.kdf);
    const proof = ChallengeService.proofOf(verifier, {
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      deviceId: DEVICE_ID,
      serverId: challenge.serverId,
    });
    const res = await json('POST', '/auth/verify', {
      body: { challengeId: challenge.challengeId, deviceId: DEVICE_ID, proof },
    });
    assert(res.status === 200, `状态 ${res.status} body=${res.text}`);
    token = res.body.data.token;
    assert(typeof token === 'string' && token.length > 0, 'token 缺失');
    return `token=${token.slice(0, 8)}… expiresAt=${res.body.data.expiresAt}`;
  });

  await step('POST /auth/verify 错误 proof 被拒绝', async () => {
    const again = await json('POST', '/auth/challenge', { body: { deviceId: DEVICE_ID } });
    const bad = Buffer.alloc(32, 1);
    const proof = ChallengeService.proofOf(bad, {
      challengeId: again.body.data.challengeId,
      challenge: again.body.data.challenge,
      deviceId: DEVICE_ID,
      serverId: again.body.data.serverId,
    });
    const res = await json('POST', '/auth/verify', {
      body: { challengeId: again.body.data.challengeId, deviceId: DEVICE_ID, proof },
    });
    assert(res.status === 401, `状态 ${res.status}`);
    assert(res.body.error === 'ERR_BAD_PROOF', `error=${res.body.error}`);
    return '401 ERR_BAD_PROOF';
  });

  const signed = (method, path, payload) => {
    const bodyText = JSON.stringify(payload);
    const bodyBytes = Buffer.from(bodyText, 'utf8');
    const timestamp = String(Date.now());
    const nonce = randomBytes(12).toString('hex');
    const signature = sign(
      { token, key: verifier },
      { method, path, timestamp, nonce, body: bodyBytes },
    );
    return {
      rawBody: bodyText,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-tl-timestamp': timestamp,
        'x-tl-nonce': nonce,
        'x-tl-signature': signature,
        'x-tl-device-id': DEVICE_ID,
      },
    };
  };

  const configBody = (entries) => ({
    schemaVersion: 1,
    instanceId: server.ctx.instanceId,
    groups: [
      { id: 'g1', name: '常用工具', sort: 0, entries },
    ],
  });

  const entry = (id, name) => ({
    id,
    type: 'app',
    name,
    sort: 0,
    icon: { kind: 'local' },
    target: 'C:\\Windows\\System32\\notepad.exe',
    expandEnv: false,
    updatedAt: nowIso(),
  });

  await step('PUT /config 签名正确 → 发布成功', async () => {
    const req = signed('PUT', '/api/v1/config', {
      baseRevision: 0,
      summary: '自检首次发布',
      config: configBody([entry('e1', '记事本')]),
    });
    const res = await json('PUT', '/config', { body: req.rawBody, headers: req.headers, raw: true });
    assert(res.status === 200, `状态 ${res.status} body=${res.text}`);
    revisionAfterPublish = res.body.data.revision;
    assert(revisionAfterPublish === 1, `revision=${revisionAfterPublish} 期望 1（忽略客户端提交值）`);
    assert(res.headers.get('x-tl-revision') === '1', '缺少 X-TL-Revision');
    return `revision=${revisionAfterPublish} hash=${res.body.data.contentHash.slice(0, 16)}…`;
  });

  await step('GET /config 返回全文与强校验 ETag', async () => {
    const res = await json('GET', '/config', { headers: { 'x-tl-device-id': DEVICE_ID } });
    assert(res.status === 200, `状态 ${res.status}`);
    etag = res.headers.get('etag');
    assert(typeof etag === 'string' && /^"\d+-[0-9a-f]{16}"$/.test(etag), `ETag=${etag}`);
    assert(res.headers.get('x-tl-published-at') !== null, '缺少 X-TL-Published-At');
    assert(res.body.data.groups[0].entries[0].name === '记事本', '内容不符');
    return `ETag=${etag}`;
  });

  await step('GET /config 带 If-None-Match → 304 且无正文', async () => {
    const res = await json('GET', '/config', { headers: { 'if-none-match': etag } });
    assert(res.status === 304, `状态 ${res.status} 期望 304`);
    assert(res.text === '', `304 不该有正文，实际 ${res.text.length} 字节`);
    return '304，正文 0 字节';
  });

  await step('PUT /config 版本落后 → 409 ERR_REVISION_CONFLICT', async () => {
    const req = signed('PUT', '/api/v1/config', {
      baseRevision: 0,
      summary: '冲突用例',
      config: configBody([entry('e1', '记事本')]),
    });
    const res = await json('PUT', '/config', { body: req.rawBody, headers: req.headers, raw: true });
    assert(res.status === 409, `状态 ${res.status} 期望 409`);
    assert(res.body.error === 'ERR_REVISION_CONFLICT', `error=${res.body.error}`);
    assert(res.body.data.currentRevision === revisionAfterPublish, '未回传当前版本');
    return `409，currentRevision=${res.body.data.currentRevision}`;
  });

  await step('PUT /config 签名无效 → 401 ERR_SIGNATURE_INVALID', async () => {
    const req = signed('PUT', '/api/v1/config', {
      baseRevision: revisionAfterPublish,
      summary: '伪造签名',
      config: configBody([entry('e1', '记事本')]),
    });
    req.headers['x-tl-signature'] = Buffer.from(req.headers['x-tl-signature']).reverse().toString('base64');
    const res = await json('PUT', '/config', { body: req.rawBody, headers: req.headers, raw: true });
    assert(res.status === 401, `状态 ${res.status} 期望 401`);
    assert(res.body.error === 'ERR_SIGNATURE_INVALID', `error=${res.body.error}`);
    return '401 ERR_SIGNATURE_INVALID';
  });

  await step('PUT /config 缺少签名头 → 401', async () => {
    const res = await json('PUT', '/config', {
      body: { baseRevision: revisionAfterPublish, summary: 'x', config: configBody([]) },
      headers: { authorization: `Bearer ${token}`, 'x-tl-device-id': DEVICE_ID },
    });
    assert(res.status === 401, `状态 ${res.status} 期望 401`);
    return `401 ${res.body.error}`;
  });

  await step('PUT /config Content-Type 带 charset → 400', async () => {
    const req = signed('PUT', '/api/v1/config', {
      baseRevision: revisionAfterPublish,
      summary: 'charset 变体',
      config: configBody([entry('e1', '记事本')]),
    });
    req.headers['content-type'] = 'application/json; charset=utf-8';
    const res = await json('PUT', '/config', { body: req.rawBody, headers: req.headers, raw: true });
    assert(res.status === 400, `状态 ${res.status} 期望 400`);
    assert(res.body.error === 'ERR_BAD_REQUEST', `error=${res.body.error}`);
    return '400 ERR_BAD_REQUEST';
  });

  await step('PUT /config 内容不合法 → 422 且含字段路径', async () => {
    const req = signed('PUT', '/api/v1/config', {
      baseRevision: revisionAfterPublish,
      summary: '缺字段',
      config: { schemaVersion: 1, instanceId: server.ctx.instanceId, groups: [{ id: 'g1', name: '', sort: 0, entries: [] }] },
    });
    const res = await json('PUT', '/config', { body: req.rawBody, headers: req.headers, raw: true });
    assert(res.status === 422, `状态 ${res.status} 期望 422`);
    assert(Array.isArray(res.body.details?.issues), 'details.issues 缺失');
    return `422，首条 ${res.body.details.issues[0].path}`;
  });

  await step('GET /revisions 需令牌：无令牌 401 / 有令牌 200', async () => {
    const anonymous = await json('GET', '/revisions');
    assert(anonymous.status === 401, `无令牌状态 ${anonymous.status} 期望 401`);
    const res = await json('GET', '/revisions', { headers: { authorization: `Bearer ${token}` } });
    assert(res.status === 200, `有令牌状态 ${res.status}`);
    assert(res.body.data.items.length >= 1, '历史为空');
    return `${res.body.data.items.length} 条历史`;
  });

  await step('POST /revisions/{rev}/restore 生成更高的新版本', async () => {
    const req = signed('POST', `/api/v1/revisions/${revisionAfterPublish}/restore`, {
      baseRevision: revisionAfterPublish,
    });
    const res = await json('POST', `/revisions/${revisionAfterPublish}/restore`, {
      body: req.rawBody,
      headers: req.headers,
      raw: true,
    });
    assert(res.status === 200, `状态 ${res.status} body=${res.text}`);
    assert(res.body.data.revision === revisionAfterPublish + 1, `revision=${res.body.data.revision}`);
    revisionAfterPublish = res.body.data.revision;
    return `新版本 ${revisionAfterPublish}（还原不回退）`;
  });

  await step('POST /revisions/{rev}/restore baseRevision 不符 → 409', async () => {
    const req = signed('POST', `/api/v1/revisions/1/restore`, { baseRevision: 0 });
    const res = await json('POST', '/revisions/1/restore', {
      body: req.rawBody,
      headers: req.headers,
      raw: true,
    });
    assert(res.status === 409, `状态 ${res.status} 期望 409`);
    return '409 ERR_REVISION_CONFLICT';
  });

  await step('POST /feedback 接收并计数', async () => {
    const res = await json('POST', '/feedback', {
      body: {
        items: [
          { entryId: 'e1', entryRevision: 1, reasonCode: 'path_missing', occurredAt: nowIso() },
          { entryId: 'e1', reasonCode: 'path_missing', occurredAt: nowIso() },
        ],
      },
      headers: { 'x-tl-device-id': DEVICE_ID },
    });
    assert(res.status === 200, `状态 ${res.status} body=${res.text}`);
    assert(res.body.data.accepted === 1 && res.body.data.duplicated === 1,
      `accepted=${res.body.data.accepted} duplicated=${res.body.data.duplicated}`);
    return 'accepted=1 duplicated=1（24 小时去重生效）';
  });

  await step('GET /feedback/summary 需令牌并按入口聚合', async () => {
    const anonymous = await json('GET', '/feedback/summary');
    assert(anonymous.status === 401, `无令牌状态 ${anonymous.status}`);
    const res = await json('GET', '/feedback/summary', { headers: { authorization: `Bearer ${token}` } });
    assert(res.status === 200, `状态 ${res.status}`);
    const item = res.body.data.items.find((i) => i.entryId === 'e1');
    assert(item !== undefined, '聚合里没有 e1');
    assert(item.deviceCount === 1, `deviceCount=${item.deviceCount}`);
    return `e1 deviceCount=1 reasonCounts=${JSON.stringify(item.reasonCounts)}`;
  });

  await step('POST /telemetry 接收并自证完整度', async () => {
    const res = await json('POST', '/telemetry', {
      body: {
        items: [{ name: 'session_start', ts: nowIso(), props: { from: 'smoke' } }],
        clientStats: { recorded: 100, uploaded: 90, droppedByEviction: 2, droppedByRetention: 1 },
      },
      headers: { 'x-tl-device-id': DEVICE_ID },
    });
    assert(res.status === 200, `状态 ${res.status} body=${res.text}`);
    assert(res.body.data.accepted === 1, `accepted=${res.body.data.accepted}`);
    return 'accepted=1';
  });

  await step('POST /telemetry 同一设备第二批 → 429（1 批/分钟）', async () => {
    const res = await json('POST', '/telemetry', {
      body: {
        items: [{ name: 'session_start', ts: nowIso(), props: {} }],
        clientStats: { recorded: 1, uploaded: 1, droppedByEviction: 0, droppedByRetention: 0 },
      },
      headers: { 'x-tl-device-id': DEVICE_ID },
    });
    assert(res.status === 429, `状态 ${res.status} 期望 429`);
    assert(res.headers.get('retry-after') !== null, '缺少 Retry-After');
    return `429 Retry-After=${res.headers.get('retry-after')}`;
  });

  await step('GET /diagnostics 返回 topIssue 与 6 项巡检', async () => {
    const res = await json('GET', '/diagnostics', { headers: { authorization: `Bearer ${token}` } });
    assert(res.status === 200, `状态 ${res.status}`);
    const data = res.body.data;
    assert(typeof data.topIssue === 'string', 'topIssue 缺失');
    assert(Array.isArray(data.checks) && data.checks.length === 6, `checks=${data.checks?.length} 期望 6`);
    assert(data.listening.port === port, `listening.port=${data.listening.port}`);
    assert(data.portDrifted === (port !== 17890), 'portDrifted 与实际端口不符');
    assert(typeof data.peerCheckHint === 'string' && data.peerCheckHint.length > 0, '缺少 K-02 提示');
    return `topIssue=${data.topIssue} portDrifted=${data.portDrifted} profile=${data.activeNetworkProfile}`;
  });

  await step('GET /changes 返回增量记录', async () => {
    const res = await json('GET', '/changes?since=0&limit=20', { headers: { 'x-tl-device-id': DEVICE_ID } });
    assert(res.status === 200, `状态 ${res.status}`);
    assert(res.body.data.items.length >= 1, '无变更记录');
    assert(res.body.data.latestRevision === revisionAfterPublish, 'latestRevision 不符');
    return `${res.body.data.items.length} 条，latestRevision=${res.body.data.latestRevision}`;
  });

  await step('GET /assets/{hash} 不存在 → 404', async () => {
    const res = await json('GET', `/assets/${'0'.repeat(64)}`);
    assert(res.status === 404, `状态 ${res.status} 期望 404`);
    return '404 ERR_NOT_FOUND';
  });

  await step('未知路由 → 404 信封', async () => {
    const res = await json('GET', '/not-a-route');
    assert(res.status === 404, `状态 ${res.status}`);
    assert(res.body.error === 'ERR_NOT_FOUND', `error=${res.body.error}`);
    return '404 ERR_NOT_FOUND';
  });

  await step('UDP 信标：查询 → 单播应答带真实端口', async () => {
    const beacon = new DiscoveryBeacon({
      serviceId: server.ctx.serviceId,
      instanceId: server.ctx.instanceId,
      httpPortOf: () => server.listen.port,
      revisionOf: () => server.ctx.teamConfig.revision,
      port: UDP_DISCOVERY_PORT,
    });
    await beacon.start();
    const offer = await new Promise((resolve, reject) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('未在 2 秒内收到应答'));
      }, 2000);
      socket.on('message', (msg) => {
        clearTimeout(timer);
        socket.close();
        resolve(parseBeaconMessage(msg));
      });
      socket.bind(0, '127.0.0.1', () => {
        const query = Buffer.from(
          JSON.stringify({ magic: BEACON_MAGIC, type: 'query', nonce: 'smoke-nonce', anonDeviceId: DEVICE_ID }),
          'utf8',
        );
        socket.send(query, 0, query.length, UDP_DISCOVERY_PORT, '127.0.0.1');
      });
    });
    await beacon.stop();
    assert(offer !== null && offer.type === 'offer', '应答不是合法 offer');
    assert(offer.httpPort === port, `httpPort=${offer.httpPort} 期望 ${port}`);
    assert(offer.instanceId === server.ctx.instanceId, 'instanceId 不符');
    return `offer httpPort=${offer.httpPort} nonce 回显=${offer.nonce}`;
  });

  await step('访问日志只含 method/path/status/durationMs', async () => {
    assert(accessLog.length > 0, '没有采集到访问日志');
    for (const entry of accessLog) {
      const keys = Object.keys(entry).sort();
      const allowed = [...ACCESS_LOG_FIELDS].sort();
      assert(keys.join(',') === allowed.join(','), `日志字段异常：${keys.join(',')}`);
    }
    return `${accessLog.length} 条，字段固定为 ${ACCESS_LOG_FIELDS.join('/')}`;
  });


  await step('发现 L0：手动覆盖端点经 /health 确认并回写缓存', async () => {
    const settings = new SettingsRepository(paths);
    await settings.patch({ serviceUrl: `http://127.0.0.1:${port}` });
    const store = new KnownEndpointsRepository(paths);
    const resolver = new EndpointResolver(store);
    const outcome = await resolver.resolve({
      deviceId: DEVICE_ID,
      serviceUrl: await settings.serviceUrl(),
      expectedInstanceId: server.ctx.instanceId,
      allowLanScan: false,
    });
    assert(outcome.endpoint !== null, `未解析出端点：${outcome.attempts.join(' | ')}`);
    assert(outcome.level === 'L0', `level=${outcome.level} attempts=${outcome.attempts.join(' | ')}`);
    const cache = await store.load();
    assert(cache.endpoints.some((e) => e.baseUrl === `http://127.0.0.1:${port}`), '未回写 L1 缓存');
    return `L0 命中 ${outcome.endpoint.baseUrl}（instanceId 已核对）`;
  });

  await step('发现 L1：无手动覆盖时走上次成功端点', async () => {
    const store = new KnownEndpointsRepository(paths);
    const resolver = new EndpointResolver(store);
    const outcome = await resolver.resolve({
      deviceId: DEVICE_ID,
      expectedInstanceId: server.ctx.instanceId,
      allowLanScan: false,
    });
    assert(outcome.level === 'L1', `level=${outcome.level} attempts=${outcome.attempts.join(' | ')}`);
    return `L1 命中 ${outcome.endpoint?.baseUrl}`;
  });

  await step('发现失败 → 离线（不抛异常，attempts 可解释）', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-cold-'));
    try {
      const store = new KnownEndpointsRepository(resolvePaths(coldRoot));
      const resolver = new EndpointResolver(store);
      const outcome = await resolver.resolve({
        deviceId: DEVICE_ID,
        serviceUrl: 'http://127.0.0.1:1',
        expectedInstanceId: server.ctx.instanceId,
        allowLanScan: false,
      });
      assert(outcome.endpoint === null && outcome.offline, '应判定为离线');
      assert(outcome.attempts.length >= 2, `attempts 过少：${outcome.attempts.join(' | ')}`);
      return `offline=true，attempts=${outcome.attempts.length} 条`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });


  await step('topIssue 优先级严格按架构 §14.2 排序', async () => {
    const ok = { name: 'r', exists: true, enabled: true, profiles: ['Private'], unknown: false };
    const missing = { name: 'r', exists: false, enabled: false, profiles: [], unknown: false };
    const unknownRule = { name: 'r', exists: false, enabled: false, profiles: [], unknown: true };
    const base = {
      serviceListening: true,
      firewallRules: [ok],
      networkProfile: 'Private',
      portDrifted: false,
      dataIntegrity: true,
      knownClientCount: 3,
    };
    const cases = [
      [{ ...base, serviceListening: false, networkProfile: 'Public' }, 'SERVICE_NOT_LISTENING'],
      [{ ...base, networkProfile: 'Public', firewallRules: [missing] }, 'PUBLIC_NETWORK_PROFILE'],
      [{ ...base, firewallRules: [missing] }, 'FIREWALL_RULE_MISSING'],
      [{ ...base, portDrifted: true }, 'PORT_DRIFTED'],
      [{ ...base, dataIntegrity: false }, 'DATA_INTEGRITY_FAILED'],
      [{ ...base, knownClientCount: 0 }, 'PEER_UNVERIFIED'],
      [base, 'NONE'],
      // 巡检命令没跑起来时不下"规则缺失"结论，否则会把管理员引向重装。
      [{ ...base, firewallRules: [unknownRule] }, 'PEER_UNVERIFIED'],
    ];
    for (const [input, expected] of cases) {
      const actual = decideTopIssue(input);
      assert(actual === expected, `期望 ${expected} 实际 ${actual}`);
    }
    return `${cases.length} 组优先级用例全部命中`;
  });


  await step('settings.json：默认值按 schema 补齐，字段名已收口', async () => {
    const fresh = resolvePaths(await mkdtemp(join(tmpdir(), 'teamlaunch-settings-')));
    try {
      const settings = new SettingsRepository(fresh);
      const loaded = await settings.load();
      assert(loaded.role === 'member', `role 默认应为 member，实际 ${loaded.role}`);
      assert(loaded.telemetryEnabled === true, 'telemetryEnabled 默认应为 true');
      assert(loaded.serviceUrl === null, 'serviceUrl 默认应为 null');
      assert(loaded.editIdleTimeoutMs === 600000, `editIdleTimeoutMs=${loaded.editIdleTimeoutMs}`);
      assert(loaded.theme === 'system' && loaded.iconCacheVersion === 1, 'theme / iconCacheVersion 默认值不符');
      assert(loaded.deletedConflictPolicy === 'ask', `deletedConflictPolicy=${loaded.deletedConflictPolicy}`);
      assert(!('knownEndpoints' in loaded), 'knownEndpoints 必须从 settings 删除（归 discovery.json）');
      // 隐私说明未确认时，遥测必须零记录零上报（AC-18）。
      assert((await settings.telemetryEnabled()) === false, '隐私未确认时 telemetryEnabled() 应为 false');
      await settings.patch({ telemetryNoticeAckedAt: nowIso() });
      assert((await settings.telemetryEnabled()) === true, '确认隐私说明后应为 true');
      return 'role=member / telemetryEnabled / serviceUrl=null / 无 knownEndpoints';
    } finally {
      await rm(fresh.root, { recursive: true, force: true });
    }
  });

  await step('discovery.json 写入节流：三要素未变则不落盘', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-throttle-'));
    try {
      const store = new KnownEndpointsRepository(resolvePaths(coldRoot));
      const endpoint = {
        baseUrl: `http://127.0.0.1:${port}`,
        serviceId: server.ctx.serviceId,
        instanceId: server.ctx.instanceId,
        confirmedAt: nowIso(),
      };
      const first = await store.remember(endpoint);
      const second = await store.remember(endpoint);
      assert(first === true, '首次记住必须落盘');
      assert(second === false, '三要素未变且未过节流窗口，不该再写盘');
      const stale = await store.remember(endpoint, Date.now() + DISCOVERY_PERSIST_THROTTLE_MS + 1);
      assert(stale === true, '超过节流窗口后应再次落盘（刷新时间戳）');
      return `窗口 ${DISCOVERY_PERSIST_THROTTLE_MS / 1000}s，first=true / second=false / 超时后=true`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  await step('KDF 夹紧：不受信参数一律拒绝，绝不尝试派生', async () => {
    assert(isTrustedKdf({ ...AUTH.scrypt }), '本地常量那一档必须被判为可信');
    const evil = { N: 2 ** 20, r: 8, p: 1, keylen: 32 };
    assert(!isTrustedKdf(evil), 'N=2^20 必须判为不可信');
    let threw = null;
    try {
      assertTrustedKdf(evil);
    } catch (err) {
      threw = err;
    }
    assert(threw instanceof UntrustedKdfError, `assertTrustedKdf 未抛 UntrustedKdfError：${threw}`);
    // 兜底网：即便绕过强校验，超上限的参数也不能进入 scrypt。
    let derived = null;
    try {
      await deriveVerifier(PASSWORD, Buffer.from('salt'), evil);
    } catch (err) {
      derived = err;
    }
    assert(derived instanceof UntrustedKdfError, 'deriveVerifier 未拦住超上限参数');
    // 架构师实测口径：128·N·r + 128·r·p = 33,555,456，比默认 32MiB 多 1,024 B。
    const need = scryptMemoryBytes(AUTH.scrypt.N, AUTH.scrypt.r, AUTH.scrypt.p);
    assert(need === 33_555_456, `内存用量口径不符：${need}`);
    assert(need - 32 * 1024 * 1024 === 1024, `超出默认上限应为 1024 B，实际 ${need - 32 * 1024 * 1024}`);
    return `需 ${need} B（超默认上限 1024 B），maxmem=${AUTH.scrypt.maxmem} B`;
  });


  await step('personal.json：损坏时如实上报，绝不自愈式清空', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-personal-'));
    try {
      const personalPaths = resolvePaths(coldRoot);
      await mkdir(join(coldRoot, 'config'), { recursive: true });
      await writeFile(personalPaths.personal, '{ 这不是合法 JSON', 'utf8');
      const service = new PersonalService(new PersonalRepository(personalPaths));

      const loaded = await new PersonalRepository(personalPaths).load();
      assert(loaded.corrupt === true && loaded.config === null, '损坏必须如实上报，不能当成空配置');
      const config = await service.load();
      assert(config.groups.length === 0, '损坏时对外返回空配置');
      // AC-14 的核心：读取损坏文件**不得**顺手把它写成空配置。
      assert((await readFile(personalPaths.personal, 'utf8')) === '{ 这不是合法 JSON', '文件被改写了');
      const info = await service.corruption();
      assert(info.corrupt === true && typeof info.reason === 'string', '缺少可复制的损坏说明');
      return `corrupt=true reason="${info.reason}" 文件未被改写`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  await step('个人入口：增删改移 + 导出计数', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-personal-crud-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      let config = await service.upsertEntry('g1', entry('p1', '月报草稿'));
      assert(config.groups.length === 1 && config.groups[0].entries.length === 1, '新增失败');
      config = await service.upsertEntry('g1', { ...entry('p1', '月报草稿改名'), name: '月报草稿改名' });
      assert(config.groups[0].entries[0].name === '月报草稿改名', '编辑失败');
      config = await service.upsertEntry('g1', entry('p2', '临时目录'));
      assert(config.groups[0].entries.length === 2, '第二条新增失败');
      config = await service.moveEntry('p2', 'g1', 0);
      assert(config.groups[0].entries[0].id === 'p2', '移动失败');
      config = await service.removeEntry('p1');
      assert(config.groups[0].entries.length === 1, '删除失败');
      const exported = await service.exportJson();
      assert(exported.entryCount === 1, `导出计数 ${exported.entryCount} 应为 1`);
      assert(JSON.parse(exported.text).groups[0].entries[0].id === 'p2', '导出内容不符');
      return '新增/编辑/移动/删除/导出计数 全部生效';
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  await step('导入：非法 JSON 不改动现有个人数据（AC-14）', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-import-bad-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      await service.upsertEntry('g1', entry('keep', '必须保留'));
      // 提交失败必须是**返回**可展示的结果，不是抛错——抛出去在界面上就是"没反应"。
      const result = await service.commitImport('{ 坏掉的 JSON', { policy: 'overwrite' });
      assert(result.kind === 'error', `非法 JSON 必须被拒绝，实际 ${JSON.stringify(result)}`);
      assert(typeof result.reason === 'string' && result.reason.length > 0, '拒绝原因不能是空的');
      const after = await service.load();
      assert(after.groups[0].entries.length === 1 && after.groups[0].entries[0].id === 'keep',
        '现有个人数据被改动了');
      const preview = service.previewImport('not json', after);
      assert(preview.ok === false && typeof preview.reason === 'string', '预览缺少失败原因');
      return `拒绝并保留原有 1 条；原因="${result.reason}"`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  await step('导入：ID 冲突默认 ask，绝不静默覆盖（AC-15）', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-import-ask-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      await service.upsertEntry('g1', entry('dup', '原有入口'));
      const incoming = JSON.stringify({
        schemaVersion: 1,
        groups: [{ id: 'g1', name: '常用工具', sort: 0, entries: [{ ...entry('dup', '导入的同 id 入口'), id: 'dup' }] }],
      });

      const preview = service.previewImport(incoming, await service.load());
      assert(preview.ok === true, '预览应通过校验');
      assert(preview.preview.conflicts.length === 1 && preview.preview.conflicts[0].kind === 'id',
        `应报 1 条 id 冲突，实际 ${JSON.stringify(preview.preview.conflicts)}`);

      // 默认 ask 且未给决定 → 一个字节都不写。
      const asked = await service.commitImport(incoming, { policy: 'ask' });
      assert(asked.kind === 'needs-decision', `应返回 needs-decision，实际 ${asked.kind}`);
      let current = await service.load();
      assert(current.groups[0].entries[0].name === '原有入口', 'ask 阶段就改了数据');

      // 给了决定才落地：覆盖。
      const applied = await service.commitImport(incoming, {
        policy: 'ask',
        perEntry: { dup: 'overwrite' },
      });
      assert(applied.kind === 'applied' && applied.result.overwritten === 1, '覆盖未生效');
      current = await service.load();
      assert(current.groups[0].entries[0].name === '导入的同 id 入口', '覆盖后内容不符');
      assert(current.groups[0].entries.length === 1, '覆盖不该变成两条');
      return 'ask 阶段零写入；给决定后覆盖生效且仍是 1 条';
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  await step('导入：另存副本保留原条目，跳过保留原条目', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-import-copy-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      await service.upsertEntry('g1', entry('dup', '原有入口'));
      // fresh 的 target 必须与原条目不同，否则它会命中"目标重复"而不是"新增"。
      const fresh = { ...entry('fresh', '全新入口'), target: 'C:////Windows////System32////calc.exe' };
      const incoming = JSON.stringify({
        schemaVersion: 1,
        groups: [{
          id: 'g1',
          name: '常用工具',
          sort: 0,
          entries: [{ ...entry('dup', '导入副本'), id: 'dup' }, fresh],
        }],
      });

      const copied = await service.commitImport(incoming, { policy: 'copy' });
      assert(copied.kind === 'applied', '副本导入未生效');
      assert(copied.result.copied === 1 && copied.result.added === 1,
        `copied=${copied.result.copied} added=${copied.result.added}`);
      let current = await service.load();
      const ids = current.groups[0].entries.map((e) => e.id);
      assert(ids.includes('dup'), '原条目被覆盖');
      assert(current.groups[0].entries.length === 3, `副本后应 3 条，实际 ${current.groups[0].entries.length}`);
      assert(new Set(ids).size === 3, '副本 id 与原 id 重复');

      const skipped = await service.commitImport(incoming, { policy: 'skip' });
      assert(skipped.kind === 'applied' && skipped.result.skipped >= 1, '跳过未生效');
      current = await service.load();
      assert(current.groups[0].entries.length === 3, '跳过不该新增条目');
      assert(current.groups[0].entries.filter((e) => e.name === '原有入口').length === 1, '跳过不该改动原条目');
      return `copy→共 3 条（原条目保留）；skip→仍 3 条且原条目未动`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  await step('导入：目标重复（同 target 不同 id）也能识别', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-import-target-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      await service.upsertEntry('g1', entry('old', '原有入口'));
      const incoming = JSON.stringify({
        schemaVersion: 1,
        groups: [{
          id: 'g1',
          name: '常用工具',
          sort: 0,
          // 与 entry('old') 相同的 target，但 id 不同。
          entries: [{ ...entry('new', '导入入口'), id: 'new' }],
        }],
      });
      const preview = service.previewImport(incoming, await service.load());
      assert(preview.ok === true, '预览应通过');
      assert(preview.preview.conflicts.length === 1 && preview.preview.conflicts[0].kind === 'target',
        `应识别 target 冲突，实际 ${JSON.stringify(preview.preview.conflicts)}`);
      return `target 冲突已识别（existing=${preview.preview.conflicts[0].existingId}）`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  // 导入成功后回带落盘配置，preload 据此刷新缓存。这里的风险不是"没回带"，
  // 而是"回带了一份与磁盘不一致的"——那样缓存刷新会把界面刷成一个错的值，
  // 比不刷新更难查。因此拿磁盘再读一次做比对。
  await step('导入成功回带落盘配置（缓存刷新契约）', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-import-config-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      await service.upsertEntry('g1', entry('old', '原有入口'));
      const incoming = JSON.stringify({
        schemaVersion: 1,
        groups: [{
          id: 'g1',
          name: '常用工具',
          sort: 0,
          // target 必须与原有入口不同，否则命中"目标重复"而不是新增。
          entries: [{ ...entry('fresh', '全新入口'), target: 'C:\\\\Windows\\\\System32\\\\calc.exe' }],
        }],
      });

      const commit = await service.commitImport(incoming, { policy: 'overwrite' });
      assert(commit.kind === 'applied', `导入应成功，实际 ${JSON.stringify(commit)}`);
      const onDisk = await service.load();
      const returned = commit.config.groups.reduce((n, g) => n + g.entries.length, 0);
      const stored = onDisk.groups.reduce((n, g) => n + g.entries.length, 0);
      assert(returned === stored, `回带 ${returned} 条 / 磁盘 ${stored} 条，不一致`);
      assert(commit.config.groups[0].entries.some((e) => e.id === 'fresh'), '回带配置缺少新导入的条目');
      return `applied 回带 ${returned} 条，与磁盘一致`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  // 容量闸门：撞上限必须是"带数字的明确提示"，不能是静默失败，
  // 也不能退化成一条字段级 schema 报错（用户会以为是文件坏了）。
  await step('容量：导入文件超 200 入口 → 明确文案且个人入口零改动', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-cap-import-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      await service.upsertEntry('g1', entry('keep', '原有入口'));
      const tooMany = Array.from({ length: 201 }, (_, i) => entry(`in-${i}`, `导入 ${i}`));
      const incoming = JSON.stringify({
        schemaVersion: 1,
        groups: [{ id: 'g1', name: '常用工具', sort: 0, entries: tooMany }],
      });

      const preview = service.previewImport(incoming, await service.load());
      assert(preview.ok === false, '超 200 入口的导入不该通过预览');
      assert(preview.reason.includes('最多 200 个入口') && preview.reason.includes('8 个分组'),
        `文案没说清上限：${preview.reason}`);
      const after = await service.load();
      assert(after.groups.length === 1 && after.groups[0].entries.length === 1, '超限导入改动了现有数据');

      // 提交同样是"返回 error"，不是抛——界面要能直接显示这句原因。
      const commit = await service.commitImport(incoming, { policy: 'overwrite' });
      assert(commit.kind === 'error' && commit.reason.includes('最多 200 个入口'),
        `提交超限导入应返回带上限文案的 error，实际 ${JSON.stringify(commit)}`);
      const afterCommit = await service.load();
      assert(afterCommit.groups[0].entries.length === 1, '提交超限导入改动了现有数据');
      return `拒绝 201 条导入，文案含"最多 200 个入口 / 8 个分组"，现有 1 条未动`;
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  await step('容量：个人入口满 200 后再添加 → 抛 ERR_PAYLOAD_TOO_LARGE 且落盘未动', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-cap-add-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      const full = Array.from({ length: 200 }, (_, i) => entry(`e-${i}`, `入口 ${i}`));
      await service.save({ schemaVersion: 1, groups: [{ id: 'g1', name: '我的入口', sort: 0, entries: full }] });
      assert((await service.load()).groups[0].entries.length === 200, '200 条应可正常保存');

      await assertThrows(async () => service.upsertEntry('g1', entry('overflow', '第 201 条')),
        (err) => err.code === 'ERR_PAYLOAD_TOO_LARGE'
          && err.message.includes('最多 200 个入口')
          && err.message.includes('8 个分组'),
        '第 201 条应抛带上限文案的 413');

      const after = await service.load();
      assert(after.groups[0].entries.length === 200, `超限后仍应 200 条，实际 ${after.groups[0].entries.length}`);
      assert(after.groups[0].entries.every((e) => e.id !== 'overflow'), '超限的条目不该被写进去');
      return '第 201 条被拦（413 + 上限文案），落盘仍 200 条';
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  // 文件单独看是合法的，但"现有 + 导入"合起来超限。这条分支和上面两条都不同：
  // 预览会通过（无冲突），只有真正合并之后才撞上限，因此必须单独验一次零写入。
  await step('容量：现有 150 + 导入 100 → 合并后超限，预览通过但提交零写入', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-cap-merge-'));
    try {
      const service = new PersonalService(new PersonalRepository(resolvePaths(coldRoot)));
      const existing = Array.from({ length: 150 }, (_, i) => entry(`e-${i}`, `入口 ${i}`));
      await service.save({ schemaVersion: 1, groups: [{ id: 'g1', name: '我的入口', sort: 0, entries: existing }] });
      const incomingEntries = Array.from({ length: 100 }, (_, i) => ({
        ...entry(`in-${i}`, `导入 ${i}`),
        target: `C:\\\\Tools\\\\tool-${i}.exe`,
      }));
      const incoming = JSON.stringify({
        schemaVersion: 1,
        groups: [{ id: 'g2', name: '导入的分组', sort: 1, entries: incomingEntries }],
      });

      const preview = service.previewImport(incoming, await service.load());
      assert(preview.ok === true && preview.preview.conflicts.length === 0,
        `该文件本身合法且无冲突，预览应通过：${JSON.stringify(preview)}`);

      const commit = await service.commitImport(incoming, { policy: 'overwrite' });
      assert(commit.kind === 'error' && commit.reason.includes('最多 200 个入口'),
        `合并后超限应返回带上限文案的 error，实际 ${JSON.stringify(commit)}`);

      const after = await service.load();
      const total = after.groups.reduce((sum, g) => sum + g.entries.length, 0);
      assert(total === 150, `合并超限后应仍是 150 条，实际 ${total}`);
      assert(after.groups.length === 1, '不该留下空的新分组');
      return '文件合法 / 合并超限：预览通过，提交被拦且仍 150 条、未留空分组';
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  // 这条是 advisory-1 堵上的洞：`tl:personal-save` 以前走 localStore 无条件写盘，
  // 不过任何闸，"最多 200 个"因此可以被直接绕过。现在 save 与导入同一道闸。
  await step('容量：直接 save 201 条（原绕过路径）→ 被拦且文件未被创建', async () => {
    const coldRoot = await mkdtemp(join(tmpdir(), 'teamlaunch-cap-save-'));
    try {
      const repository = new PersonalRepository(resolvePaths(coldRoot));
      const service = new PersonalService(repository);
      const tooMany = Array.from({ length: 201 }, (_, i) => entry(`e-${i}`, `入口 ${i}`));
      await assertThrows(
        () => service.save({ schemaVersion: 1, groups: [{ id: 'g1', name: '我的入口', sort: 0, entries: tooMany }] }),
        (err) => err.code === 'ERR_PAYLOAD_TOO_LARGE' && err.message.includes('最多 200 个入口'),
        'save 必须与导入走同一道容量闸',
      );
      const loaded = await repository.load();
      assert(loaded.config === null, '被拦下却还是写了文件');
      return 'save 走同一道闸：201 条被拦，文件未被创建';
    } finally {
      await rm(coldRoot, { recursive: true, force: true });
    }
  });

  // 顺序即 bug 本身：GroupListSchema 自带 ≤8 组 / ≤200 入口的闸，
  // "先 schema 再容量"的顺序下超限输入必然先挂在 schema 上，容量文案永远到不了用户。
  // 这条不依赖 IO，因此可以在 smoke 里真跑——它一度只过了类型检查和代码审阅。
  await step('保存校验：容量闸必须排在 schema 之前', async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => entry(`e-${i}`, `入口 ${i}`));
    const overCapacity = {
      schemaVersion: 1,
      groups: [{ id: 'g1', name: '我的入口', sort: 0, entries: tooMany }],
    };

    const cap = checkPersonalSave(overCapacity);
    assert(cap.ok === false, '超限必须被拒');
    assert(cap.reason.includes('最多 200 个入口'),
      `超限必须给容量文案，实际是：${cap.reason}`);

    // 同时违反结构与容量：容量优先。用户更需要知道的是"太多了"，不是"某字段不对"。
    const both = {
      schemaVersion: 1,
      groups: [{
        id: 'g1',
        name: '我的入口',
        sort: 0,
        entries: [...tooMany.slice(0, 200), { ...entry('bad', '坏条目'), type: 'bogus' }],
      }],
    };
    const bothResult = checkPersonalSave(both);
    assert(bothResult.ok === false && bothResult.reason.includes('最多 200 个入口'),
      `结构与容量同时违反时应报容量，实际：${bothResult.reason}`);

    // 纯结构错误（不超限）仍走结构文案，不能被容量闸吞掉。
    const badShape = {
      schemaVersion: 1,
      groups: [{ id: 'g1', name: '我的入口', sort: 0, entries: [{ ...entry('e1', '坏条目'), type: 'bogus' }] }],
    };
    const shape = checkPersonalSave(badShape);
    assert(shape.ok === false && shape.reason.includes('保存的内容校验未通过'),
      `结构错误应给结构文案，实际：${shape.reason}`);
    assert(Array.isArray(shape.details) && shape.details.length > 0, '结构错误应带字段路径');

    const ok = checkPersonalSave({ schemaVersion: 1, groups: [] });
    assert(ok.ok === true, '合法配置不该被拒');
    return '容量 → 结构 顺序正确：三种输入各自拿到对的那句话';
  });

  // ServerOptions.port 曾被静默忽略（漂移循环恒定从首选常量起跳），调用方以为
  // 自己指定了端口。断言刻意写成"不等于首选"而不是"等于 17893"：
  // 万一 17893 被占，漂移后仍 !== 首选，断言照样成立且不脆弱。
  await step('端口选项：传入的漂移起点真正生效', async () => {
    const probe = Fastify({ logger: false });
    const info = { address: '127.0.0.1', port: PREFERRED_TCP_PORT + 3 };
    try {
      await listenWithDrift(probe, info, 'smoke-self-instance');
      assert(info.port !== PREFERRED_TCP_PORT,
        `传入的起点被忽略了（仍绑在首选 ${PREFERRED_TCP_PORT}）`);
      assert(info.port >= PREFERRED_TCP_PORT + 3, `起点应 ≥ 传入值，实际 ${info.port}`);
      return `port=${PREFERRED_TCP_PORT + 3} 生效，实际绑定 ${info.port}`;
    } finally {
      await probe.close();
    }
  });

  await server.stop();
  await rm(root, { recursive: true, force: true });

  process.stdout.write(`\n合计 ${results.length} 项，失败 ${failures} 项。\n`);
  process.stdout.write(
    '未覆盖（需两台机器）：跨机 UDP 广播可达性、跨机鉴权握手、真实防火墙入站规则生效性。\n',
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
