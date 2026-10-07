/**
 * src/repositories/service.repository.ts —— 服务身份：serviceId 与 instanceId
 *
 * - `serviceId`：本安装实例的 UUID，信标与 /health 都带它。
 * - `instanceId`：团队数据源 UUID，随每份配置下发。客户端靠它识别"连错实例"，
 *   发布时若客户端提交的 instanceId 与本机不符 → 409 ERR_INSTANCE_MISMATCH。
 *
 * 创建必须走 single-flight：`不存在就创建` 是最经典的"检查再写入"并发窗口，
 * 两个并发调用会各生成一份身份，后写的静默覆盖先写的，客户端随后全线报实例不匹配。
 */

import { randomUUID } from 'node:crypto';
import { createSingleFlight } from '../utils/single-flight.ts';
import { readJsonFile, writeJsonAtomic } from './atomic-json.ts';
import type { StoragePaths } from './paths.ts';

export interface ServiceIdentity {
  serviceId: string;
  instanceId: string;
  createdAt: string;
}

export class ServiceIdentityRepository {
  private readonly singleFlight = createSingleFlight();

  constructor(private readonly paths: StoragePaths) {}

  /** 读取；不存在则创建并落盘（并发安全）。 */
  async ensure(): Promise<ServiceIdentity> {
    return this.singleFlight('identity', async () => {
      const existing = await readJsonFile<ServiceIdentity>(this.paths.service);
      if (existing && typeof existing.serviceId === 'string' && typeof existing.instanceId === 'string') {
        return existing;
      }
      const created: ServiceIdentity = {
        serviceId: randomUUID(),
        instanceId: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(this.paths.service, created);
      return created;
    });
  }
}
