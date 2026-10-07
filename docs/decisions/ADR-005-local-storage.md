# ADR-005: 本机存储：JSON 文档 + 原子写

## Status

Accepted（2026-09-29）｜ 决策人：高见远 ｜ 影响：安装可靠性、打包体积、长期数据规模

## Background

本机需要持久化五类数据：团队配置缓存、个人入口、发布历史与快照、图标/资源缓存、反馈与埋点队列。

候选：JSON 文档 + 原子写 / SQLite（better-sqlite3）/ IndexedDB·localStorage。

MVP 规模上限明确（PRD §13 与 §14）：**团队入口 ≤ 200 条、分组 ≤ 8 个**，个人入口在数百条量级。

核心约束：本项目已经承担 Windows 防火墙、服务发现、图标提取三处系统性风险，不应再引入第四个。

## Decision

**采用 JSON 文档 + 进程内内存索引 + 临时文件 rename 的原子写。不引入任何 Node-API 原生模块。**

### 为什么不选 SQLite（better-sqlite3）

| 维度 | JSON + 原子写 | SQLite |
|---|---|---|
| 安装/打包 | 零风险 | 需按 Electron ABI 重新编译；Windows 还需 VS Build Tools 与 Python，安装失败率显著 |
| 团队协作成本 | 无 | CI 与目标机必须保持一致工具链 |
| 原子写与事务 | 自实现（写 tmp → fsync → rename） | 原生事务，更强 |
| 数据量上限 | ≤ 5000 条舒适 | 无上限 |
| debug 成本 | 打开文件即可看 | 需命令行或工具 |

better-sqlite3 是优秀的库，但它把"能否装上"变成了交付风险。而在 ≤700 条数据的量级下，SQLite 带来的查询能力几乎用不上。这是典型的"用安装可靠性去换当前用不上的查询能力"。

### 文件布局（全部位于 `app.getPath('userData')`，Windows 下 `%APPDATA%\TeamLaunch`）

```
settings.json            本机设置（**只放用户意图**，字段集见 ARCHITECTURE §5.2）
discovery.json           发现缓存：上次成功的端点（ADR-002 L1）+ 上次网段扫描时间
identity.json            deviceId / anonId / 安装时间
credential.json          仅管理员：scrypt 派生参数与 verifier
cache/team-current.json  团队配置缓存（员工端只读；管理员端为权威源）
config/personal.json     个人入口（本机，永不进网）
revisions/index.jsonl    变更记录追加日志（滚动保留最近 20 条）
revisions/0000000128.json 发布快照（滚动保留最近 20 个）
assets/<hash前2位>/<hash>.png  图标缓存与同步资源
outbox/feedback.jsonl    待发送反馈队列
events/events.jsonl      本地埋点环形缓冲
logs/main.log
```

### 为什么端点记忆单独放 `discovery.json`（不进 `settings.json`）

`settings.json` 是**用户意图**（角色、热键、遥测开关），`discovery.json` 是**机器维护的高频状态**（上次连上的端点、上次 L3 扫描时间）。分开的理由是写入频率与所有权不同：

- 端点记忆每次成功同步都可能变，是 30 秒量级的高频写；用户设置是月量级。
- 混在一个文件里，"重置设置"会顺手清掉端点记忆，"保存设置"又会和发现逻辑抢同一把写入锁。
- 一个事实只允许一个写入点。`settings.json` 里**不再保留** `knownEndpoints` 字段（原设计稿有，已删除），端点记忆的唯一所有者是 `discovery.json`。

写入纪律：`discovery.json` **不得**每轮轮询都重写。仅在 `baseUrl` / `serviceId` / `instanceId` 变化时写入，或距上次写入 ≥ 5 分钟才刷新时间戳——否则员工端会每 30 秒做一次 tmp+fsync+rename，长时间运行后是实打实的磁盘写放大。

内容只含 `baseUrl` / `serviceId` / `instanceId` / 时间戳，**不含任何设备标识或个人信息**。

### 索引策略（JSON 方案下的等效做法）

- **内存即主索引**：启动时全量读入，建立 `Map<groupId, Group>`、`Map<entryId, Entry>`，以及搜索用的归一化联想表（名称/关键词/分组名/路径末级/域名，统一小写 + 去符号）。搜索因此是纯内存过滤，满足 AC-04 的 300 ms 门槛且不触发任何磁盘 IO。
- **写入**：全量序列化 + 原子替换。MVP 规模下单次 < 5 ms。
- **滚动**：`index.jsonl` 超过 20 条时重写为新文件并原子替换；快照文件同步删除超出范围的旧文件。
- **无效检查替代索引**：不做渲染期 `existsSync` 预检查（ADR-007 与 T4 说明其为性能与主程阻塞风险源），一律点击时异步判断。

### 三条硬规则

1. **写盘必须原子**：`write(tmp)` → `fsync` → `rename(tmp, target)`。任何中断都不留下半截文件。
2. **禁止任何 `*Sync` IO**：尤其 `fs.existsSync`。对已下线的 UNC 共享路径或断线映射盘，同步 IO 会阻塞主线程数十秒，表现为整个应用假死。一律 `fs.promises` + `Promise.race` 超时（本地 500 ms / UNC 1500 ms）。
3. **仓储层隔离**：所有文件读写只出现在 `src/main/repositories/`。上层依赖 repository 接口而非具体文件格式，这是迁移唯一需要做好的准备。

## Consequences

**正面**
- 零原生模块 ⇒ 打包链路最简，是 ADR-001 敢选最新 Electron 线的前提条件之一。
- 所有数据文件人类可读可查，现场排障不需要工具；"错误信息可复制"（PRD §14 可维护性）天然满足。
- 原子写 + fsync 已覆盖断电/崩溃这两个真实场景；更强的事务语义 MVP 用不到。

**负面与代价**
- 全量重写意味着单点改动也会重写整个文件；在当前规模下无害，规模变大后成为主要成本。
- 无并发控制，依赖"单进程写入 + 单实例锁"这一前提（ADR-004 已保证）。
- 复杂查询能力缺失；搜索是自建内存索引而非 SQL，随着字段变多维护成本会上升。

**迁移触发条件（作为长期约定）**：团队入口 > 2000 条，或个人入口 > 5000 条，或需要跨条件的复杂查询/SQL 能力。触发时只替换 `src/main/repositories/*` 的实现，service 层与 API 契约不变。

## Related ADRs

- ADR-001（打包方案）—— 零原生模块是轻量安装的前提
- ADR-003（同步协议）—— 三重闸门后的原子落盘由本 ADR 保证
- ADR-007（图标策略）—— 图标缓存使用本 ADR 的 assets 布局
