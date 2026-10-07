/**
 * scripts/guard-server.mjs —— 后端硬约束守卫（架构 §3.2 的三条命令合一）
 *
 *   1. src/server/** 与 src/discovery/** 不得 import 'electron'（迁移可行性）
 *   2. src/server|services|repositories|discovery|platform 不得出现 *Sync IO（K-05）
 *   3. 单文件 ≤ 300 行；入口（app.ts）< 120 行；入口不含业务逻辑关键词
 *
 * 这些约束本来是三条 bash 命令，但 Windows 上没有 grep/xargs，
 * 且"入口不得含业务"靠 wc -l 看不出来，因此收成一个可复跑的脚本。
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SERVER_DIRS = ['src/server', 'src/discovery'];
const NODE_SIDE_DIRS = ['src/server', 'src/discovery', 'src/services', 'src/repositories', 'src/platform'];
const MAX_FILE_LINES = 300;
const MAX_ENTRY_LINES = 120;

const violations = [];

/**
 * 注释里的示例代码不该被当成真实依赖：文档里写"不要 import 'electron'"本身
 * 就会被正则命中。因此判定前先剥掉注释（块注释 + 行注释）。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

async function listTs(dir) {
  const out = [];
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listTs(rel)));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

const serverFiles = [];
for (const dir of SERVER_DIRS) serverFiles.push(...(await listTs(dir)));

const nodeSideFiles = [];
for (const dir of NODE_SIDE_DIRS) nodeSideFiles.push(...(await listTs(dir)));

for (const file of serverFiles) {
  const text = stripComments(await readFile(join(ROOT, file), 'utf8'));
  if (/from\s+['"]electron['"]|require\(['"]electron['"]\)/.test(text)) {
    violations.push(`${file}: 不得依赖 electron（迁移可行性守卫）`);
  }
}

for (const file of [...new Set(nodeSideFiles)]) {
  const text = stripComments(await readFile(join(ROOT, file), 'utf8'));
  const syncCalls = text.match(/\b[a-zA-Z]+\w*Sync\s*\(/g) ?? [];
  // '@types/node' 之类的类型名与 'SyncFunction' 这类词不算；只看真实调用。
  const real = syncCalls.filter((call) => !/^(?:keyof|type|interface)/.test(call));
  if (real.length > 0) {
    violations.push(`${file}: 禁止同步 IO —— ${[...new Set(real)].join(', ')}（K-05）`);
  }
}

for (const file of [...new Set([...serverFiles, ...nodeSideFiles])]) {
  const text = await readFile(join(ROOT, file), 'utf8');
  const lines = text.split('\n').length;
  if (lines > MAX_FILE_LINES) {
    violations.push(`${file}: ${lines} 行，超过 ${MAX_FILE_LINES} 行上限`);
  }
}

const entry = 'src/server/app.ts';
const entryText = await readFile(join(ROOT, entry), 'utf8');
const entryLines = entryText.split('\n').length;
if (entryLines > MAX_ENTRY_LINES) {
  violations.push(`${entry}: ${entryLines} 行，入口应 < ${MAX_ENTRY_LINES} 行`);
}
for (const forbidden of [/prisma|knex|drizzle/, /app\.(get|post|put)\(['"]\/api/, /fs\.(read|write)/]) {
  if (forbidden.test(entryText)) {
    violations.push(`${entry}: 入口疑似含业务逻辑/数据访问（命中 ${forbidden}）`);
  }
}

/**
 * 4. Node strip-only 兼容性（提示 + 关键脚本硬校验）
 *
 * 背景：src/repositories/asset.repository.ts 用了 TS 参数属性（constructor(private …)）。
 * 它是合法 TS，vite/esbuild 构建毫无问题，但 Node 的**strip-only** 类型擦除跑不了，
 * 会抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX —— 报错指向一个完全无关的入口文件，
 * 排查时极容易误判成"接线坏了"。这里把它变成一句人话提示，并顺带看住
 * 必须带 --experimental-transform-types 的 npm script 不许被人删掉那个 flag。
 */
const STRIP_UNSUPPORTED = [
  [/\benum\s+[A-Za-z_$][\w$]*/, 'enum'],
  [/\bnamespace\s+[A-Za-z_$][\w$]*/, 'namespace'],
  [/constructor\s*\(\s*(?:[^)]*\b(?:private|public|protected|readonly)\b[^)]*)\)/, '参数属性'],
];

