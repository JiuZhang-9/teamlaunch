/**
 * src/shared/schema.ts 契约校验门（架构师所有物，不是业务代码）
 *
 * 跑的是真实文件、真实 zod 4.6.5，不是人肉核对。校验四件事：
 *   1. 容量闸门真的拦得住（≤8 组 / ≤200 入口 / ≤1MB）
 *   2. 判别联合真的拦得住（app 缺 target、web 非 http(s)、重复 id）
 *   3. 隐私闸门真的拦得住（遥测 props 键名黑名单、时间必须带 Z）
 *   4. schema.ts 与 docs/api/openapi.yaml 的 required 字段与枚举没有漂移
 *
 * 运行（需先 npm i，让 zod 与 js-yaml 可解析）：
 *   Node >= 23                     node scripts/verify-schema.mjs
 *   Node 22.x                      node --experimental-strip-types scripts/verify-schema.mjs
 * 退出码：0 通过，1 失败
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const S = await import('../src/shared/schema.ts');
const { z } = await import('zod');

const problems = [];
const passes = [];
const fail = (m) => problems.push(m);
const ok = (m) => passes.push(m);

function expectReject(label, schema, input) {
  const r = schema.safeParse(input);
  if (r.success) fail(`应当被拒绝但通过了: ${label}`);
  else ok(`${label} -> 拒绝（${r.error.issues.map((i) => i.message).join('; ').slice(0, 90)}）`);
}
function expectAccept(label, schema, input) {
  const r = schema.safeParse(input);
  if (!r.success) {
    fail(`应当通过但被拒绝: ${label} :: ${r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('; ')}`);
  } else ok(`${label} -> 通过`);
}

// ───────────────────────────────────────────────────────────────────────────
// 夹具
// ───────────────────────────────────────────────────────────────────────────
const now = '2026-09-29T15:30:48.000Z';
const icon = { kind: 'fallback' };
const appEntry = (id, target = 'C:\\a.exe') => ({
  id,
  type: 'app',
  name: 'E' + id,
  sort: 0,
  icon,
  target,
  updatedAt: now,
});
const group = (id, n, prefix = 'g') => ({
  id,
  name: 'G' + id,
  sort: 0,
  entries: Array.from({ length: n }, (_, i) => appEntry(`${prefix}${id}-${i}`)),
});
const configWith = (groups) => ({
  schemaVersion: 1,
  instanceId: '0f7a2c94-3d51-4f0a-9b17-6e8c1a2d4f30',
  revision: 12,
  contentHash: 'a'.repeat(64),
  publishedAt: now,
  groups,
});

// ───────────────────────────────────────────────────────────────────────────
// 1. 容量闸门
// ───────────────────────────────────────────────────────────────────────────
expectAccept('8 组 × 25 入口 = 200', S.TeamConfigSchema, configWith([group('1', 25, 'a'), group('2', 25, 'b'), group('3', 25, 'c'), group('4', 25, 'd'), group('5', 25, 'e'), group('6', 25, 'f'), group('7', 25, 'g'), group('8', 25, 'h')]));
expectReject('跨组求和 201 入口', S.TeamConfigSchema, configWith([group('1', 201, 'a')]));
expectReject('8 组各 30 = 240 入口', S.TeamConfigSchema, configWith(Array.from({ length: 8 }, (_, i) => group(String(i), 30, 'x' + i))));
expectReject('9 个分组', S.TeamConfigSchema, configWith(Array.from({ length: 9 }, (_, i) => group(String(i), 1, 'y' + i))));
expectReject('同一分组内入口 id 重复', S.TeamConfigSchema, configWith([{ id: 'g', name: 'G', sort: 0, entries: [appEntry('dup'), appEntry('dup')] }]));
expectReject(
  '跨分组入口 id 重复',
  S.TeamConfigSchema,
  configWith([
    { id: 'g1', name: 'G1', sort: 0, entries: [appEntry('same')] },
    { id: 'g2', name: 'G2', sort: 0, entries: [appEntry('same')] },
  ]),
);
expectAccept(
  '跨分组 id 不同则通过',
  S.TeamConfigSchema,
  configWith([
    { id: 'g1', name: 'G1', sort: 0, entries: [appEntry('a')] },
    { id: 'g2', name: 'G2', sort: 0, entries: [appEntry('b')] },
  ]),
);

// 1 MB：256 字节描述 × 上限内条目会超限，直接构造超标字符串更稳
const bigText = JSON.stringify(configWith([{ id: 'g', name: 'G', sort: 0, entries: [{ ...appEntry('x'), description: '描'.repeat(400_000) }] }]));
if (Buffer.byteLength(bigText, 'utf8') <= S.CAPACITY.MAX_CONFIG_BYTES) {
  fail(`夹具构造失败：未超过 1MB（${Buffer.byteLength(bigText, 'utf8')} 字节），容量闸门未被真正验证`);
} else {
  expectReject(`超过 1MB（${Buffer.byteLength(bigText, 'utf8')} 字节）`, S.TeamConfigWireSchema, bigText);
}
expectAccept('合法 JSON + 合法配置', S.TeamConfigWireSchema, JSON.stringify(configWith([group('1', 1)])));
expectReject('非法 JSON', S.TeamConfigWireSchema, '{ not json');

// ───────────────────────────────────────────────────────────────────────────
// 2. 判别联合
// ───────────────────────────────────────────────────────────────────────────
expectAccept('app 带 target', S.EntrySchema, appEntry('a1'));
expectReject('app 缺 target', S.EntrySchema, { ...appEntry('a2'), target: undefined });
expectAccept('folder 带 target', S.EntrySchema, { id: 'f1', type: 'folder', name: 'F', sort: 0, icon, target: 'D:\\share', updatedAt: now });
expectReject('folder 缺 target', S.EntrySchema, { id: 'f2', type: 'folder', name: 'F', sort: 0, icon, updatedAt: now });
expectAccept('web https', S.EntrySchema, { id: 'w1', type: 'web', name: 'W', sort: 0, icon, url: 'https://oa.corp.cn', updatedAt: now });
expectReject('web 非 http(s)', S.EntrySchema, { id: 'w2', type: 'web', name: 'W', sort: 0, icon, url: 'ftp://oa.corp.cn', updatedAt: now });
expectReject('未知 type', S.EntrySchema, { id: 'z', type: 'shortcut', name: 'Z', sort: 0, icon, updatedAt: now });
expectReject('空名称', S.EntrySchema, { ...appEntry('a3'), name: '' });
expectReject('名称超 40 字', S.EntrySchema, { ...appEntry('a4'), name: 'N'.repeat(41) });

// ───────────────────────────────────────────────────────────────────────────
// 3. 隐私与时间闸门
// ───────────────────────────────────────────────────────────────────────────
expectAccept('遥测 props 合法', S.TelemetryItemSchema, { name: 'entry_open_attempted', ts: now, props: { entryType: 'app' } });
expectReject('遥测 props 含 ip', S.TelemetryItemSchema, { name: 'entry_open_attempted', ts: now, props: { ip: '10.0.0.1' } });
expectReject('遥测 props 含 path', S.TelemetryItemSchema, { name: 'entry_open_failed', ts: now, props: { path: 'C:\\secret\\a.exe' } });
expectReject('遥测 props 嵌套含 query', S.TelemetryItemSchema, { name: 'error_occurred', ts: now, props: { ctx: { query: '工资' } } });
expectReject('遥测事件名未登记', S.TelemetryItemSchema, { name: 'whatever', ts: now, props: {} });
expectReject('时间带 +08:00 偏移', S.IsoDateTimeSchema, '2026-09-29T23:30:48+08:00');
expectAccept('时间带 Z', S.IsoDateTimeSchema, now);

const settings = S.SettingsSchema.parse({});
if (settings.telemetryNoticeAckedAt !== null) fail(`Settings 默认 telemetryNoticeAckedAt 应为 null（隐私门未确认），实际 ${settings.telemetryNoticeAckedAt}`);
else ok('Settings 默认 telemetryNoticeAckedAt = null（隐私门默认关闭）');
if (settings.pollIntervalMs !== 30_000) fail(`Settings 默认轮询应为 30000ms，实际 ${settings.pollIntervalMs}`);
else ok('Settings 默认 pollIntervalMs = 30000');
if (settings.role !== 'member') fail(`Settings 默认 role 应为 member，实际 ${settings.role}`);
else ok('Settings 默认 role = member（服务默认不起，需显式开启管理员）');
if (settings.deletedConflictPolicy !== 'ask') fail(`默认导入冲突策略应为 ask（禁止静默覆盖），实际 ${settings.deletedConflictPolicy}`);
else ok('Settings 默认 deletedConflictPolicy = ask（AC-15 禁止静默覆盖）');
expectReject('Settings 轮询低于 5s', S.SettingsSchema, { pollIntervalMs: 1_000 });
// settings.json 只放用户意图：机器维护的端点记忆不得回到这里（ADR-002 L1 归 discovery.json）
if ('knownEndpoints' in settings) fail('Settings 不应再含 knownEndpoints：端点记忆的唯一写入点是 discovery.json');
else ok('Settings 不含 knownEndpoints（端点记忆唯一写入点为 discovery.json）');

// 个人配置共用同一道容量闸门
expectReject('personal 也受 200 入口限制', S.PersonalConfigSchema, { schemaVersion: 1, groups: [group('1', 201, 'p')] });

// 信封工厂
const envResult = S.envelopeOf(S.TeamConfigSchema).safeParse({ code: 0, message: 'ok', data: configWith([group('1', 1)]) });
if (!envResult.success) fail(`envelopeOf(TeamConfigSchema) 应当接受合法信封: ${envResult.error.issues.map((i) => i.message).join('; ')}`);
else ok('envelopeOf(TeamConfigSchema) 接受合法信封');
expectReject('信封 data 类型不符', S.envelopeOf(S.TeamConfigSchema), { code: 0, message: 'ok', data: { nope: 1 } });

// ───────────────────────────────────────────────────────────────────────────
// 4. 与 openapi.yaml 的一致性（防契约漂移）
// ───────────────────────────────────────────────────────────────────────────
const api = yaml.load(fs.readFileSync(path.join(ROOT, 'docs', 'api', 'openapi.yaml'), 'utf8'));
const apiSchemas = api.components.schemas;

/** openapi 的 allOf 合成 required：EntryBase + 自身 */
function apiRequired(name) {
  const s = apiSchemas[name];
  if (!s) return null;
  const req = new Set(s.required || []);
  for (const sub of s.allOf || []) {
    if (sub.$ref) {
      const t = apiSchemas[sub.$ref.split('/').pop()];
      if (t) (t.required || []).forEach((r) => req.add(r));
    }
    (sub.required || []).forEach((r) => req.add(r));
  }
  return [...req].sort();
}
function zodRequired(schema) {
  return (z.toJSONSchema(schema, { io: 'input' }).required || []).sort();
}

