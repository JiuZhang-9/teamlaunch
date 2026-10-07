/**
 * src/services/diagnostics.service.ts —— 一屏定位的巡检（Spec 端点 13）
 *
 * 设计取向：管理员遇到问题时第一反应就是打开它，因此这里**直接给出结论**
 * （topIssue），而不是把一堆原始指标丢给人自己推理。
 *
 * topIssue 优先级是写死的（架构 §14.2）：
 *   SERVICE_NOT_LISTENING > PUBLIC_NETWORK_PROFILE > FIREWALL_RULE_MISSING
 *   > PORT_DRIFTED > DATA_INTEGRITY_FAILED > PEER_UNVERIFIED > NONE
 *
 * PUBLIC_NETWORK_PROFILE 刻意排在 FIREWALL_RULE_MISSING 之前：公用网络下防火墙规则
 * 是"已创建且已启用"的，先报规则缺失会让管理员盯着一条正常规则反复排查（K-01）。
 *
 * K-02 的诚实边界写进 peerCheckHint：本机自连自身 IP 的自检不可信（回环不经过
 * 入站规则），真实连通必须由第二台机器验证。服务端不假装自己能验。
 */

import {
  DIAGNOSTIC_CHECK_IDS,
  PREFERRED_TCP_PORT,
  TCP_PORT_RANGE,
  TOP_ISSUE_PRIORITY,
} from '../shared/constants.ts';
import type { NetworkProfile } from '../platform/net-profile.ts';
import { listLanAddresses, readActiveNetworkProfile } from '../platform/net-profile.ts';
import { probeFirewallRules, type FirewallRuleState } from '../platform/firewall-probe.ts';
import type { TeamConfigService } from './team-config.service.ts';
import type { TelemetryService } from './telemetry.service.ts';

export type DiagnosticCheckId = (typeof DIAGNOSTIC_CHECK_IDS)[number];
export type TopIssue = (typeof TOP_ISSUE_PRIORITY)[number];

export interface DiagnosticCheck {
  id: DiagnosticCheckId;
  title: string;
  passed: boolean;
  detail: string;
  hint?: string;
}

export interface DiagnosticInfo {
  topIssue: TopIssue;
  checks: DiagnosticCheck[];
  listening: { address: string; port: number };
  expectedPortRange: string;
  portDrifted: boolean;
  instanceId: string;
  revision: number;
  uptimeSec: number;
  firewallRules: FirewallRuleState[];
  activeNetworkProfile: NetworkProfile;
  lanAddresses: string[];
  knownClientCount: number;
  telemetryCompleteness: ReturnType<TelemetryService['completeness']>;
  peerCheckHint: string;
}

export interface DiagnosticsOptions {
  listenAddress: string;
  listenPort: number;
  instanceId: string;
  startedAt: number;
  /**
   * 服务是否在监听。默认 true（能应答本请求的必然在监听）。
   * 员工端自己渲染诊断页时传 false —— 那是"我连不上"的场景，
   * 此时 topIssue 必须是 SERVICE_NOT_LISTENING（优先级第一位）。
   */
  serviceListening?: boolean;
}

export const PEER_CHECK_HINT =
  '本机自连自身 IP 的连通性测试不可信（回环不经过入站规则）。真实连通必须由第二台机器验证。';

export class DiagnosticsService {
  constructor(
    private readonly teamConfig: TeamConfigService,
    private readonly telemetry: TelemetryService,
    private readonly options: DiagnosticsOptions,
  ) {}

