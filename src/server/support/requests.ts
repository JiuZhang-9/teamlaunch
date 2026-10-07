/**
 * src/server/support/requests.ts —— 服务端入参 schema（契约的补齐部分）
 *
 * `src/shared/schema/*.ts` 是前后端共用契约，但它只覆盖"要落盘/要同步"的数据结构。
 * 下面三个是**纯请求侧**的形状（挑战、proof、还原），客户端不需要拿它做数据建模，
 * 因此不进 shared，避免把 shared 变成什么都往里塞的杂物间。
 *
 * 字段口径与 openapi.yaml 一致：ChallengeRequest / VerifyRequest / RestoreRequest。
 */

import { z } from 'zod';
import { RevisionSchema } from '../../shared/schema/common.ts';

export const ChallengeRequestSchema = z.object({
  deviceId: z.string().min(1).max(64),
});

export const VerifyRequestSchema = z.object({
  challengeId: z.string().min(1).max(64),
  deviceId: z.string().min(1).max(64),
  proof: z.string().min(1).max(128),
});

/** 还原同样走乐观并发：baseRevision 是打开还原对话框时看到的版本。 */
export const RestoreRequestSchema = z.object({
  baseRevision: RevisionSchema,
});

export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export type RestoreRequest = z.infer<typeof RestoreRequestSchema>;
