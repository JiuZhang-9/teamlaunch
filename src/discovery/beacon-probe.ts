/**
 * src/discovery/beacon-probe.ts —— L2：UDP 广播探测 + 单播应答收集
 *
 * 为什么是"员工发、管理员答"（ADR-002 的决定性理由）：
 * Windows 防火墙对**自己发出的 UDP 的应答**做状态放行，员工机因此不需要
 * 任何入站规则；反过来就要给每台员工机开规则，"下载即用"直接崩塌。
 *
 * 两个实现细节：
 *   1. 目标地址是「255.255.255.255 + 每张网卡的定向广播地址」各发一份。
 *      多网卡机器（VPN / Hyper-V）上只发全局广播会漏掉某些网段。
 *   2. 端点地址取**应答包的源地址**（rinfo.address），而不是 offer 里带的
 *      addrs[0]：源地址是"我确实从这个地址收到了包"，比自报的地址可信。
 */

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { BEACON_MAGIC, DISCOVERY_TIMEOUTS, UDP_DISCOVERY_PORT } from '../shared/constants.ts';
import { listLanInterfaces } from '../platform/net-profile.ts';
import {
  encodeBeaconQuery,
  newNonce,
  parseBeaconMessage,
  type BeaconOffer,
  type DiscoveredEndpoint,
} from './protocol.ts';

export interface BeaconProbeOptions {
  deviceId: string;
  timeoutMs?: number;
  port?: number;
}

interface OfferHit {
  offer: BeaconOffer;
  /** 应答包的源地址。 */
  from: string;
}

export async function probeBeacon(options: BeaconProbeOptions): Promise<DiscoveredEndpoint[]> {
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUTS.l2BeaconProbeMs;
  const port = options.port ?? UDP_DISCOVERY_PORT;
  const nonce = newNonce();
  const socket: Socket = createSocket({ type: 'udp4', reuseAddr: true });

  const hits: OfferHit[] = [];
  socket.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
    const parsed = parseBeaconMessage(msg);
    // nonce 不匹配即丢弃：那是上一轮探测的迟到应答，或者是别人伪造的包。
    if (parsed === null || parsed.type !== 'offer' || parsed.nonce !== nonce) return;
    if (hits.some((h) => h.from === rinfo.address && h.offer.httpPort === parsed.httpPort)) return;
    hits.push({ offer: parsed, from: rinfo.address });
  });

  try {
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
      socket.bind(0);
    });

    socket.setBroadcast(true);
    const payload = encodeBeaconQuery({
      magic: BEACON_MAGIC,
      type: 'query',
      nonce,
      anonDeviceId: options.deviceId,
    });

    const targets = ['255.255.255.255', ...listLanInterfaces().map((i) => i.broadcast)];
    await Promise.all(
      targets.map(
        (target) =>
          new Promise<void>((resolve) => {
            socket.send(payload, 0, payload.length, port, target, () => resolve());
          }),
      ),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  } finally {
    await new Promise<void>((resolve) => socket.close(() => resolve()));
  }

  return hits.map(({ offer, from }) => ({
    baseUrl: `http://${from}:${offer.httpPort}`,
    host: from,
    port: offer.httpPort,
    serviceId: offer.serviceId,
    instanceId: offer.instanceId,
    revision: offer.revision,
    name: offer.name,
  }));
}
