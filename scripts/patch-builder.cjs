#!/usr/bin/env node
/**
 * electron-builder（app-builder-lib）rename EPERM 兜底补丁 —— 由 package.json 的
 * postinstall 钩子自动应用，重装依赖后无需手工重打。
 *
 * 现象：本机（X: 盘）上 extractArchive 解压完立即 fs.rename(tmpDir → dir) 稳定报
 * EPERM，且失败残留的 tmp 目录会被永久锁死（挡 rename/delete，不挡读取/逐项 mv），
 * 重试无解，dist:win 打包必然失败；杀软实时保护关闭仍复现。
 *
 * 补丁：rename 遇 EPERM/EACCES/EBUSY 时回退 fs.cp 递归复制（cp 不需要 DELETE 权限，
 * 可绕开目录锁），再清理 tmp。纯增量包裹，不改上游其他逻辑。
 * 上游同类问题：electron-builder #9066 / #5525、electron-forge #3448（本机场景更极端）。
 *
 * 幂等：以 "falling back to copy" 为已打标记；目标文件不存在（如 --omit=dev）静默
 * 跳过；上游升级重构找不到目标行时仅警告，不阻断 npm install——本补丁只影响打包，
 * 不影响他人构建渲染层或运行。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'falling back to copy';
// 上游 26.15.3 中 extractArchive 提交缓存目录的唯一一行（8 空格缩进）
const TARGET_LINE = '        await fs.rename(tmpDir, dir);';

const REPLACEMENT = [
    '        // 本机 X: 盘补丁（由 scripts/patch-builder.cjs postinstall 自动应用）：',
    '        // 解压完立即 rename 大量新落盘文件稳定报 EPERM，且失败后的 tmp 目录会被',
    '        // 永久锁死（只挡 rename/delete，不挡读取）。重试无解，改为回退到内容复制',
    '        // （cp 不需要 DELETE 权限，可绕开目录锁）。',
    '        try {',
    '            await fs.rename(tmpDir, dir);',
    '        }',
    '        catch (e) {',
    '            const renameBlocked = e && ["EPERM", "EACCES", "EBUSY"].includes(e.code);',
    '            if (!renameBlocked)',
    '                throw e;',
    '            builder_util_1.log.warn({ tmpDir, dir }, "rename blocked by transient dir lock, falling back to copy");',
    '            await fs.cp(tmpDir, dir, { recursive: true });',
    '            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });',
    '        }',
].join('\n');

const target = path.join(
    __dirname, '..', 'node_modules', 'app-builder-lib', 'out', 'util', 'electronGet.js'
);

if (!fs.existsSync(target)) {
    // 未安装 electron-builder（--omit=dev 等）：本补丁与之无关
    process.exit(0);
}

const src = fs.readFileSync(target, 'utf8');

if (src.includes(MARKER)) {
    console.log('[patch-builder] app-builder-lib rename 兜底补丁已就位，跳过');
    process.exit(0);
}

if (!src.includes(TARGET_LINE)) {
    console.warn('[patch-builder] 警告：未找到上游 rename 目标行，app-builder-lib 可能已升级重构。');
    console.warn('[patch-builder] 若 dist:win 在 extractArchive 处报 EPERM，请对照本脚本重新适配。');
    process.exit(0);
}

// split/join 而非 replace：避免 replace 对 $ 序号的特殊语义
fs.writeFileSync(target, src.split(TARGET_LINE).join(REPLACEMENT));
console.log('[patch-builder] 已应用 app-builder-lib rename→cp 兜底补丁');
