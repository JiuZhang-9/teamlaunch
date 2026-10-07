/**
 * src/shared/canonical-hash.ts —— 内容哈希（仅主进程/服务端加载）
 *
 * 从 canonical.ts 拆出来的原因：sha256 依赖 `node:crypto`，而 renderer
 * 同一模块图里只需要 canonicalJson——Vite dev server 会把 `node:crypto`
 * externalize 成浏览器占位并在 import 绑定解析时抛错，连带整个渲染层
 * 白屏。拆开后 canonical.ts 保持零 Node 依赖可进 renderer，本文件只被
 * 主进程 / Fastify 服务端 / 校验脚本引用。
 *
 * `contentHash` 是同步协议三要素之一（ADR-003），客户端三重闸门的第三条就是
 * "sha256(规范 JSON) 等于响应里的 contentHash"。因此规范化必须与
 * canonical.ts **共用同一份**——两端各写一份迟早漂移，漂移的表现是"随机校验失败"。
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.ts';

/**
 * 入参既可能是字符串（规范 JSON）也可能是 Buffer（请求原始字节），
 * 二者必须**先统一成字节**再喂给 createHash：
 *
 * 直接把 `string | Buffer` 交给 `update()` 会因为重载解析拿到 string 分支，
 * 而 Buffer 走的是另一条；更危险的是"Buffer → utf8 字符串 → 再按 utf8 编码"
 * 这种绕法对非 UTF-8 字节（图标二进制）不可逆。这里一律 Buffer.from(utf8)，
 * 保证同一串字节在任何入参形态下算出同一个摘要。
 */
export function sha256Hex(input: string | Buffer): string {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 计算团队配置的 contentHash。
 *
 * 排除 `revision` 与 `contentHash` 自身（Spec §6 / openapi TeamConfig.contentHash）。
 * publishedAt 参与计算：它由服务端生成，同内容两次发布本就该得到不同版本标识。
 */
export function computeContentHash(input: {
  schemaVersion: number;
  instanceId: string;
  publishedAt: string;
  groups: unknown;
  announcements?: unknown;
}): string {
  return sha256Hex(
    canonicalJson({
      schemaVersion: input.schemaVersion,
      instanceId: input.instanceId,
      publishedAt: input.publishedAt,
      groups: input.groups,
      announcements: input.announcements ?? [],
    }),
  );
}
