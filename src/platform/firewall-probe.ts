/**
 * src/platform/firewall-probe.ts —— 防火墙规则巡检（K-01）
 *
 * 只做**只读巡检**：规则是否存在、是否启用、适用于哪些配置文件。
 * 创建规则是提权安装器的职责（ADR-004），运行时不申请提权、不弹 UAC。
 *
 * 为什么用 PowerShell 而不是 netsh：`netsh advfirewall` 的输出**随系统语言本地化**
 * （中文 Windows 上是「规则名称:」「已启用:」「配置文件:」）。按英文标签解析会在
 * 目标机器上静默地永远解析不到——这类失效最难发现：规则明明在，诊断却报缺失。
 * PowerShell cmdlet 的属性名不随 UI 语言变化，因此这里走 `Get-NetFirewallRule`。
 *
 * 诚实边界（K-02）：报"规则存在且启用"**不等于**员工机连得上。同主机回环不经过
 * 入站规则，本机自连自检必然假阳性。真实连通必须由第二台机器验证，见 peerCheckHint。
 */

import { FIREWALL_RULE_NAMES } from '../shared/constants.ts';
import { runCommand } from './process-runner.ts';

export interface FirewallRuleState {
  name: string;
  exists: boolean;
  enabled: boolean;
  profiles: string[];
  /** 巡检命令本身没跑起来时为 true。用于区分"规则缺失"与"查不到"。 */
  unknown: boolean;
}

/**
 * 一次 PowerShell 调用查两条规则，输出形如 `名称|存在|启用|配置文件`。
 * 用管道分隔而不是依赖人类可读格式，避免解析受区域设置影响。
 */
function buildScript(): string {
  const names = [FIREWALL_RULE_NAMES.tcp, FIREWALL_RULE_NAMES.udp];
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
  return (
    `$n=@(${list}); ` +
    `foreach($x in $n){ $r=Get-NetFirewallRule -DisplayName $x -ErrorAction SilentlyContinue; ` +
    `if($r){ "$x|1|$($r.Enabled)|$($r.Profile)" } else { "$x|0||" } }`
  );
}

export async function probeFirewallRules(): Promise<FirewallRuleState[]> {
  const names = [FIREWALL_RULE_NAMES.tcp, FIREWALL_RULE_NAMES.udp];
  const unknownAll = (): FirewallRuleState[] =>
    names.map((name) => ({ name, exists: false, enabled: false, profiles: [], unknown: true }));

  if (process.platform !== 'win32') return unknownAll();

  const result = await runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', buildScript()]);
  if (result.exitCode !== 0 || result.timedOut || result.spawnFailed) return unknownAll();

  const byName = new Map<string, FirewallRuleState>();
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.includes('|')) continue;
    const [name, exists, enabled, profiles] = trimmed.split('|');
    byName.set(name, {
      name,
      exists: exists === '1',
      enabled: enabled?.trim().toLowerCase() === 'true',
      profiles: (profiles ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
      unknown: false,
    });
  }

  return names.map(
    (name) =>
      byName.get(name) ?? { name, exists: false, enabled: false, profiles: [], unknown: false },
  );
}
