/**
 * src/server/beacon.ts —— UDP 17891 信标应答（ADR-002 的服务端侧）
 *
 * 方向是设计的核心：员工机**主动发广播**，管理员机**单播应答**。
 * Windows 防火墙对自己发出的 UDP 的应答做状态放行，员工机因此零配置；
 * 反过来设计（管理员广播、员工监听）就要给每台员工机开入站规则，产品前提直接崩塌。
 *
 * `httpPort` 必须广播真实端口（可能漂移），`instanceId` 用于让员工识别
 * "接到了另一个团队的数据"。两者都不能写死或省略。
 *
 * 本文件只依赖 node:dgram，不依赖 electron。
 */

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { hostname } from 'node:os';
import { BEACON_MAGIC, UDP_DISCOVERY_PORT } from '../shared/constants.ts';
import { listLanAddresses } from '../platform/net-profile.ts';
import { encodeBeaconOffer, parseBeaconMessage, type BeaconOffer } from '../discovery/protocol.ts';

export interface BeaconOptions {
  serviceId: string;
  instanceId: string;
  /** 实际监听的 TCP 端口。漂移后必须是新值，取实时值而不是装配时的快照。 */
  httpPortOf: () => number;
  revisionOf: () => number;
  port?: number;
  name?: string;
}

export class DiscoveryBeacon {
  private socket: Socket | null = null;

  constructor(private readonly options: BeaconOptions) {}

  async start(): Promise<void> {
    if (this.socket !== null) return;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    // 单个网卡不可达（VPN 断开、Hyper-V 虚拟网卡）不该让整个信标挂掉。
    socket.on('error', () => undefined);
    socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
      this.answer(socket, msg, rinfo);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        socket.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        socket.removeListener('error', onError);
        resolve();
      };
      socket.once('error', onError);
      socket.once('listening', onListening);
      socket.bind(this.options.port ?? UDP_DISCOVERY_PORT, '0.0.0.0');
    });
  }

  async stop(): Promise<void> {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    await new Promise<void>((resolve) => {
      socket.close(() => resolve());
    });
  }

  private answer(socket: Socket, msg: Buffer, rinfo: RemoteInfo): void {
    const parsed = parseBeaconMessage(msg);
    if (parsed === null || parsed.type !== 'query') return;

    const offer: BeaconOffer = {
      magic: BEACON_MAGIC,
      type: 'offer',
      nonce: parsed.nonce,
      serviceId: this.options.serviceId,
      instanceId: this.options.instanceId,
      name: this.options.name ?? hostname(),
      httpPort: this.options.httpPortOf(),
      revision: this.options.revisionOf(),
      addrs: listLanAddresses(),
    };
    const payload = encodeBeaconOffer(offer);
    socket.send(payload, 0, payload.length, rinfo.port, rinfo.address, () => undefined);
  }
}
