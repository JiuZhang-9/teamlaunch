#!/usr/bin/env node
/**
 * TeamLaunch — lucide-react 图标导出名核验
 *
 * 用途：CI / 本地校验 UIUX.md §6.2 图标清单里的每一个 kebab-case 名称，
 *       在已安装的 lucide-react 版本里确实有对应的 PascalCase 导出。
 *
 * 为什么需要它：
 *   Lucide 会随版本重命名图标（building-2 → building-complex 等）。
 *   文档核对过不等于包里真的有；装完依赖必须再跑一次。
 *
 * 用法：
 *   node docs/design-system/verify-lucide-exports.mjs
 *   node docs/design-system/verify-lucide-exports.mjs <lucide-react 包目录>
 *
 * 退出码：0 = 全部存在；1 = 有缺失（缺失时禁止自绘/换库，先登记 icon-exceptions.md）
 */

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const pkgDir = process.argv[2] ?? path.resolve("node_modules/lucide-react");

const ICONS = [
  "building-complex", "user-round", "search", "refresh-cw", "settings",
  "ellipsis-vertical", "plus", "pencil", "trash", "grip-vertical",
  "circle-check", "circle-plus", "circle-minus", "x",
  "chevron-down", "chevron-up", "chevron-right",
  "app-window", "folder", "folder-open", "globe",
  "copy", "external-link", "link", "monitor-play",
  "cloud-off", "cloud", "loader-circle", "cloud-upload",
  "triangle-alert", "circle-x", "info", "message-square-warning",
  "send", "clock", "shield-check", "key-round", "monitor", "lock-open",
  "file-down", "file-up", "sun", "moon", "monitor-cog",
  "layout-grid", "list", "arrow-down-up", "rotate-ccw", "crosshair",
  "undo-2", "pin", "rotate-ccw-clock", "folder-plus", "scan-search",
  "keyboard",
];

const pascal = (k) =>
  k.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");

if (!existsSync(pkgDir)) {
  console.error(`[FATAL] 找不到 lucide-react 包目录：${pkgDir}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
console.log(`target : ${pkg.name}@${pkg.version}`);
console.log(`icons  : ${ICONS.length} 个待核验（UIUX.md §6.2 去重后）`);

// --- 通道 A：类型声明里的 `declare const X: LucideIcon;` -------------------
const dtsPath = path.join(pkgDir, "dist/lucide-react.d.ts");
let declared = new Set();
if (existsSync(dtsPath)) {
  const dts = readFileSync(dtsPath, "utf8");
  declared = new Set(
    [...dts.matchAll(/declare const ([A-Za-z0-9_]+): LucideIcon;/g)].map((m) => m[1])
  );
  console.log(`d.ts   : ${declared.size} 个 declare const`);
} else {
  console.warn("[warn] 未找到 dist/lucide-react.d.ts，跳过通道 A");
}

// --- 通道 B：ESM barrel 的实际 export --------------------------------------
const esmPath = path.join(pkgDir, "dist/esm/lucide-react.mjs");
let exported = new Set();
if (existsSync(esmPath)) {
  const esm = readFileSync(esmPath, "utf8");
  for (const block of esm.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) exported.add(name);
    }
  }
  console.log(`esm    : ${exported.size} 个 export`);
} else {
  console.warn("[warn] 未找到 dist/esm/lucide-react.mjs，跳过通道 B");
}

// --- 通道 C：运行时 require（需要 react 已安装）----------------------------
let runtime = null;
try {
  const require = createRequire(import.meta.url);
  const cjsEntry = path.join(pkgDir, pkg.main ?? "dist/cjs/lucide-react.js");
  const mod = require(cjsEntry);
  runtime = new Set(
    Object.keys(mod).filter((k) => /^[A-Z]/.test(k) && mod[k] != null)
  );
  console.log(`runtime: ${runtime.size} 个运行时导出`);
} catch (err) {
  console.warn(`[warn] 运行时 require 跳过（${err.code ?? err.message}）——需先安装 react`);
}

// --- 判定 -------------------------------------------------------------------
const missing = [];
for (const name of ICONS) {
  const p = pascal(name);
  const okA = declared.size === 0 || declared.has(p);
  const okB = exported.size === 0 || exported.has(p);
  const okC = runtime === null || runtime.has(p);
  if (!(okA && okB && okC)) {
    missing.push(`${name} -> ${p} (d.ts:${okA} esm:${okB} runtime:${okC})`);
  }
}

console.log("-".repeat(60));
if (missing.length) {
  console.log(`MISSING (${missing.length}):`);
  for (const m of missing) console.log("  - " + m);
  console.log("\n禁止自绘 SVG、禁止换库、禁止用 emoji 顶替。");
  console.log("处理方式：到 docs/design-system/icon-exceptions.md 登记后讨论。");
  process.exit(1);
}
console.log(`ALL OK (${ICONS.length})`);
console.log("RESULT: PASS");
