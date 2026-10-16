#!/usr/bin/env node
/**
 * 发版到 GitHub（ADR-009 的机制保证）：校验 → 打 tag → 建 Release → 挂齐四件套 → 回读核对。
 *
 * 为什么需要脚本：GitHub 源的硬依赖是**每个 Release 都必须带 `latest.yml`**——
 * 少挂一个文件，所有人就看不到新版本，而且失败是静默的（只在客户端日志里出现）。
 * 2026-10-12 的 1.0.18 Release 就是"只挂了 exe + blockmap + SHA256SUMS"，
 * 所以切源当天没有任何机器能更新。这类错误必须由机器来防，不能靠记性。
 *
 * 用法：
 *   npm run release:gh              # 真发：校验、打 tag、建 Release、上传
 *   npm run release:gh -- --dry-run # 只做本地校验，打印将要执行的动作，不碰远端
 *
 * 前置：① 工作区干净且 main 已推送；② 已 `npm run dist:win`；③ gh CLI 已登录（gh auth status）。
 * 纪律：实机验收通过后才发版（见 AGENTS.md 的交付顺序）。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'JiuZhang-9/teamlaunch';
const root = process.cwd();
const installerDir = join(root, 'dist', 'installer');
const dryRun = process.argv.includes('--dry-run');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = String(pkg.version);
const tag = `v${version}`;
const exe = `TeamLaunch-Setup-${version}.exe`;
/** 缺一不可：exe 本体、差量下载用的 blockmap、更新器判定版本用的 latest.yml、校验和。 */
const assets = [exe, `${exe}.blockmap`, 'latest.yml', 'SHA256SUMS.txt'];

function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
}
function ok(msg) {
  process.stdout.write(`  ✓ ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`\n✗ ${msg}\n`);
  process.exit(1);
}

process.stdout.write(`发版校验：${tag}${dryRun ? '（dry-run，不会碰远端）' : ''}\n`);

/* 1. 构建产物齐全 */
for (const file of assets.slice(0, 3)) {
  if (!existsSync(join(installerDir, file))) {
    fail(`缺少产物 dist/installer/${file} —— 先跑 npm run dist:win`);
  }
}
ok(`产物齐全：${assets.slice(0, 3).join(' / ')}`);

/* 2. latest.yml 的版本必须与 package.json 一致
      （不一致＝拿着上一次构建的产物发新版——用户会装到旧版本，正是 CHANGELOG 1.0.5 的教训） */
const latestText = readFileSync(join(installerDir, 'latest.yml'), 'utf8');
const latestVersion = /^version:\s*([^\s#]+)\s*$/m.exec(latestText)?.[1] ?? null;
if (latestVersion === null) fail('latest.yml 里读不到 version 行——它不是 electron-builder 生成的？');
if (latestVersion !== version) {
  fail(`latest.yml 的版本是 ${latestVersion}，package.json 是 ${version} —— 产物是旧构建，重跑 npm run dist:win`);
}
ok(`latest.yml 版本一致：${version}`);

/* 3. 工作区干净、main 已推送（tag 必须指向一个远端存在的提交） */
if (run('git', ['status', '--porcelain']) !== '') fail('工作区有未提交的改动——先提交再发版');
const behind = run('git', ['rev-list', '--count', 'origin/main..HEAD']);
if (behind !== '0') fail(`本地有 ${behind} 个提交未推送——先 git push origin main`);
ok('工作区干净且 main 已推送');

/* 4. tag 未被占用（本地与远端都查） */
let tagTaken = false;
try {
  run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
  tagTaken = true;
} catch {
  tagTaken = false;
}
if (tagTaken) fail(`本地已存在 tag ${tag}`);
if (run('git', ['ls-remote', '--tags', 'origin', tag]) !== '') fail(`远端已存在 tag ${tag}`);
ok(`tag ${tag} 未被占用`);

/* 5. 校验和：与既有格式保持一致（`<sha256> *<文件名>`） */
const hash = createHash('sha256').update(readFileSync(join(installerDir, exe))).digest('hex');
if (!dryRun) writeFileSync(join(installerDir, 'SHA256SUMS.txt'), `${hash} *${exe}\n`, 'utf8');
ok(`SHA256SUMS.txt：${hash.slice(0, 12)}…`);

/* 6. Release 说明 = CHANGELOG 里这一版的小节（没有条目就直接失败——
      发版必写 CHANGELOG 是本项目的纪律，别让 Release 变成无说明的黑盒） */
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const sectionStart = changelog.indexOf(`## [${version}]`);
if (sectionStart < 0) fail(`CHANGELOG.md 里没有 [${version}] 小节——发版前必须写条目`);
const nextSection = changelog.indexOf('\n## [', sectionStart + 1);
const notes = changelog.slice(sectionStart, nextSection < 0 ? undefined : nextSection).trim();
ok(`Release 说明取自 CHANGELOG（${notes.split('\n').length} 行）`);

if (dryRun) {
  process.stdout.write(`\n将要执行：\n  git tag -a ${tag}\n  git push origin ${tag}\n  gh release create ${tag} --repo ${REPO} --title ${tag} --notes <CHANGELOG 小节>\n  gh release upload ${tag} ${assets.join(' ')}\n`);
  process.stdout.write('\ndry-run 结束，未改动任何东西。\n');
  process.exit(0);
}

/* 7. 打 tag、推送、建 Release、上传 */
run('git', ['tag', '-a', tag, '-m', `TeamLaunch ${version}`]);
ok(`已打 tag ${tag}`);
run('git', ['push', 'origin', tag]);
ok('tag 已推送');

const notesFile = join(installerDir, `.release-notes-${version}.md`);
writeFileSync(notesFile, `${notes}\n`, 'utf8');
run('gh', ['release', 'create', tag, '--repo', REPO, '--title', tag, '--notes-file', notesFile]);
ok('Release 已创建');
run('gh', ['release', 'upload', tag, ...assets.map((f) => join(installerDir, f)), '--repo', REPO]);
ok(`四件套已上传：${assets.join(' / ')}`);

/* 8. 回读核对：上传之后必须看到四个资产都在（"发了"和"挂上了"不是一回事） */
const listed = run('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'assets', '--jq', '.assets[].name'])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const missing = assets.filter((file) => !listed.includes(file));
if (missing.length > 0) fail(`Release 上缺少资产：${missing.join(' / ')} —— 手动补挂后再宣布发版完成`);
ok(`回读核对通过：${listed.length} 个资产（含 latest.yml）`);

process.stdout.write(`\n完成：${REPO}/releases/tag/${tag}\n`);
process.stdout.write('提醒：客户端在启动 30 秒后会做第一次检查，之后每 6 小时一次。\n');
