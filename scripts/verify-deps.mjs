/**
 * 依赖锚定校验门（架构师所有物，不是业务代码）
 *
 * 存在理由是一起真实事故：`fastify` 被安装进 node_modules 但**从未写进 package.json**，
 * 后来有人跑 `npm install`，npm 把它当成多余包静默裁掉，内嵌服务当场跑不起来。
 * 这类故障的现象（服务起不来）与原因（依赖被 prune）隔着一层，靠 review 看不出来。
 *
 * 拦三件事：
 *   A. 孤儿依赖：src/ 里 import 了、但 package.json 没声明 —— fastify 事故本体
 *   B. 版本没写死：声明里出现 ^ ~ * latest 或区间 —— 违反 §1.1/§1.3 的锚定规则
 *   C. §1.1 锚定表里的依赖既没装也没登记延期 —— 防止"打包时才发现没装 electron-builder"
 *
 * 运行：npm run verify:deps
 * 退出码：0 通过，1 失败
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const problems = [];
const passes = [];
const fail = (m) => problems.push(m);
const ok = (m) => passes.push(m);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };

// ───────────────────────────────────────────────────────────────────────────
// A. 孤儿依赖：代码 import 了但 package.json 没声明
// ───────────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:^|\s)(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 从模块说明符取包名：`@fastify/swagger/x` → `@fastify/swagger`；`react-dom` → `react-dom` */
function packageNameOf(spec) {
  if (spec.startsWith('node:')) return null;
  if (spec.startsWith('.') || spec.startsWith('/') || path.isAbsolute(spec)) return null;
  const seg = spec.split('/');
  return spec.startsWith('@') ? seg.slice(0, 2).join('/') : seg[0];
}

const imported = new Map(); // pkg -> Set<file>
for (const file of [walk(path.join(ROOT, 'src')), walk(path.join(ROOT, 'scripts'))].flat()) {
  // 校验门自身只用内建模块与已声明的 js-yaml / zod，一并纳入检查
  const src = fs.readFileSync(file, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] ?? m[2] ?? m[3];
    const name = packageNameOf(spec);
    if (!name) continue;
    if (!imported.has(name)) imported.set(name, new Set());
    imported.get(name).add(path.relative(ROOT, file));
  }
}

const orphans = [...imported.keys()].filter((n) => !(n in declared));
if (orphans.length) {
  for (const o of orphans) {
    fail(`孤儿依赖：${o} 被 ${[...imported.get(o)].slice(0, 3).join(', ')} import，但 package.json 未声明 —— 下次 npm install 会被静默裁掉`);
  }
} else {
  ok(`无孤儿依赖（${imported.size} 个外部包全部已声明）`);
}

// ───────────────────────────────────────────────────────────────────────────
// B. 版本必须写死
// ───────────────────────────────────────────────────────────────────────────
const LOOSE = /[\^~*]|\s(?:-|>|<|=|\|\|)|^latest$|^\d+\.x$/;
/**
 * @types/* 与 eslint 插件生态普遍用区间，且它们不进产物、不参与运行时行为，
 * 允许保留区间。其余一律写死。
 */
const RANGE_OK = /^@types\//;
const loose = Object.entries(declared).filter(([n, v]) => !RANGE_OK.test(n) && LOOSE.test(String(v)));
if (loose.length) {
  for (const [n, v] of loose) fail(`版本未写死：${n} = "${v}"，§1.3 要求禁止 ^ / ~ / * / 区间`);
} else {
  ok(`全部依赖版本写死（${Object.keys(declared).length} 项，@types/* 除外）`);
}

// ───────────────────────────────────────────────────────────────────────────
// C. §1.1 锚定表的覆盖情况（未装的必须显式登记延期）
// ───────────────────────────────────────────────────────────────────────────
const DEFERRED = {
  // electron-builder 已随打包阶段落地（dist:win 依赖它），从登记表移除：
  // 登记表是"装了却没声明会出事"的备忘，装了还留着会把门禁自己变成噪音。
  'electron-vite': '三进程构建接入时',
  '@fastify/swagger': '由 schema 生成 openapi 时。注意：接入后**不得**直接覆盖 docs/api/openapi.yaml，应生成到临时文件再与本文件比对，校验门仍是唯一权威',
  '@electron-toolkit/utils': 'main/preload 接入时',
  '@electron-toolkit/typed-ipc': 'IPC 类型契约接入时',
  'node-html-parser': 'favicon 抓取实现时',
};

const arch = fs.readFileSync(path.join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8');
const section = arch.split(/^## 1\. 版本锚定/m)[1]?.split(/^## 2\./m)[0] ?? '';
const ROWPIN = /^\|\s*\**([a-zA-Z0-9@][a-zA-Z0-9@/._-]*)\**\s*\|\s*\**([0-9][0-9A-Za-z.\-+]*)\**/;
const anchored = [];
for (const line of section.split('\n')) {
  const m = ROWPIN.exec(line.trim());
  if (m) anchored.push([m[1], m[2]]);
}
if (anchored.length === 0) fail('未能从 ARCHITECTURE.md §1.1 解析出任何锚定行 —— 表格结构可能被改坏');

for (const [name, _v] of anchored) {
  if (name in declared) continue;
  if (name in DEFERRED) {
    ok(`${name} 未安装，已登记延期：${DEFERRED[name]}`);
  } else {
    fail(`${name} 在 §1.1 锚定表里，但既未声明也未登记延期 —— 补 package.json 或补 DEFERRED 说明`);
  }
}

// 反向：登记了延期却已经装上的，说明登记表过期了
for (const name of Object.keys(DEFERRED)) {
  if (name in declared) fail(`${name} 已声明，但仍在 DEFERRED 里 —— 登记表过期，请从 scripts/verify-deps.mjs 移除`);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('=== 依赖锚定校验 ===');
passes.forEach((p) => console.log('  [ok]    ' + p));
if (problems.length === 0) {
  console.log(`\nPASS: 0 problems，锚定表 ${anchored.length} 项`);
  process.exit(0);
}
console.log(`\nFAIL: ${problems.length} problems`);
problems.forEach((p) => console.log('  [FAIL]  ' + p));
process.exit(1);
