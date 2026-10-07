/**
 * src/server/routes/updates.route.ts —— GET /updates/{file}
 *
 * 自动更新的静态文件源（electron-updater generic provider）：
 * 管理员把构建产物（latest.yml + 安装包 + blockmap）放进 updates 目录，
 * 全团队的客户端就能从这里检查并差量下载。
 *
 * 刻意的决定：
 *  - 不做鉴权、不走 /api/v1 前缀：安装包里没有机密，客户端在拿到令牌之前
 *    也应该能检查更新（部署早于配对）；保密由"只在局域网监听 + LocalSubnet
 *    防火墙规则"保证（与整个服务的信任域一致）。
 *  - 文件名白名单校验，杜绝路径穿越。
 *  - latest.yml 必须 no-cache（新版本要立刻被看到），安装包允许短缓存。
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const FILENAME_SAFE = /^[A-Za-z0-9._-]+$/;

export function registerUpdatesRoute(app: FastifyInstance, updatesDir: string | undefined): void {
  if (!updatesDir) return;

  app.get('/updates/:file', async (req, reply) => {
    const file = String((req.params as { file?: unknown }).file ?? '');
    if (!FILENAME_SAFE.test(file)) {
      void reply.status(400).send();
      return;
    }
    const full = join(updatesDir, file);
    try {
      const info = await stat(full);
      if (!info.isFile()) {
        void reply.status(404).send();
        return;
      }
      const type = /\.ya?ml$/i.test(file) ? 'text/yaml; charset=utf-8' : 'application/octet-stream';
      reply.header('Content-Type', type).header('Cache-Control', /\.ya?ml$/i.test(file) ? 'no-cache' : 'max-age=300');
      // async 处理器里直接 return 流（Fastify v5 会对返回的流接管 pipe）；
      // 实测 reply.send(stream) 在 async 处理器里 body 会变空。
      return createReadStream(full);
    } catch {
      void reply.status(404).send();
    }
  });
}