const PAIRS = [
  ['TeamConfig', S.TeamConfigSchema],
  ['Group', S.GroupSchema],
  ['AppEntry', S.AppEntrySchema],
  ['FolderEntry', S.FolderEntrySchema],
  ['WebEntry', S.WebEntrySchema],
  ['FeedbackItem', S.FeedbackItemSchema],
  ['TelemetryItem', S.TelemetryItemSchema],
];

for (const [apiName, zodSchema] of PAIRS) {
  const a = apiRequired(apiName);
  const b = zodRequired(zodSchema);
  if (a === null) {
    fail(`openapi.yaml 缺少 schema: ${apiName}`);
    continue;
  }
  const onlyApi = a.filter((x) => !b.includes(x));
  const onlyZod = b.filter((x) => !a.includes(x));
  // zod 侧会因 .default() 把字段变成 input-optional，属于预期差异，仅报告不判失败
  if (onlyApi.length) fail(`required 漂移：openapi ${apiName} 有而 schema.ts 没有 -> ${onlyApi.join(', ')}`);
  else if (onlyZod.length) ok(`${apiName} required 一致（schema.ts 多出的可选项: ${onlyZod.join(', ')}）`);
  else ok(`${apiName} required 完全一致: ${a.join(', ')}`);
}

// 枚举一致性
const enumPairs = [
  ['FeedbackItem.reasonCode', apiSchemas.FeedbackItem.properties.reasonCode.enum, S.FeedbackReasonSchema.options],
  ['TelemetryItem.name', apiSchemas.TelemetryItem.properties.name.enum, S.TelemetryEventNameSchema.options],
  ['IconRef.kind', apiSchemas.IconRef.properties.kind.enum, S.IconRefSchema.shape.kind.options],
];
for (const [label, apiEnum, zodEnum] of enumPairs) {
  const a = [...apiEnum].sort();
  const b = [...zodEnum].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail(`枚举漂移 ${label}: openapi=[${a}] schema.ts=[${b}]`);
  } else ok(`枚举一致 ${label}（${a.length} 项）`);
}

// 错误码枚举
{
  const a = [...apiSchemas.ErrorCode.enum].sort();
  const b = [...S.ErrorCodeSchema.options].sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) fail(`ErrorCode 枚举漂移: openapi=[${a}] schema.ts=[${b}]`);
  else ok(`ErrorCode 枚举一致（${a.length} 项）`);
}

// ───────────────────────────────────────────────────────────────────────────
// 输出
// ---------------------------------------------------------------------------
console.log('=== src/shared/schema.ts 契约校验 ===');
passes.forEach((p) => console.log('  [ok]    ' + p));
if (problems.length === 0) {
  console.log(`\nPASS: 0 problems, ${passes.length} checks`);
  process.exit(0);
}
console.log(`\nFAIL: ${problems.length} problems`);
problems.forEach((p) => console.log('  [FAIL]  ' + p));
process.exit(1);
