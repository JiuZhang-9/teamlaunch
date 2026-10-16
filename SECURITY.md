# 安全策略（SECURITY.md）

## 报告漏洞

请使用 GitHub 的 **Security Advisories（私有漏洞报告）**，或在本仓库开一个
不含细节的 Issue 约定私下沟通。请勿在公开 Issue 中附可复现的攻击细节。

当前为试点阶段项目，请仅在自己的测试环境验证，不要对不属于自己的网络与
主机做测试。

## 已知的安全边界（设计决策，非漏洞）

以下内容是**当前版本的公开设计决策**（详见
`docs/decisions/OPEN-DECISIONS.md` 与 `docs/decisions/ADR-006-security-model.md`），
在适用场景内使用是安全的，超出场景请自行评估：

1. **安装包未做代码签名**（D-01）：Windows SmartScreen 会告警；正式推广前
   计划采购签名证书。请只从本项目 Releases 页下载安装包。
2. **同步协议为局域网明文 HTTP + HMAC 签名 + 口令挑战应答**（D-02 / ADR-006）：
   设计目标为可信的专用/域网络（公司内网）。**不要**在公用网络或不可信网段中
   使用；跨地点办公场景尚未支持。
3. **同步服务只应监听局域网**：防火墙入站规则限 `LocalSubnet`，诊断页会检测
   网络配置文件（公用网络下规则不生效）。
4. **管理员口令**：无默认口令，最低 8 位；忘记口令需先彻底退出应用后删除
   `%APPDATA%\TeamLaunch\credential.json` 重设（见 `docs/DELIVERY.md`）。
5. **自动更新走 GitHub Releases**（ADR-009）：更新包从 `github.com` 直取（HTTPS + 官方 CDN），
   靠 Release 上的 `latest.yml` 做版本判定与 sha512 校验；管理员机内嵌服务降级为
   **局域网镜像**（明文 HTTP，仅在局域网内做同版本加速 / GitHub 不可达时回落）。
   **这是本项目唯一的第三方外网出口**——每次检查会访问 `github.com`，不携带设备标识，
   与使用数据统计无关；公司内网若限制 GitHub，更新会自动改走镜像。是否提供"不自动检查更新"
   开关见 `docs/decisions/OPEN-DECISIONS.md` O-07。

## 适用范围

本声明覆盖本仓库 main 分支的代码与官方 Releases 发布的安装包。第三方构建、
修改版不在覆盖范围内。
