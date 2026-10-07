/**
 * src/repositories/telemetry.repository.ts —— 遥测聚合（ADR-008 §11.4）
 *
 * 只存三样东西：两个匿名设备 ID 去重集合（各取上限内最近的一批）与四个计数器。
 * 不落任何单条事件、不落任何按设备的行为序列 —— `/telemetry` 的读取侧
 * 明确不提供按设备回放能力（架构 §11.3 末条）。
 *
 * 计数器口径：丢失率 = (droppedByEviction + droppedByRetention) / recorded。
 * 客户端每批随行自己的 clientStats，服务端累加的是"各客户端自报的累计值"。
 */

import { RETENTION } from '../shared/constants.ts';
import { readJsonFile, writeJsonAtomic } from './atomic-json.ts';
import type { StoragePaths } from './paths.ts';

export interface TelemetryAggregate {
  /** 曾成功拉取过配置的匿名设备 ID。 */
  configDevices: string[];
  /** 曾成功上报过遥测的匿名设备 ID。 */
  telemetryDevices: string[];
  eventsRecorded: number;
  eventsUploaded: number;
  eventsDropped: number;
}

const EMPTY: TelemetryAggregate = {
  configDevices: [],
  telemetryDevices: [],
  eventsRecorded: 0,
  eventsUploaded: 0,
  eventsDropped: 0,
};

export class TelemetryRepository {
  constructor(private readonly paths: StoragePaths) {}

  async load(): Promise<TelemetryAggregate> {
    const raw = await readJsonFile<Partial<TelemetryAggregate>>(this.paths.telemetryAggregate);
    if (raw === null) return { ...EMPTY };
    return {
      configDevices: Array.isArray(raw.configDevices) ? raw.configDevices : [],
      telemetryDevices: Array.isArray(raw.telemetryDevices) ? raw.telemetryDevices : [],
      eventsRecorded: typeof raw.eventsRecorded === 'number' ? raw.eventsRecorded : 0,
      eventsUploaded: typeof raw.eventsUploaded === 'number' ? raw.eventsUploaded : 0,
      eventsDropped: typeof raw.eventsDropped === 'number' ? raw.eventsDropped : 0,
    };
  }

  async save(value: TelemetryAggregate): Promise<void> {
    await writeJsonAtomic(this.paths.telemetryAggregate, {
      ...value,
      configDevices: value.configDevices.slice(-RETENTION.telemetryDeviceIds),
      telemetryDevices: value.telemetryDevices.slice(-RETENTION.telemetryDeviceIds),
    });
  }
}
