/**
 * src/services/telemetry.service.ts —— 遥测接收与完整度自证（ADR-008）
 *
 * 服务端侧的隐私硬约束：
 *   - **不记录任何来源 IP**，访问日志也剔除（由 server/hooks/logging.ts 保证）
 *   - 只保存客户端自报的匿名设备 ID 与聚合计数，**不落单条事件、不落行为序列**
 *   - 不提供按设备回放明细的读取能力
 *
 * 完整度口径（PRD §16.3 Go/No-Go）：
 *   丢失率 = (droppedByEviction + droppedByRetention) / recorded
 *   覆盖率 = 上报过遥测的匿名设备数 / 拉取过配置的匿名设备数
 *   只有 丢失率 < 0.2 且 覆盖率 >= 0.7 时 sampleJudgable 才为 true。
 *
 * clientStats 是客户端的**累计**快照，不是本批增量。因此聚合必须
 * "取每个设备的最后一次快照再求和"，绝不能逐批累加——逐批累加会把
 * 同一个客户端的累计值重复计入，丢失率算出来是负数级别的荒谬值。
 */

import { RETENTION } from '../shared/constants.ts';
import type { TelemetryRepository, TelemetryAggregate } from '../repositories/telemetry.repository.ts';

export interface ClientStats {
  recorded: number;
  uploaded: number;
  droppedByEviction: number;
  droppedByRetention: number;
}

export interface TelemetryCompleteness {
  eventsRecorded: number;
  eventsUploaded: number;
  eventsDropped: number;
  lossRate: number;
  configDeviceCount: number;
  telemetryDeviceCount: number;
  deviceCoverage: number;
  sampleJudgable: boolean;
}

export class TelemetryService {
  /** deviceId → 该客户端最后一次上报的累计快照。 */
  private readonly latestStats = new Map<string, ClientStats>();
  private configDevices = new Set<string>();
  private telemetryDevices = new Set<string>();
  private saveChain: Promise<void> = Promise.resolve();

  constructor(private readonly repository: TelemetryRepository) {}

  async load(): Promise<void> {
    const aggregate = await this.repository.load();
    this.configDevices = new Set(aggregate.configDevices);
    this.telemetryDevices = new Set(aggregate.telemetryDevices);
  }

  /** GET /config 成功时调用。只记匿名 ID 集合，不记时间、不记次数。 */
  noteConfigDevice(deviceId: string | null): void {
    if (deviceId === null || deviceId.length === 0) return;
    if (this.configDevices.has(deviceId)) return;
    this.configDevices.add(deviceId);
    this.trim(this.configDevices);
    this.persist();
  }

  /** POST /telemetry 成功时调用。 */
  noteTelemetryDevice(deviceId: string | null, stats: ClientStats): void {
    if (deviceId !== null && deviceId.length > 0) {
      if (!this.telemetryDevices.has(deviceId)) {
        this.telemetryDevices.add(deviceId);
        this.trim(this.telemetryDevices);
      }
      this.latestStats.set(deviceId, stats);
    }
    this.persist();
  }

  completeness(): TelemetryCompleteness {
    let recorded = 0;
    let uploaded = 0;
    let dropped = 0;
    for (const stats of this.latestStats.values()) {
      recorded += stats.recorded;
      uploaded += stats.uploaded;
      dropped += stats.droppedByEviction + stats.droppedByRetention;
    }
    const lossRate = recorded === 0 ? 0 : dropped / recorded;
    const configDeviceCount = this.configDevices.size;
    const telemetryDeviceCount = this.telemetryDevices.size;
    const deviceCoverage = configDeviceCount === 0 ? 0 : telemetryDeviceCount / configDeviceCount;
    return {
      eventsRecorded: recorded,
      eventsUploaded: uploaded,
      eventsDropped: dropped,
      lossRate: round(lossRate),
      configDeviceCount,
      telemetryDeviceCount,
      deviceCoverage: round(deviceCoverage),
      sampleJudgable: configDeviceCount > 0 && lossRate < 0.2 && deviceCoverage >= 0.7,
    };
  }

  private trim(set: Set<string>): void {
    if (set.size <= RETENTION.telemetryDeviceIds) return;
    const excess = set.size - RETENTION.telemetryDeviceIds;
    let removed = 0;
    for (const id of set) {
      set.delete(id);
      removed += 1;
      if (removed >= excess) break;
    }
  }

  /** 串行化写盘：并发批次不会互相覆盖 aggregate.json。 */
  private persist(): void {
    this.saveChain = this.saveChain.then(async () => {
      const value: TelemetryAggregate = {
        configDevices: [...this.configDevices],
        telemetryDevices: [...this.telemetryDevices],
        eventsRecorded: this.completeness().eventsRecorded,
        eventsUploaded: this.completeness().eventsUploaded,
        eventsDropped: this.completeness().eventsDropped,
      };
      await this.repository.save(value);
    }).catch(() => undefined);
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
