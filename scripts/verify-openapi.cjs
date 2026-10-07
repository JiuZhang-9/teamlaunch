/**
 * openapi.yaml 契约校验门（架构师所有物，不是业务代码）
 *
 * 作用：在 CI 与本地提交前强制校验 docs/api/openapi.yaml：
 *   1. YAML 可解析（含重复键检测）
 *   2. 所有内部 $ref 可解析（JSON Pointer 逐段落位）
 *   3. 每个操作具备 operationId / tags / summary / 完整 responses
 *      POST、PUT 必须具备 required:true 的 requestBody
 *   4. operationId 全局唯一
 *   5. discriminator.mapping 的指向必须存在
 *   6. components 下的 schema / parameter / header / response 不得有孤儿定义
 *   7. 端点清单必须与 Spec §5 的 13 个端点逐一对应
 *
 * 运行：
 *   npm i -D js-yaml@4.1.0
 *   node scripts/verify-openapi.cjs
 * 退出码：0 通过，1 失败（CI 直接红灯）
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'docs', 'api', 'openapi.yaml');

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

// ---------------------------------------------------------------------------
// Spec §5 端点清单（唯一依据）。改动这里等于改契约，必须先改 Spec。
// ---------------------------------------------------------------------------
const SPEC_OPERATIONS = [
  ['get', '/health'],
  ['get', '/config'],
  ['get', '/changes'],
  ['get', '/assets/{hash}'],
  ['post', '/auth/challenge'],
  ['post', '/auth/verify'],
  ['put', '/config'],
  ['get', '/revisions'],
  ['post', '/revisions/{revision}/restore'],
  ['post', '/feedback'],
  ['get', '/feedback/summary'],
  ['post', '/telemetry'],
  ['get', '/diagnostics'],
];

// ---------------------------------------------------------------------------
// 1. 解析
// ---------------------------------------------------------------------------
const raw = fs.readFileSync(SPEC_PATH, 'utf8');
let doc;
try {
  doc = yaml.load(raw, {
    filename: SPEC_PATH,
    // 重复键 = 契约里最阴险的一类错误：后写覆盖先写且不报错
    onWarning: (w) => fail(`YAML 警告: ${w.message}`),
    schema: yaml.DEFAULT_SCHEMA,
  });
} catch (e) {
  console.error('YAML 解析失败:', e.message);
  process.exit(1);
}
if (!doc || typeof doc !== 'object') {
  console.error('YAML 顶层不是对象');
  process.exit(1);
}
notes.push(`YAML 可解析，${raw.split('\n').length} 行`);

// ---------------------------------------------------------------------------
// 2. $ref 解析
// ---------------------------------------------------------------------------
function resolvePointer(pointer) {
  if (!pointer.startsWith('#/')) return undefined;
  const segments = pointer.slice(2).split('/');
  let node = doc;
  for (const rawSeg of segments) {
    const seg = rawSeg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !(seg in node)) return undefined;
    node = node[seg];
  }
  return node;
}

const refs = new Set();
function collectRefs(node, at) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectRefs(v, `${at}/${i}`));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      refs.add(v);
      if (!v.startsWith('#/')) fail(`出现非内部引用（暂不支持外部文件引用）: ${v} @ ${at}`);
      else if (resolvePointer(v) === undefined) fail(`$ref 无法解析: ${v} @ ${at}`);
    } else {
      collectRefs(v, `${at}/${k}`);
    }
  }
}
collectRefs(doc, '#');
notes.push(`共发现 ${refs.size} 个内部 $ref，全部可解析`);

// ---------------------------------------------------------------------------
// 3. 操作完整性
// ---------------------------------------------------------------------------
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const BODYLESS = new Set(['204', '304']);

const foundOperations = [];
const operationIds = new Map();
const usedSchemas = new Set();
const usedParameters = new Set();
const usedHeaders = new Set();
const usedResponses = new Set();

const BUCKETS = [
  ['#/components/schemas/', usedSchemas],
  ['#/components/parameters/', usedParameters],
  ['#/components/headers/', usedHeaders],
  ['#/components/responses/', usedResponses],
];

// 必须是传递闭包：TeamConfig -> Group -> Entry -> AppEntry 这类嵌套引用，
// 只扫操作节点会把中间层全部误报成孤儿。
const visitedTargets = new Set();
function markUsedRefs(node) {
  if (Array.isArray(node)) return node.forEach(markUsedRefs);
  if (node === null || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      for (const [prefix, bucket] of BUCKETS) {
        if (v.startsWith(prefix)) bucket.add(v.slice(prefix.length));
      }
      // 继续走进被引用的目标，把嵌套引用一并登记
      if (!visitedTargets.has(v)) {
        visitedTargets.add(v);
        markUsedRefs(resolvePointer(v));
      }
    } else markUsedRefs(v);
  }
}

const paths = doc.paths || {};
if (Object.keys(paths).length === 0) fail('paths 为空');

for (const [p, item] of Object.entries(paths)) {
  if (!p.startsWith('/')) fail(`path 必须以 / 开头: ${p}`);
  // path 级参数（本契约未用，但出现时必须合法）
  if (item.parameters) {
    item.parameters.forEach((prm) => {
      if (!prm.name) fail(`${p} 的路径级参数缺少 name`);
      if (!prm.in) fail(`${p} 的路径级参数缺少 in`);
    });
  }
  for (const [method, op] of Object.entries(item)) {
    if (!HTTP_METHODS.includes(method)) continue;
    const at = `${method.toUpperCase()} ${p}`;
    foundOperations.push([method, p]);
    markUsedRefs(op);

    if (!op.operationId) fail(`${at} 缺少 operationId`);
    else {
      if (operationIds.has(op.operationId)) {
        fail(`operationId 重复: ${op.operationId}（${at} 与 ${operationIds.get(op.operationId)}）`);
      }
      operationIds.set(op.operationId, at);
    }
    if (!Array.isArray(op.tags) || op.tags.length === 0) fail(`${at} 缺少 tags`);
    else {
      const defined = new Set((doc.tags || []).map((t) => t.name));
      op.tags.forEach((t) => {
        if (!defined.has(t)) fail(`${at} 使用了未声明的 tag: ${t}`);
      });
    }
    if (!op.summary) fail(`${at} 缺少 summary`);

    // 写操作必须有请求体
    if (['post', 'put', 'patch'].includes(method)) {
      const rb = op.requestBody;
      if (!rb) fail(`${at} 缺少 requestBody`);
      else {
        if (rb.required !== true) fail(`${at} 的 requestBody.required 必须为 true`);
        const ct = rb.content || {};
        if (!ct['application/json']) fail(`${at} 缺少 application/json 请求体`);
        else if (!ct['application/json'].schema) fail(`${at} 的请求体缺少 schema`);
      }
    }

    // 响应完整性
    const responses = op.responses;
    if (!responses || Object.keys(responses).length === 0) fail(`${at} 缺少 responses`);
    else {
      if (!responses['200'] && !responses['201']) fail(`${at} 缺少 2xx 成功响应`);
      if (!responses['500']) fail(`${at} 缺少 500 响应（ERR_INTERNAL + diagnosticId）`);
      for (const [code, resp] of Object.entries(responses)) {
        if (!/^[1-5][0-9]{2}$/.test(code)) fail(`${at} 响应码非法: ${code}`);
        const isRef = typeof resp.$ref === 'string';
        const target = isRef ? resolvePointer(resp.$ref) : resp;
        if (!target || typeof target !== 'object') {
          fail(`${at} ${code} 响应定义无法解析`);
          continue;
        }
        if (!target.description) fail(`${at} ${code} 缺少 description`);
        if (BODYLESS.has(code)) continue;
        const content = target.content;
        if (!content || Object.keys(content).length === 0) {
          fail(`${at} ${code} 缺少响应体 content`);
        } else {
          for (const [mime, m] of Object.entries(content)) {
            if (mime === 'application/json' && !m.schema) {
              fail(`${at} ${code} 的 application/json 缺少 schema`);
            }
            if (!m.schema && !m.example) fail(`${at} ${code} 的 ${mime} 缺少 schema`);
          }
        }
      }
    }

    // 参数合法性
    (op.parameters || []).forEach((prm) => {
      const resolved = prm.$ref ? resolvePointer(prm.$ref) : prm;
      if (!resolved) return fail(`${at} 的参数引用无法解析`);
      if (!resolved.name) fail(`${at} 参数缺少 name`);
      if (!resolved.in) fail(`${at} 参数缺少 in`);
      if (!prm.$ref && !resolved.schema) fail(`${at} 参数 ${resolved.name} 缺少 schema`);
    });
  }
}

// ---------------------------------------------------------------------------
// 4. 与 Spec §5 对齐
// ---------------------------------------------------------------------------
const norm = (l) => l.map(([m, p]) => `${m} ${p}`).sort();
const specSet = norm(SPEC_OPERATIONS);
const implSet = norm(foundOperations);
for (const s of specSet) if (!implSet.includes(s)) fail(`Spec §5 端点在 openapi.yaml 中缺失: ${s}`);
for (const s of implSet) if (!specSet.includes(s)) fail(`openapi.yaml 中存在 Spec §5 未定义的端点: ${s}`);
notes.push(`端点数：Spec §5 = ${specSet.length}，openapi.yaml = ${implSet.length}`);

// ---------------------------------------------------------------------------
// 5. discriminator 指向
// ---------------------------------------------------------------------------
const schemas = (doc.components && doc.components.schemas) || {};
for (const [name, s] of Object.entries(schemas)) {
  const disc = s.discriminator;
  if (!disc) continue;
  if (!disc.propertyName) fail(`schema ${name} 的 discriminator 缺少 propertyName`);
  for (const [key, target] of Object.entries(disc.mapping || {})) {
    if (resolvePointer(target) === undefined) {
      fail(`schema ${name} 的 discriminator.mapping[${key}] 指向不存在: ${target}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. 孤儿定义
// ---------------------------------------------------------------------------
const orphan = (bucket, used) =>
  Object.keys((doc.components && doc.components[bucket]) || {}).filter((n) => !used.has(n));
orphan('schemas', usedSchemas).forEach((n) => fail(`schema 定义未被任何端点引用（孤儿）: ${n}`));
orphan('parameters', usedParameters).forEach((n) => fail(`parameter 定义未被引用（孤儿）: ${n}`));
orphan('headers', usedHeaders).forEach((n) => fail(`header 定义未被引用（孤儿）: ${n}`));
orphan('responses', usedResponses).forEach((n) => fail(`response 定义未被引用（孤儿）: ${n}`));

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
console.log('=== openapi.yaml 契约校验 ===');
console.log(`文件: ${path.relative(ROOT, SPEC_PATH)}`);
notes.forEach((n) => console.log('  [ok]    ' + n));
if (problems.length === 0) {
  console.log(`\nPASS: 0 problems, ${implSet.length} operations, ${Object.keys(schemas).length} schemas`);
  process.exit(0);
}
console.log(`\nFAIL: ${problems.length} problems`);
problems.forEach((p) => console.log('  [FAIL]  ' + p));
process.exit(1);
