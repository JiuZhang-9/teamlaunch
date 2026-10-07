/**
 * src/server/hooks/logging.ts —— 访问日志（ADR-008 隐私硬约束）
 *
 * 只写四个字段：method / path / status / durationMs。
 * **显式不写** `req.ip`、`req.socket.remoteAddress`、`X-Forwarded-For`
 * 以及任何查询串。理由不是洁癖：局域网里"哪台机器什么时候拉了配置"
 * 已经足以还原员工的在岗节奏，而这对本产品毫无用处。
 *
 * 实现方式也刻意"笨"：手工构造一个新对象，而不是序列化 req 再删字段。
 * 后者的失败模式是"将来有人加了一个字段忘了删"，前者不可能漏。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { signaturePathOf } from './raw-body.ts';

export interface AccessLogEntry {
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export type AccessLogger = (entry: AccessLogEntry) => void;

/** 默认出口用 stderr：stdout 留给启动信息与人工排查时的管道处理。 */
export const defaultAccessLogger: AccessLogger = (entry) => {
  process.stderr.write(`${JSON.stringify(entry)}\n`);
};

export function registerAccessLog(
  app: FastifyInstance,
  log: AccessLogger = defaultAccessLogger,
): void {
  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    // path 去掉查询串：/changes?since= 之类不进日志，避免间接触及业务数据。
    log({
      method: req.method,
      path: signaturePathOf(req),
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });
}

/** 供自检脚本断言「日志里确实没有 IP 字段」。 */
export const ACCESS_LOG_FIELDS = ['method', 'path', 'status', 'durationMs'] as const;
