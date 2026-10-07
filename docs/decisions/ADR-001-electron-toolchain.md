# ADR-001: Electron 版本与 Windows 打包方案

## Status

Accepted（2026-09-29）｜ 决策人：高见远 ｜ 影响：全局

## Background

TeamLaunch 是 Windows 优先的 Electron 桌面启动器，需要三重能力：

1. 应用必须在局域网监听 TCP 端口提供同步服务，并必须绑定 UDP 端口做服务发现 —— 这些都依赖本机对局域网开放入站访问，而 Windows 默认拒绝。
2. **Windows 防火墙入站规则**必须在提升权限时创建。这是本项目最可能"跑不起来"的点（详见 ADR-004）。
3. PRD §16.3 要求"试点管理员能独立完成编辑、发布、查看反馈，不依赖改文件或命令行"，安装包必须把系统级配置一次性做完。

Electron 官方支持 3 条产品线（当前为 42/43/44），选择面有限。npm 与官方发布页核实于 2026-09-29：

| 版本 | 发布日期 | Chromium | Node.js | 状态 |
|---|---|---|---|---|
| 44.4.5 | 2026-09-23 | 152.0.7977.130 | 24.21.0 | 当前 latest 稳定线 |
| 43.7.5 | 2026-09-23 | 150.0.7871.250 | 24.21.0 | 稳定线 |
| 42.11.8 | 2026-09-23 | 148.0.7778.280 | 24.19.0 | 稳定线，临近 EOL |

## Decision

**选用 Electron 44.4.5，打包使用 electron-builder 26.15.3 的 NSIS target，自更新使用 electron-updater 6.8.9。**

### 为什么选 Electron 44.4.5

- 它是当前 `latest` dist-tag 对应的版本，拥有一条最长的支援跑道（42 线已临近 EOL，如果从 42 起步，MVP 还没上线就要迁移）。
- 本项目**零 Node-API 原生模块**（见 ADR-005），因此 Electron 版本升级带来的 ABI 重编译风险完全不存在，这是敢选最新线的关键前提。
- 44 捆绑 Node 24.21.0，与 Vite 8 / React 19 / TypeScript 7 工具链无冲突。

**已知代价**：Electron 44 有两项破坏性变更直接影响本项目，必须写入开发约束：
1. `clipboard` 模块不再直接暴露给渲染进程（W3C Clipboard API 对齐）。复制诊断信息、复制反馈文案必须经 preload IPC 通道。
2. 更新到 Chromium 152，需在本机验证 Windows 10 22H2 兼容性（风险登记 R17）。

**回退方案**：若 Win10 22H2 冒烟失败或出现阻塞性问题，整体降级到 Electron 43.7.5 并更新本 ADR，不前拨到 42（EOL 太近）。

### 为什么选 electron-builder + NSIS

| 维度 | electron-builder NSIS | Electron Forge Squirrel |
|---|---|---|
| 安装包是否提权运行 | 是（可创建防火墙规则） | 通常不提权 |
| Windows 安装形态控制 | 强（自定义安装目录、静默参数、 perMachine 选项） | 弱 |
| 自启动注册路径 | 直接指 `app.getPath('exe')`，稳定 | 必须指上一级 Squirrel stub，易错 |
| 自更新 | electron-updater（成熟） | Squirrel 增重式更新 |
| 现成踩坑答案 | 多 | 少 |

决定性理由是第一条：**防火墙规则必须在提权安装阶段创建**。NSIS 安装器天然满足，Squirrel 不满足。

## Consequences

**正面**
- 安装即用，员工端零手工配置；管理员端不须再单独跑一遍提权脚本。
- electron-updater 可直接利用 electron-builder 的更新元数据通道。
- 自启动 `app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe'), enabled: true })` 路径稳定，不需要 Squirrel stub 的特例处理。

**负面与代价**
- 代码签名证书尚未确定。未签名的 NSIS 安装包在 Windows 上会触发 SmartScreen 警告。MVP 试点可接受（实验室分发），正式推广前必须解决。这是未决项，已列入 §TODO。
- Electron 44 的 clipboard 破坏性变更要求所有"复制"能力走 IPC，多约 20 行 boilerplate。
- 依赖 Electron 快节奏发版：大约每三个月就有一条产品线退休，需要有固定的季度升级窗口。

## Related ADRs

- ADR-004（内嵌服务形态与 Windows 防火墙策略）—— 本决策使其可行
- ADR-005（本机存储）—— 零原生模块是选择最新 Electron 线的前提
- ADR-002（服务发现）—— 依赖本决策的 UDP 17891 入站规则

## TODO（未决，需产品与设计共同确认）

- Windows 代码签名证书采购与 CI 签名流水线（阻塞正式分发，不阻塞 MVP 试点）。
- Electron 43.7.5 回退触发条件的确认人与时点。
