/**
 * src/server/controllers/auth.controller.ts —— POST /auth/challenge 与 /auth/verify
 *
 * 口令永不上网：服务端只发 challenge + salt + kdf 参数，客户端本地派生后回 proof。
 * 因此这里**没有**任何"接收口令"的分支——有就是设计事故。
 *
 * 两条容易做错的地方：
 *   1. 未设置口令的实例不是"认证失败"而是"不是管理员数据源"（403）。
 *      员工机被人手动指到另一台员工机上时，403 才能让 UI 说人话。
 *   2. 失败计数与锁定必须**同一条路径**：verify 抛错即记一次失败，
 *      成功即清零。少记一次就等于口令可被无限试。
 */

import type { ChallengeInfo } from '../../services/challenge.service.ts';
import type { IssuedToken } from '../../services/token.service.ts';
import { AppError } from '../../shared/errors.ts';
import type { ServiceContext } from '../container.ts';
import type { ChallengeRequest, VerifyRequest } from '../support/requests.ts';

export function createAuthController(ctx: ServiceContext) {
  return {
    challenge(body: ChallengeRequest): ChallengeInfo {
      if (!ctx.credentials.hasCredential()) {
        throw new AppError('ERR_ROLE_MISMATCH', '该设备不是管理员数据源');
      }
      return ctx.challenges.create(body.deviceId);
    },

    verify(body: VerifyRequest): IssuedToken {
      ctx.lockout.assertUnlocked(body.deviceId);
      try {
        ctx.challenges.verify(body.challengeId, body.deviceId, body.proof);
      } catch (err) {
        ctx.lockout.recordFailure(body.deviceId);
        throw err;
      }
      ctx.lockout.clear(body.deviceId);

      const key = ctx.credentials.key;
      if (key === null) {
        throw new AppError('ERR_BAD_PROOF', '口令校验未通过');
      }
      return ctx.tokens.issue(body.deviceId, key);
    },
  };
}
