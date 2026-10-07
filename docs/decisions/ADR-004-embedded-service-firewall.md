# ADR-004: 内嵌服务形态与 Windows 防火墙策略

## Status

Accepted（2026-09-29）｜ 决策人：高见远 ｜ 影响：可用性（最高风险项）、安装流程、终生支持成本

## Background

用户已拍板：同步服务**内嵌在管理员客户端进程内**，不单独部署服务器或 NAS，但要保留将来迁到独立机器的能力。

这带来三个必须在架构层解决的问题：

1. Windows 防火墙默认拦截未授权进程的入站连接。一个监听 TCP 端口的 Electron 应用，默认从别的机器上连不上。这是**本项目最容易"做完发现跑不起来"的坑**。
2. 管理员可能同时开着 VPN / Hyper-V / Docker，产生多张虚拟网卡，暴露面需要收敛。
3. 服务必须随开机启动（"管理员不在岗"是常态运营场景之一），而窗口关闭不应停止服务。

## Decision

### 1. 服务形态：Fastify 5.12.5 实例跑在 Electron 主进程

- 仅当 `settings.role === 'admin'` 且 `settings.syncEnabled` 为真时启动。
- 监听 `0.0.0.0`（必须，否则局域网不可达），端口在 **17890–17899** 内自动探测。
- **实际端口由 ADR-002 的 UDP 信标对外广播**，因此端口漂移不影响发现。
- `app.requestSingleInstanceLock()` 必须在启动逻辑最前面调用，否则重复启动会争抢端口并产生两个互相覆盖的数据源。
- **管理员端不得因"窗口全部关闭"而退出**：role 为 admin 时不清空也不 quit，改为驻留托盘。窗口关闭 = 服务停止是 PRD 明确不允许的隐性行为。

选 Fastify 而非 Express 或裸 `node:http`：本项目 HTTP 层需要的不是性能，而是 **zod/JSON Schema 单一来源 → Fastify 校验 → @fastify/swagger 生成 openapi.yaml** 这条链路，让 API 契约无法与实现漂移。

### 2. 与 UI 的通信：本机走 IPC，远端走 HTTP

- 本机 UI → IPC；其他客户端 → HTTP；两条路径落到同一个 service 层。
- 收益：不为本机流量再开一次 HTTP 校验与潜在的防火墙/代理干扰；将来服务外迁时只需把本机 UI 的传输换成带令牌的 HTTP，业务层零改动。

### 3. 防火墙：提权安装阶段创建两条规则

```powershell
netsh advfirewall firewall delete rule name="TeamLaunch Sync TCP" | Out-Null
New-NetFirewallRule -DisplayName "TeamLaunch Sync TCP" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 17890-17899 -Profile Domain,Private -RemoteAddress LocalSubnet

netsh advfirewall firewall delete rule name="TeamLaunch Discovery UDP" | Out-Null
New-NetFirewallRule -DisplayName "TeamLaunch Discovery UDP" -Direction Inbound -Action Allow `
  -Protocol UDP -LocalPort 17891 -Profile Domain,Private -RemoteAddress LocalSubnet
```

四个关键点，缺一不可：

1. **必须在提权的安装阶段创建。** 运行时再申请提升权限会弹 UAC 且不可预期，是糟糕的首次体验。这是 ADR-001 选择 NSIS 而非 Squirrel 的决定性理由。
2. **`-RemoteAddress LocalSubnet`** 把来源限制在同子网，避免 VPN / 虚拟网卡带来的额外暴露面。
3. **`-Profile Domain,Private`** 是权衡结果：不放 Public 是安全要求，但这也意味着**活动网络为公用配置文件时规则不生效**——这是现场最高频故障，必须由诊断页检测并引导切换。
4. **先删后加**保证重装幂等，不会产生重复规则。

兜底修复：设置页提供"修复防火墙规则"，通过提权 PowerShell 重执行一次（会弹 UAC）。

### 4. 自检的诚实边界

**本机自连自身 LAN IP 的连通性测试不可信**——同主机回环不经过入站规则，会给出假阳性。因此：
- 诊断页可以报告：实际监听地址与端口、规则是否存在、规则是否启用、规则适用的配置文件、活动网络配置文件。
- 但**真正的连通性验证必须由第二台机器完成**，这一点写进端到端验收步骤（ADR-003 / 架构文档 §12），不允许靠自检通过就放行。

### 5. 迁移预留（唯一要做的四件事）

1. 所有远端访问只能经 `discovery/endpoint-resolver.ts` 解析出的 `baseUrl`；`settings.serviceUrl` 优先级最高。
2. **`src/server/**` 与 `src/discovery/**` 禁止 `import 'electron'`** —— 该目录可被 `node` 直接拉起成为独立服务。这是可 grep 的硬约束。
3. API 从第一天起带 `/api/v1/` 前缀，不兼容变更新增 `/api/v2/`，v1 并行至少 6 个月。
4. 响应携带 `instanceId` / `serviceId`，客户端可识别数据源切换。

除此之外**不为将来写任何代码分支**。

## Consequences

**正面**
- 员工端零配置（无防火墙规则、无 IP 记忆、无网络配置文件修改）。
- 暴露面被 `-RemoteAddress LocalSubnet` 与 `Domain,Private` 双重收敛。
- 迁移到独立机器时不需要重写任何协议或客户端逻辑。

**负面与代价**
- **至少一次提权安装是硬性前提**，做不到零文件的绿色安装。这一点必须在试点说明里讲清楚，属于对用户明确的告知项。
- 公用网络配置文件下不工作，且这类故障的默认表现是"静默超时"，必须靠诊断页显式暴露。
- 第三方杀软/EDR 可能在 Windows 防火墙之外再加一层拦截，本方案无法自动绕过，只能由诊断流程收集信息。
- 端口需在 17890–17899 范围内，不能任意指定；已在文档中显式占用并登记避免冲突。

## Related ADRs

- ADR-001（打包方案）—— 提权安装的前提
- ADR-002（服务发现）—— UDP 17891 规则服务于它
- ADR-003（同步协议）—— TCP 端口承载它
- ADR-006（安全模型）—— 明文 HTTP 下的等价保护
