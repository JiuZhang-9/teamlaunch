/**
 * src/server/container.ts —— 依赖装配（repositories → services）
 *
 * 这是**唯一**的组装点：路由与控制器只认 `ServiceContext` 接口，
 * 不自己 new 任何 repository。好处是自检脚本可以拿一个临时目录
 * 组装出完整服务，而不需要 Electron 的 userData。
 *
 * 监听地址与端口是**可变引用**：实际端口要等 bind 之后才知道
 * （17890 被占用就漂移到下一个）。诊断服务因此拿的是同一个对象，
 * 读到的永远是真实端口，而不是装配时的占位值。
 */

import { AssetRepository } from '../repositories/asset.repository.ts';
import { CredentialRepository } from '../repositories/credential.repository.ts';
import { FeedbackRepository } from '../repositories/feedback.repository.ts';
import { RevisionRepository } from '../repositories/revision.repository.ts';
import { ServiceIdentityRepository } from '../repositories/service.repository.ts';
import { TeamConfigRepository } from '../repositories/team-config.repository.ts';
import { TelemetryRepository } from '../repositories/telemetry.repository.ts';
import { ensureDirectories, type StoragePaths } from '../repositories/paths.ts';
import { AssetService } from '../services/asset.service.ts';
import { ChallengeService } from '../services/challenge.service.ts';
import { CredentialService } from '../services/credential.service.ts';
import { DiagnosticsService } from '../services/diagnostics.service.ts';
import { FeedbackService } from '../services/feedback.service.ts';
import { PublishService } from '../services/publish.service.ts';
import { RevisionService } from '../services/revision.service.ts';
import { TeamConfigService } from '../services/team-config.service.ts';
import { TelemetryService } from '../services/telemetry.service.ts';
import { TokenService } from '../services/token.service.ts';
import { LoginLockout, RateLimiter } from './hooks/rate-limit.ts';

export interface ListenInfo {
  address: string;
  port: number;
}

/** 控制器可见的全部依赖。只读为主，写操作一律走 service。 */
export interface ServiceContext {
  paths: StoragePaths;
  listen: ListenInfo;
  startedAt: number;
  role: 'admin';
  serviceId: string;
  instanceId: string;
  credentials: CredentialService;
  challenges: ChallengeService;
  tokens: TokenService;
  teamConfig: TeamConfigService;
  revisions: RevisionService;
  publish: PublishService;
  feedbackService: FeedbackService;
  telemetry: TelemetryService;
  assets: AssetService;
  diagnostics: DiagnosticsService;
  limiter: RateLimiter;
  lockout: LoginLockout;
}

export async function createContext(paths: StoragePaths, listen: ListenInfo): Promise<ServiceContext> {
  await ensureDirectories(paths);

  const identity = await new ServiceIdentityRepository(paths).ensure();

  const credentials = new CredentialService(new CredentialRepository(paths));
  await credentials.load();

  const teamConfig = new TeamConfigService();
  await teamConfig.load(paths);

  const telemetry = new TelemetryService(new TelemetryRepository(paths));
  await telemetry.load();

  const configRepository = new TeamConfigRepository(paths);
  const revisionRepository = new RevisionRepository(paths);

  const startedAt = Date.now();
  const limiter = new RateLimiter();

  return {
    paths,
    listen,
    startedAt,
    role: 'admin',
    serviceId: identity.serviceId,
    instanceId: identity.instanceId,
    credentials,
    challenges: new ChallengeService(credentials, identity.serviceId),
    tokens: new TokenService(),
    teamConfig,
    revisions: new RevisionService(revisionRepository),
    publish: new PublishService(teamConfig, configRepository, revisionRepository, identity.instanceId),
    feedbackService: new FeedbackService(new FeedbackRepository(paths)),
    telemetry,
    assets: new AssetService(new AssetRepository(paths)),
    diagnostics: new DiagnosticsService(teamConfig, telemetry, {
      get listenAddress() {
        return listen.address;
      },
      get listenPort() {
        return listen.port;
      },
      instanceId: identity.instanceId,
      startedAt,
    }),
    limiter,
    lockout: new LoginLockout(limiter, 'auth:verify'),
  };
}

/** 定时清扫：挑战、令牌、nonce、限流窗口。由调用方驱动，服务内不起定时器。 */
export function sweepContext(ctx: ServiceContext): void {
  const now = Date.now();
  ctx.challenges.sweep(now);
  ctx.tokens.sweep(now);
  ctx.feedbackService.sweep(now);
  ctx.limiter.sweep(60 * 60 * 1000, now);
}