const transformNeeded = [];
for (const file of [...new Set([...serverFiles, ...nodeSideFiles])]) {
  const text = stripComments(await readFile(join(ROOT, file), 'utf8'));
const hits = STRIP_UNSUPPORTED.filter(([re]) => re.test(text)).map(([, label]) => label);
  if (hits.length > 0) transformNeeded.push(`${file}（${[...new Set(hits)].join('、')}）`);
}

if (transformNeeded.length > 0) {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  // 凡是会把 Node 侧 TS 拉进模块图的脚本，都必须走 transform 模式才起得来。
  for (const name of ['smoke:server', 'verify:wiring', 'verify:sync']) {
    const cmd = pkg.scripts?.[name] ?? '';
    if (cmd && !cmd.includes('--experimental-transform-types')) {
      violations.push(
        `package.json scripts.${name} 缺少 --experimental-transform-types：` +
          `Node 侧含 strip-only 不支持的语法（${transformNeeded[0]}），裸 node 会直接崩`,
      );
    }
  }
}

/**
 * 5. 导入判定不得有第二份（预览 / 提交分叉守卫）
 *
 * 背景：渲染层为了在浏览器里跑预览，曾把 `measureImport` 抄了一份。
 * 后果不是"代码重复"这么轻——预览与提交一旦各判一次，就会出现
 * "预览说 3 条冲突、实际覆盖 5 条"，用户只会事后发现数据不对，
 * 根本不知道当初预览给错了数，属于无法察觉的静默数据丢失。
 * 因此这几个函数只允许在 `src/shared/personal-import.ts` 里定义一次。
 *
 * Node 侧与渲染层一律硬失败：渲染层那份（mockApi 里的重写）已由 frontend-2
 * 改为 import shared 清理完毕，因此不再留"列出但不阻塞"的宽限期——
 * 宽限期的输出迟早会被习惯性忽略，那这条检查就等于没有。
 */
const IMPORT_PURE_FNS = ['parsePersonalFile', 'targetKeyOf', 'measureImport', 'mergeGroups'];

async function listSource(dir) {
  const out = [];
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listSource(rel)));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const nodeSideDupes = [];
for (const file of [...new Set([...serverFiles, ...nodeSideFiles])]) {
  if (file.endsWith('src/shared/personal-import.ts')) continue;
  const text = stripComments(await readFile(join(ROOT, file), 'utf8'));
  const hits = IMPORT_PURE_FNS.filter((fn) => new RegExp(`function\\s+${fn}\\b`).test(text));
  if (hits.length > 0) nodeSideDupes.push(`${file}: 导入判定只在 src/shared/personal-import.ts 定义一次（发现 ${hits.join(', ')}）`);
}
for (const dupe of nodeSideDupes) violations.push(dupe);

const rendererDupes = [];
for (const file of await listSource('src/renderer')) {
  const text = stripComments(await readFile(join(ROOT, file), 'utf8'));
  const hits = IMPORT_PURE_FNS.filter((fn) => new RegExp(`function\\s+${fn}\\b`).test(text));
  if (hits.length > 0) {
    rendererDupes.push(`${file}: 导入判定只在 src/shared/personal-import.ts 定义一次（发现 ${hits.join(', ')}）`);
  }
}
for (const dupe of [...nodeSideDupes, ...rendererDupes]) violations.push(dupe);

if (violations.length > 0) {
    process.stdout.write(`守卫失败 ${violations.length} 项：\n`);
    for (const v of violations) process.stdout.write(`  - ${v}\n`);
    process.exitCode = 1;
  } else {
  process.stdout.write(
    `守卫通过：${serverFiles.length} 个 server/discovery 文件、${new Set(nodeSideFiles).size} 个 Node 侧文件；\n` +
      `  无 electron 依赖、无同步 IO、单文件 ≤ ${MAX_FILE_LINES} 行、入口 ${relative(ROOT, join(ROOT, entry))} ${entryLines} 行。\n`,
  );
  if (transformNeeded.length > 0) {
    const shown = transformNeeded.slice(0, 3).map((f) => `  - ${f}`).join('\n');
    process.stdout.write(
      `注意：${transformNeeded.length} 个 Node 侧文件含 strip-only 不支持的 TS 语法（详见下），\n` +
        `${shown}${transformNeeded.length > 3 ? `\n  - ……（其余 ${transformNeeded.length - 3} 个略）` : ''}\n` +
        '  这是合法 TS（vite/esbuild 构建不受影响），但用裸 node 跑会抛 ' +
        'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX；\n' +
        '  相关脚本请一律走 npm run（smoke:server / verify:wiring 已带 --experimental-transform-types），不要手工 node xxx.mjs。\n',
    );
  }
}
