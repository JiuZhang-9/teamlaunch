#!/usr/bin/env node
/**
 * 主进程接线验证：真起一次内嵌服务，验证 main 侧装配后拿到的是真实数据，
 * 而不是 serverPort 的保守回落。
 *
 * 为什么需要它：接线层若只在 Electron 里跑，出问题只能"看起来能起来"。
 * 这里用临时目录 + admin 角色，把 createServer → ServerPort → SyncServicePort
 * 整条链跑一遍，断言拿到的是真实快照而非 NEVER_SYNCED / null。
 *
 * 用法：node --experimental-transform-types scripts/verify-main-wiring.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createAdminSyncPort,
  createLocalServerPort,
  startEmbeddedService,
  stopEmbeddedService,
} from '../src/main/backendService.ts';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

const root = await mkdtemp(join(tmpdir(), 'tl-wiring-'));
try {
  // 1) 角色闸门：member 不起服务（默认安全值，这条不能反）
  const asMember = await startEmbeddedService(root, 'member');
  check('role=member 不起服务', asMember === false, `started=${asMember}`);

  // 2) admin 起服务
  const asAdmin = await startEmbeddedService(root, 'admin');
  check('role=admin 起服务', asAdmin === true, `started=${asAdmin}`);

  // 3) 管理员本机、还没发布内容：链路正常（ONLINE_LATEST），内容为空走正常空状态。
  //    架构 T3.6.2：服务端 404 是一次成功应答，禁止归成离线/同步失败。
  const sync = createAdminSyncPort();
  const snap = sync.snapshot();
  check(
    '未发布内容时：链路 ONLINE_LATEST 且不显示离线',
    snap.state === 'ONLINE_LATEST' && snap.offlineReason === null,
    `state=${snap.state} reason=${snap.offlineReason}`,
  );
  check(
    '未发布内容时：hasCache=false 且 config=null（走正常空状态）',
    snap.hasCache === false && snap.config === null,
    `hasCache=${snap.hasCache}`,
  );

  // 4) 巡检必须拿到真实结构（不是 serverPort 的 null 回落）
  const port = createLocalServerPort();
  const diag = await port.diagnostics();
  check('巡检返回真实快照（非 null）', diag !== null && diag.rows.length >= 8, `rows=${diag?.rows.length}`);
  check(
    '巡检含 K-02 交叉验证提示',
    JSON.stringify(diag?.rows ?? []).includes('第二台机器'),
    '',
  );

  // 5) 反馈：入队即确认，不再回落 PENDING
  const fb = await port.submitFeedback({
    items: [{ entryId: 'e-1', reasonCode: 'path_missing', occurredAt: new Date().toISOString() }],
  });
  check('反馈被服务端确认（SENT，非 PENDING 回落）', fb.status === 'SENT', `status=${fb.status}`);

  // 6) 口令校验：未设置口令时不得谎报通过
  const verified = await port.verifyAdmin('whatever');
  check('未设置口令时校验不通过', verified === false, `verified=${verified}`);

  await stopEmbeddedService();
  check('优雅关闭无异常', true);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`\n合计 ${failed === 0 ? '全部通过' : `${failed} 项失败`}。`);
process.exit(failed === 0 ? 0 : 1);
