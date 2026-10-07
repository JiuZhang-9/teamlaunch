#!/usr/bin/env node
/**
 * QA 独立验证 ②：主进程端口契约（preload 实际发出的载荷形状 → 服务端）
 *
 * 为什么要这道门：`ipcMain.handle('tl:publish', (_e, req) => serverPort.publish(req as never))`
 * 里的 `as never` 把整条链路的**类型检查关掉了**。于是"preload 只发 `{summary}`、
 * 而 `PublishRequest` 要 `{baseRevision, summary, config}`"这种错，tsc 不报、
 * eslint 不报、构建照过——只有真跑一次才会发现它每次都失败。
 *
 * 手法：**同一个服务端，喂两种载荷形状做差分**。
 *   A. preload 实际发出的形状（照抄 src/preload/index.ts，不加工）
 *   B. 契约要求的完整形状
 * A 过不了而 B 过得了 → 缺陷被精确定位在"载荷形状"，而不是"服务端坏了"或"环境不通"。
 *
 * 另外三条是 QA 独立加的边界，不在开发者的 42 项里：
 *   C1. **从空状态首次发布**（Spec §12 步骤 3 的真实场景：管理员第一次发布）
 *   C2. **容量闸在管理员本机路径上是否也在**（Spec §10「服务端强制」）
 *   C3. 超容量若真被写盘，员工端三重闸门会不会**永久拒绝**这份配置
 *
 * 用法：npm run verify:qa-port
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

import {
  bypassLanProxy,
  createLocalServerPort,
  currentListenPort,
  startEmbeddedService,
  stopEmbeddedService,
} from '../src/main/backendService.ts';
import { validateBody } from '../src/main/configGate.ts';
import { SCHEMA_VERSION } from '../src/shared/schema/common.ts';

bypassLanProxy();

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};
const note = (s) => console.log(`       └ ${s}`);

const root = await mkdtemp(join(tmpdir(), 'tl-qa-port-'));

const entry = (id, name) => ({
  id,
  name,
  sort: 0,
  icon: { kind: 'fallback' },
  updatedAt: new Date().toISOString(),
  type: 'folder',
  target: 'D:\\共享\\2026 归档',
});
const bodyOf = (instanceId, count = 1) => ({
  schemaVersion: SCHEMA_VERSION,
  instanceId,
  groups: [
    {
      id: 'g-1',
      name: '日常办公',
      sort: 0,
      entries: Array.from({ length: count }, (_, k) => entry(`e-${k}`, `入口${k}`)),
    },
  ],
});
const requestOf = (instanceId, baseRevision, count, summary) => ({
  baseRevision,
  summary,
  config: bodyOf(instanceId, count),
});

/** 从巡检里读当前版本（管理员本机路径看不到 ctx，只能这样取真值）。 */
async function currentRevision(port) {
  const snap = await port.diagnostics();
  const row = snap?.rows.find((r) => r.key === '团队数据版本');
  return row ? Number.parseInt(row.value.replace(/^v/, ''), 10) : 0;
}

