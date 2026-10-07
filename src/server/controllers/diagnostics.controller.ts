/**
 * src/server/controllers/diagnostics.controller.ts —— GET /diagnostics
 *
 * 控制器层刻意只剩一行：结论（topIssue）与证据（checks）全部由
 * services/diagnostics.service.ts 决定，那边已经把优先级写死了。
 * 这里再"优化"一次顺序，就会出现"诊断页和巡检逻辑说的不一样"。
 *
 * 诚实边界也在服务层：本机自连自身 IP 的连通性测试不可信，
 * 真实连通必须由第二台机器验证（K-02），服务端不假装自己能验。
 */

import type { DiagnosticInfo } from '../../services/diagnostics.service.ts';
import type { ServiceContext } from '../container.ts';

export function createDiagnosticsController(ctx: ServiceContext) {
  return {
    async inspect(): Promise<DiagnosticInfo> {
      return ctx.diagnostics.inspect();
    },
  };
}
