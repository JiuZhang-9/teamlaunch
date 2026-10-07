/**
 * src/server/controllers/telemetry.controller.ts —— 匿名埋点批量上报
 *
 * 服务端**不落任何单条事件**，只更新"该设备的最后一次累计快照"与设备去重集合。
 * 因此这里没有"按设备回放"的读取能力，将来也不应该有。
 *
 * clientStats 是客户端的**累计**值，不是本批增量。服务层取每个设备的最后一次
 * 快照再求和——若改成逐批累加，同一个客户端的累计值会被重复计入，
 * 丢失率会算出荒谬的负数，而这类错误在 UI 上只是"数字有点怪"，极难发现。
 */

import { TelemetryBatchSchema } from '../../shared/schema/telemetry.ts';
import type { ServiceContext } from '../container.ts';
import { parseOrThrow } from '../support/validate.ts';

export interface TelemetryAcceptResult {
  accepted: number;
}

export function createTelemetryController(ctx: ServiceContext) {
  return {
    accept(body: unknown, deviceId: string | null): TelemetryAcceptResult {
      const parsed = parseOrThrow(TelemetryBatchSchema, body);
      ctx.telemetry.noteTelemetryDevice(deviceId, parsed.clientStats);
      return { accepted: parsed.items.length };
    },
  };
}