try {
  await startEmbeddedService(root, 'admin');
  const identity = JSON.parse(await readFile(join(root, 'service.json'), 'utf8'));
  const instanceId = identity.instanceId;
  const port = createLocalServerPort();

  console.log('QA 独立验证 ②：主进程端口契约（发布载荷 + 首次发布 + 本机盖戳 + 容量闸）');
  console.log('');

  /* ============ A. preload 实际发出的形状 ============ */
  // preload 现在与契约同形：{ summary, config, baseRevision }（草稿由 editStore 整体上送）。
  // 本脚本照抄 src/preload/index.ts 的载荷形状，不加工——再出现"载荷形状漂移"这里先红。
  const a = await port.publish(requestOf(instanceId, 0, 1, '把归档入口发布给团队'));
  check(
    'A｜preload 实际载荷 { summary, config, baseRevision } 从空状态首次发布 → 成功',
    a.ok === true,
    `ok=${a.ok}${a.ok ? ` revision=${a.revision}` : ` error=${a.error}`}`,
  );
  if (!a.ok) {
    note('载荷形状又漂移了：对照 src/preload/index.ts 的 publish.put 与 PublishRequest 契约。');
  }

  const rev1 = await currentRevision(port);
  check('A｜revision 从 0 递增到 1', rev1 === 1, `revision=${rev1}`);
  check('A｜changedCount = 1（新增 1 条）', a.ok && a.changedCount === 1, `changedCount=${a.ok ? a.changedCount : '-'}`);

  /* ============ B. 非空状态下的第二次发布 ============ */
  const b2 = await port.publish(requestOf(instanceId, rev1, 2, '第二次发布：加一条'));
  check('B｜已有内容再发布 → 成功', b2.ok === true, `ok=${b2.ok}${b2.ok ? ` revision=${b2.revision}` : ` error=${b2.error}`}`);

  /* ============ D. 错误码映射不能全塌成 NETWORK_UNREACHABLE ============ */
  const rev2 = await currentRevision(port);
  const d1 = await port.publish(requestOf(instanceId, 999, 1, '落后版本'));
  check('D1｜baseRevision 落后 → REVISION_CONFLICT', d1.ok === false && d1.error === 'REVISION_CONFLICT', `error=${d1.ok ? '-' : d1.error}`);

  const d2 = await port.publish({
    baseRevision: rev2,
    summary: '连错数据源',
    config: bodyOf('00000000-0000-4000-8000-000000000000', 1),
  });
  check(
    'D2｜外来源 instanceId → 本机端口盖戳后按本机身份发布成功',
    d2.ok === true,
    `ok=${d2.ok}${d2.ok ? ` revision=${d2.revision}` : ` error=${d2.error}`}`,
  );
  if (!d2.ok) {
    note('本机端口是同进程权威源：instanceId 由端口盖戳（渲染层草稿不可能预知服务身份）。');
    note('跨机"连错数据源"的拒绝在 HTTP 侧（签名 + PublishService 的 instanceId 校验），不在本机端口。');
  }

  /* 失败路径绝不落盘：再造一次校验失败（schemaVersion 非法），断言 revision 不动。 */
  const revAfterFails = await currentRevision(port);
  await port.publish({ baseRevision: revAfterFails, summary: '坏数据', config: { schemaVersion: 999, instanceId, groups: [] } });
  const revAfterBad = await currentRevision(port);
  check(
    'D3｜报失败的发布不得落盘（界面说谎检测）',
    revAfterBad === revAfterFails,
    `rev ${revAfterFails} → ${revAfterBad}`,
  );

  /* D4：首跑草稿的真实形状（instanceId 空串）→ 本机盖戳后发布成功。
     曾在这里翻车：先校验后盖戳，空串永远过不了 uuid 校验 → 发布必报 VALIDATION_FAILED。 */
  const d4 = await port.publish({
    baseRevision: revAfterBad,
    summary: '首跑草稿（空 instanceId）',
    config: { schemaVersion: SCHEMA_VERSION, instanceId: '', groups: bodyOf(instanceId, 1).groups },
  });
  check(
    'D4｜instanceId 空串的草稿（渲染层真实形状）→ 盖戳后发布成功',
    d4.ok === true,
    `ok=${d4.ok}${d4.ok ? ` revision=${d4.revision}` : ` error=${d4.error}`}`,
  );

  /* ============ E. 容量闸：管理员本机路径上是否也在（Spec §10「服务端强制」） ============ */
  const rev3 = await currentRevision(port);
  const e1 = await port.publish(requestOf(instanceId, rev3, 201, '超 200 入口'));
  check(
    'E1｜201 条入口经管理员本机路径发布 → 必须被容量闸拦下（413 / PAYLOAD_TOO_LARGE）',
    e1.ok === false && e1.error === 'PAYLOAD_TOO_LARGE',
    `ok=${e1.ok}${e1.ok ? ` revision=${e1.revision}（竟然发布成功了）` : ` error=${e1.error}`}`,
  );
  if (e1.ok) {
    note('checkCapacity 只挂在 HTTP 路由（config.controller），管理员本机路径 createLocalServerPort');
    note('直连 PublishService，整道闸被跳过 —— Spec §10「服务端强制」在本机路径上不成立。');
  }

  /* ============ F. 若真写盘了，员工端会不会永久拒绝这份配置 ============ */
  const disk = JSON.parse(await readFile(join(root, 'cache', 'team-current.json'), 'utf8'));
  const onDisk = disk.groups.reduce((n, g) => n + g.entries.length, 0);
  check(
    'F1｜落盘的团队配置入口数 ≤ 200（否则员工端三重闸门会永久拒绝）',
    onDisk <= 200,
    `磁盘上 ${onDisk} 条`,
  );
  const gate = validateBody(JSON.stringify(disk));
  check(
    'F2｜员工端三重闸门对落盘配置的判定 = 通过',
    gate.config !== null,
    gate.config === null ? `被拒：${gate.why}` : 'ok',
  );
  if (gate.config === null) {
    note('管理员界面显示"发布成功"，但员工端每一次拉取都会被 schema 闸拒 → SYNC_DATA_REJECTED，');
    note('且旧缓存保留、永不更新。管理员无从察觉，员工只看到"数据被拒绝"。');
  }

  /* ============ G. HTTP 侧对照：同样 201 条走 PUT /config 必须被拦 ============ */
  // 连局域网地址而不是 127.0.0.1：本机 17890 段可能被别的软件占着（开发机实测被 Clash 占），
  // 连 127.0.0.1 会打到对方进程、拿回一个不相干的应答（scripts/verify-sync-client.mjs 同款坑）。
  const httpPort = currentListenPort();
  if (httpPort !== null) {
    const host = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n !== undefined && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address)
      .find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip));
    try {
      const res = await fetch(`http://${host ?? '127.0.0.1'}:${httpPort}/api/v1/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestOf(instanceId, await currentRevision(port), 201, 'HTTP 侧超容量')),
      });
      const envelope = await res.json();
      check(
        'G｜同样 201 条走 HTTP PUT /config → 401（签名闸在 HTTP 侧生效；无签名不得放行）',
        res.status === 401 || res.status === 413,
        `status=${res.status} code=${envelope?.error?.code ?? '-'}`,
      );
    } catch (err) {
      console.log(`  SKIP  G｜HTTP 侧对照未能发起（${err.code ?? err.message}）——不计入通过，也不计入失败`);
    }
  }

  /* ============ H. 反馈端口：入队即确认，绝不谎报 ============ */
  const fb = await port.submitFeedback({
    items: [{ entryId: 'e-0', reasonCode: 'path_missing', occurredAt: new Date().toISOString() }],
  });
  check('H｜反馈被真实接收（SENT）', fb.status === 'SENT', `status=${fb.status}`);
  check('I｜未设置口令时 verifyAdmin 为 false', (await port.verifyAdmin('anything')) === false);
} finally {
  await stopEmbeddedService();
  await rm(root, { recursive: true, force: true });
}

console.log('');
console.log(`合计 ${failed === 0 ? '全部通过' : `${failed} 项失败`}。`);
process.exit(failed === 0 ? 0 : 1);