  async inspect(): Promise<DiagnosticInfo> {
    const [firewallRules, networkProfile] = await Promise.all([
      probeFirewallRules(),
      readActiveNetworkProfile(),
    ]);
    const lanAddresses = listLanAddresses();

    const listening = { address: this.options.listenAddress, port: this.options.listenPort };
    const portDrifted = listening.port !== PREFERRED_TCP_PORT;
    const dataIntegrity = this.teamConfig.integrityOk();
    const serviceListening = this.options.serviceListening !== false;

    const checks: DiagnosticCheck[] = [
      {
        id: 'SERVICE_LISTENING',
        title: '同步服务监听中',
        passed: serviceListening,
        detail: serviceListening ? `已在 ${listening.address} 上监听` : '未收到服务的应答',
        hint: serviceListening ? undefined : '确认管理员客户端正在运行，且已开启同步服务',
      },
      {
        id: 'PORT_RANGE',
        title: '端口在预期区间内',
        passed: !portDrifted,
        detail: portDrifted
          ? `当前端口不在首选端口上，实际端口由信标广播，客户端可自适应`
          : `端口处于 ${TCP_PORT_RANGE.start}-${TCP_PORT_RANGE.end} 区间首选位`,
        hint: portDrifted ? '若长期漂移，检查是否有其他程序占用首选端口' : undefined,
      },
      {
        id: 'FIREWALL_RULES',
        title: '防火墙入站规则已创建',
        passed: firewallRules.every((r) => r.exists && r.enabled),
        detail: describeRules(firewallRules),
        hint: firewallRules.every((r) => r.exists && r.enabled)
          ? undefined
          : '以管理员权限重新安装，或在设置页使用「修复防火墙规则」',
      },
      {
        id: 'NETWORK_PROFILE',
        title: '活动网络配置文件可用',
        passed: networkProfile !== 'Public' && networkProfile !== 'Unknown',
        detail: describeProfile(networkProfile),
        hint: networkProfile === 'Public'
          ? '当前为公用网络，防火墙规则不生效。请在系统设置中把网络切换为专用网络'
          : undefined,
      },
      {
        id: 'LAN_ADDRESSES',
        title: '已获取局域网地址',
        passed: lanAddresses.length > 0,
        detail: lanAddresses.length > 0 ? `本机局域网地址 ${lanAddresses.length} 个` : '未找到局域网 IPv4 地址',
        hint: lanAddresses.length > 0 ? undefined : '检查网络连接，或确认未处于仅回环的网络环境',
      },
      {
        id: 'DATA_INTEGRITY',
        title: '配置内容校验通过',
        passed: dataIntegrity,
        detail: dataIntegrity ? '当前配置的内容哈希自洽' : '当前配置内容与内容哈希不一致',
        hint: dataIntegrity ? undefined : '请重新发布一次以重建内容哈希',
      },
    ];

    const completeness = this.telemetry.completeness();

    return {
      topIssue: decideTopIssue({
        serviceListening,
        firewallRules,
        networkProfile,
        portDrifted,
        dataIntegrity,
        knownClientCount: completeness.configDeviceCount,
      }),
      checks,
      listening,
      expectedPortRange: `${TCP_PORT_RANGE.start}-${TCP_PORT_RANGE.end}`,
      portDrifted,
      instanceId: this.options.instanceId,
      revision: this.teamConfig.revision,
      uptimeSec: Math.max(0, Math.round((Date.now() - this.options.startedAt) / 1000)),
      firewallRules,
      activeNetworkProfile: networkProfile,
      lanAddresses,
      knownClientCount: completeness.configDeviceCount,
      telemetryCompleteness: completeness,
      peerCheckHint: PEER_CHECK_HINT,
    };
  }
}

interface TopIssueInput {
  serviceListening: boolean;
  firewallRules: FirewallRuleState[];
  networkProfile: NetworkProfile;
  portDrifted: boolean;
  dataIntegrity: boolean;
  knownClientCount: number;
}

/**
 * 按固定优先级取第一个命中的原因。顺序本身是产品决策，不要"优化"它。
 */
export function decideTopIssue(input: TopIssueInput): TopIssue {
  if (!input.serviceListening) return 'SERVICE_NOT_LISTENING';
  if (input.networkProfile === 'Public') return 'PUBLIC_NETWORK_PROFILE';

  const rulesMissing = input.firewallRules.some((r) => !r.exists || !r.enabled);
  if (rulesMissing) {
    // 规则"查不到"（巡检命令没跑起来）时不下 FIREWALL_RULE_MISSING 的结论：
    // 那会把管理员引向重装，而实际问题可能是 PowerShell 被策略禁用。
    if (input.firewallRules.every((r) => r.unknown)) return 'PEER_UNVERIFIED';
    return 'FIREWALL_RULE_MISSING';
  }
  if (input.portDrifted) return 'PORT_DRIFTED';
  if (!input.dataIntegrity) return 'DATA_INTEGRITY_FAILED';
  if (input.knownClientCount === 0) return 'PEER_UNVERIFIED';
  return 'NONE';
}

function describeRules(rules: FirewallRuleState[]): string {
  if (rules.every((r) => r.unknown)) return '未能读取防火墙规则状态';
  const missing = rules.filter((r) => !r.exists).map((r) => r.name);
  const disabled = rules.filter((r) => r.exists && !r.enabled).map((r) => r.name);
  if (missing.length > 0) return `缺少规则：${missing.join('、')}`;
  if (disabled.length > 0) return `规则已创建但未启用：${disabled.join('、')}`;
  const profiles = rules.flatMap((r) => r.profiles);
  return `两条规则均已启用（适用配置文件：${[...new Set(profiles)].join('、') || '未报告'}）`;
}

function describeProfile(profile: NetworkProfile): string {
  switch (profile) {
    case 'Domain':
      return '活动网络为域网络，防火墙规则适用';
    case 'Private':
      return '活动网络为专用网络，防火墙规则适用';
    case 'Public':
      return '活动网络为公用网络，防火墙规则不生效';
    default:
      return '未能确定活动网络配置文件';
  }
}
