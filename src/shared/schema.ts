/**
 * src/shared/schema.ts —— 前后端共用契约的**唯一入口**（装配文件，不含定义）
 *
 * 定位：契约，不是业务代码。主进程、渲染进程、内嵌同步服务三方共用同一份校验。
 * 与 docs/api/openapi.yaml 同源；改这里必须同步那里，反之亦然。
 *
 * 定义按资源分文件（单文件 ≤300 行的硬规则）：
 *   common.ts 常量与原语 ／ entry.ts 三类入口 ／ group.ts 分组与容量闸门
 *   config.ts 团队配置与 1MB 闸门 ／ local.ts settings 与 personal
 *   feedback.ts 失效反馈 ／ telemetry.ts 遥测 ／ envelope.ts 响应信封
 *
 * 三条硬约束（写进 schema，不靠 UI 提示）：≤8 分组、≤200 入口（跨组求和）、≤1MB（UTF-8 字节）
 *
 * 校验门（提交前必跑，见 docs/ARCHITECTURE.md §14.1）：
 *   node scripts/verify-openapi.cjs
 *   node scripts/verify-schema.mjs
 *
 * 刻意不包含：/diagnostics 响应体（管理员侧只读渲染，字段随巡检项演进，
 * 由 openapi.yaml 的 DiagnosticInfo 单独约束，Phase 3 再落窄 schema）。
 */

export * from './schema/common.ts';
export * from './schema/entry.ts';
export * from './schema/group.ts';
export * from './schema/config.ts';
export * from './schema/local.ts';
export * from './schema/feedback.ts';
export * from './schema/telemetry.ts';
export * from './schema/envelope.ts';
