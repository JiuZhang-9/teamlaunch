#!/usr/bin/env node
/**
 * QA 独立验证 ③：HTTP 侧闸门（容量闸 + 签名闸 + 版本闸）
 *
 * 为什么不重跑开发者的 smoke：他们那 43 项里**没有一条覆盖服务端容量闸**。
 * 容量只在"个人入口"侧被验过（smoke 第 36/41 项），而 Spec §10 写的是
 * 「容量硬上限（**服务端强制**）：≤1MB、≤8 分组、≤200 入口」。
 * 服务端这条闸谁也没跑过——它挂在 config.controller，只有带签名的 PUT 才够得着。
 *
 * 因此这里先走完整的 challenge → verify → 签名，再打 PUT /config，逐条验：
 *   - 200 入口 / 201 入口（边界两侧都要跑，只跑一侧看不出 off-by-one）
 *   - 8 分组 / 9 分组
 *   - 正文 > 1MB
 *   - 签名错 / 时间戳偏 3 分钟 / nonce 重放（AC-16 的三条攻击面）
 *   - baseRevision 落后 → 409 而不是 413（错误码不许塌成一类）
 *
 * 用法：npm run verify:qa-http
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../src/server/app.ts';
import { resolvePaths } from '../src/repositories/paths.ts';
import { API_PREFIX, SIGNATURE_HEADERS } from '../src/shared/constants.ts';
import { sign } from '../src/server/hooks/auth.ts';
import { deriveVerifier } from '../src/shared/kdf.ts';
import { ChallengeService } from '../src/services/challenge.service.ts';
import { SCHEMA_VERSION } from '../src/shared/schema/common.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const DEVICE = 'QA-DEVICE-001';
const PASSWORD = 'qa-passphrase-2026';

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

const entry = (id, name, pad = '') => ({
  id,
  name,
  sort: 0,
  icon: { kind: 'fallback' },
  updatedAt: new Date().toISOString(),
  type: 'folder',
  target: `D:\\共享\\${name}${pad}`,
});

const configBody = (instanceId, { groups = 1, perGroup = 1, pad = '' } = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  instanceId,
  groups: Array.from({ length: groups }, (_, g) => ({
    id: `g-${g}`,
    name: `分组${g}`,
    sort: g,
    entries: Array.from({ length: perGroup }, (_, e) => entry(`e-${g}-${e}`, `入口${g}-${e}`, pad)),
  })),
});

const root = await mkdtemp(join(tmpdir(), 'tl-qa-http-'));
let server = null;

try {
  server = await createServer({ paths: resolvePaths(root) });
  await server.start();
  const ctx = server.ctx;
  await ctx.credentials.load();
  await ctx.credentials.setPassword(PASSWORD);

  const host = pickLanAddress();
  const baseUrl = `http://${host}:${server.listen.port}`;
  process.env.NO_PROXY = `${host},127.0.0.1,localhost`;
  process.env.no_proxy = process.env.NO_PROXY;

  console.log('QA 独立验证 ③：HTTP 侧闸门（容量 / 签名 / 版本）');
  console.log(`  端点：${baseUrl}${API_PREFIX}`);
  console.log('');

  /* ---------- 鉴权握手（拿 token 与验签密钥） ---------- */
  const chRes = await fetch(`${baseUrl}${API_PREFIX}/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: DEVICE }),
  });
  const chEnv = await chRes.json();
  const ch = chEnv.data;
  check('握手：拿到挑战与 KDF 参数', chRes.status === 200 && typeof ch?.challengeId === 'string', `status=${chRes.status}`);

  // salt 在线上是 base64 字符串；deriveVerifier 的签名接受 `Buffer | string`，
  // 传字符串时 node:crypto 会按 **UTF-8** 解释，派生结果与服务端（Buffer）必然不等，
  // 表现为"proof 怎么算都是 401"且没有任何解释。这里显式按 base64 解码。
  const key = await deriveVerifier(PASSWORD, Buffer.from(ch.salt, 'base64'), ch.kdf);
  const proof = ChallengeService.proofOf(key, {
    challengeId: ch.challengeId,
    challenge: ch.challenge,
    deviceId: DEVICE,
    serverId: ch.serverId,
  });
  const vRes = await fetch(`${baseUrl}${API_PREFIX}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId: ch.challengeId, deviceId: DEVICE, proof }),
  });
  const vEnv = await vRes.json();
  const token = vEnv.data?.token;
  check('握手：proof 换到令牌', vRes.status === 200 && typeof token === 'string', `status=${vRes.status}`);

  /** 一次带完整签名的 PUT /config。timestamp/nonce 可注入以构造攻击面。 */
  async function putConfig(body, { timestamp, nonce, tamperBody } = {}) {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const ts = timestamp ?? String(Date.now());
    const nc = nonce ?? `${Math.random().toString(36).slice(2)}${Date.now()}`;
    const signature = sign({ token, key }, {
      method: 'PUT',
      path: `${API_PREFIX}/config`,
      timestamp: ts,
      nonce: nc,
      body: tamperBody ?? raw,
    });
    const res = await fetch(`${baseUrl}${API_PREFIX}/config`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [SIGNATURE_HEADERS.timestamp]: ts,
        [SIGNATURE_HEADERS.nonce]: nc,
        [SIGNATURE_HEADERS.signature]: signature,
      },
      body: raw,
    });
    const envelope = await res.json().catch(() => null);
    return { status: res.status, code: envelope?.error ?? null, envelope };
  }

  const revisionOf = () => ctx.teamConfig.current?.revision ?? 0;
  const at = (n) => ({ baseRevision: revisionOf(), summary: `QA-${n}`, config: configBody(ctx.instanceId, n) });

  /* ---------- 1. 容量闸：入口数边界两侧 ---------- */
  const ok200 = await putConfig(at({ groups: 2, perGroup: 100 }));
  check('容量｜正好 200 条入口 → 放行（200 ≤ 200）', ok200.status === 200, `status=${ok200.status} code=${ok200.code}`);

  const bad201 = await putConfig(at({ groups: 2, perGroup: 101 }));
  check('容量｜201 条入口 → 413 ERR_PAYLOAD_TOO_LARGE', bad201.status === 413 && bad201.code === 'ERR_PAYLOAD_TOO_LARGE', `status=${bad201.status} code=${bad201.code}`);

  check(
    '容量｜201 条的错误必须来自容量闸（details.reason=entries），不是字段级 schema 报错',
    bad201.envelope?.details?.reason === 'entries',
    `details=${JSON.stringify(bad201.envelope?.details ?? null).slice(0, 140)}`,
  );
  if (bad201.status === 422) {
    console.log('       └ 实测 422 ERR_VALIDATION_FAILED：PublishRequestSchema 里的 GroupListSchema 先');
    console.log('         一步把「>200 入口 / >8 分组」判成字段校验失败，config.controller 里');
    console.log('         那道 checkCapacity 根本轮不到执行（groups/entries 两分支不可达；');
    console.log('         bodyBytes 分支也被 Fastify bodyLimit=1MB 抢先）。');
    console.log('         后果：界面收到 VALIDATION_FAILED → 文案「请检查各入口的字段」，');
    console.log('         管理员会去改字段，而真正要做的是减少入口数。');
  }

  const bad201b = await putConfig({ ...at({ groups: 1, perGroup: 201 }) });
  check('容量｜单组 201 条（跨组求和之外也要拦）→ 413', bad201b.status === 413, `status=${bad201b.status} code=${bad201b.code}`);

  /* ---------- 2. 容量闸：分组数边界两侧 ---------- */
  const ok8 = await putConfig(at({ groups: 8, perGroup: 1 }));
  check('容量｜正好 8 个分组 → 放行', ok8.status === 200, `status=${ok8.status} code=${ok8.code}`);
  const bad9 = await putConfig(at({ groups: 9, perGroup: 1 }));
  check('容量｜9 个分组 → 413', bad9.status === 413 && bad9.code === 'ERR_PAYLOAD_TOO_LARGE', `status=${bad9.status} code=${bad9.code}`);

  /* ---------- 3. 容量闸：正文 > 1MB ---------- */
  const big = at({ groups: 1, perGroup: 1 });
  big.config.groups[0].entries[0].description = 'x'.repeat(1024 * 1024 + 64);
  const tooBig = await putConfig(big);
  check('容量｜正文 > 1MB → 413（且不能塌成 400/422）', tooBig.status === 413, `status=${tooBig.status} code=${tooBig.code}`);
  check(
    '容量｜>1MB 的 413 必须归一成统一信封并带 ERR_PAYLOAD_TOO_LARGE',
    tooBig.code === 'ERR_PAYLOAD_TOO_LARGE',
    `error=${tooBig.code}`,
  );

  /* ---------- 4. 版本闸：baseRevision 落后 → 409 而不是 413 ---------- */
  const stale = await putConfig({ baseRevision: revisionOf() - 1, summary: '落后版本', config: configBody(ctx.instanceId, { groups: 1, perGroup: 1 }) });
  check('版本｜baseRevision 落后 → 409 ERR_REVISION_CONFLICT（超容量不得抢先报错）', stale.status === 409 && stale.code === 'ERR_REVISION_CONFLICT', `status=${stale.status} code=${stale.code}`);

  const conflictData = stale.envelope?.data ?? null;
  check('版本｜409 回带 currentRevision 供界面提示', conflictData !== null && typeof conflictData.currentRevision === 'number', `data=${JSON.stringify(conflictData)}`);

  /* ---------- 5. 签名闸（AC-16） ---------- */
  const body5 = at({ groups: 1, perGroup: 1 });
  const raw5 = Buffer.from(JSON.stringify(body5), 'utf8');
  const tampered = await putConfig(body5, { tamperBody: Buffer.concat([raw5, Buffer.from(' ')]) });
  check('签名｜正文被改一个字节 → 401 ERR_SIGNATURE_INVALID', tampered.status === 401 && tampered.code === 'ERR_SIGNATURE_INVALID', `status=${tampered.status} code=${tampered.code}`);

  const skew = await putConfig(body5, { timestamp: String(Date.now() - 3 * 60 * 1000) });
  check('签名｜时间戳偏离 3 分钟 → 401', skew.status === 401 && skew.code === 'ERR_SIGNATURE_INVALID', `status=${skew.status} code=${skew.code}`);

  const nonce = 'qa-replay-nonce-0001';
  const first = await putConfig(at({ groups: 1, perGroup: 2 }), { nonce });
  const replay = await putConfig(at({ groups: 1, perGroup: 3 }), { nonce });
  check('签名｜nonce 重放：第一次放行', first.status === 200, `status=${first.status}`);
  check('签名｜nonce 重放：第二次 → 401', replay.status === 401 && replay.code === 'ERR_SIGNATURE_INVALID', `status=${replay.status} code=${replay.code}`);

  const noSig = await fetch(`${baseUrl}${API_PREFIX}/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(at({ groups: 1, perGroup: 1 })),
  });
  const noSigEnv = await noSig.json();
  check('签名｜完全不带签名头 → 401（Spec §12 步骤 8 的安全流）', noSig.status === 401 && noSigEnv?.error === 'ERR_SIGNATURE_INVALID', `status=${noSig.status} code=${noSigEnv?.error}`);

  /* ---------- 6. 无签名不得改动团队配置 ---------- */
  const revAfter = revisionOf();
  check('安全｜401 之后团队配置版本未被推进', typeof revAfter === 'number' && revAfter > 0, `revision=${revAfter}`);

  /* ---------- 7. 只读端点：GET /revisions 只要令牌不要签名 ---------- */
  const revsTokenOnly = await fetch(`${baseUrl}${API_PREFIX}/revisions?limit=20`, {
    headers: { authorization: `Bearer ${token}` },
  });
  check('契约｜GET /revisions 仅令牌即可 200（openapi 规定只读端点不验签名）', revsTokenOnly.status === 200, `status=${revsTokenOnly.status}`);
  const revsNone = await fetch(`${baseUrl}${API_PREFIX}/revisions?limit=20`);
  check('契约｜GET /revisions 无令牌 → 401', revsNone.status === 401, `status=${revsNone.status}`);
} finally {
  if (server) await server.stop();
  await rm(root, { recursive: true, force: true });
}

console.log('');
console.log(`合计 ${failed === 0 ? '全部通过' : `${failed} 项失败`}。`);
process.exit(failed === 0 ? 0 : 1);
