# Spec - TeamLaunch v1.0（规格契约）

> 生成日期：2026-09-29
> 基于：PRD v1.1（787 行）+ ARCHITECTURE v1.4（1155 行）+ UIUX v1.1（1363 行）+ ADR-001..008
> 状态：**已锁定**——用户于 2026-09-29 确认三文档及全部决策项
> 性质：规格即契约。开发以本文件为唯一依据，任何变更先改本文件再改代码。

---

## 0. 用户已确认的决策（不可推翻，开发不得质疑）

| # | 决策项 | 结论 | 影响 |
|---|---|---|---|
| D-01 | 客户端形态 | Electron 桌面端，Windows 优先 | 可启动 exe / 打开文件夹 / 调起浏览器 |
| D-02 | 同步落点 | 同步服务**内嵌在管理员客户端**进程内 | 零额外部署；保留迁独立服务器的 4 项预留 |
| D-03 | 管理员编辑入口 | 客户端内可视化编辑并一键发布 | 不做独立后台网页、不改配置文件 |
| D-04 | 身份识别 | 设备标识 + 管理员口令，无账号体系 | 不做注册登录、不做 SSO |
| D-05 | 视觉方向 | 方向 A「石墨工具台」 | 石墨中性色 + 电光青蓝强调色 |
| D-06 | 主题默认 | 跟随系统，读取失败兜底深色 | 双主题 Token 均已定义 |
| D-07 | 安全强度 | **接受 HMAC 写请求签名替代 TLS** | 正式替代 PRD §14「TLS + JWT」条款，记录于 ADR-006 |
| D-08 | 代码签名 | 先不签名，小范围试点 | SmartScreen 会告警，不阻塞试点 |
| D-09 | 价值验证 | 用户本人即管理员，自用两周验证 | RICE 置信度可用实测回填 |

### 0.1 项目总监补充裁决（3 项技术细节，已闭环）

- **C-01 复制路径分隔符**：诊断信息中复制给用户的路径一律用 Windows 反斜杠（`D:\共享\2026 归档`）。理由：用户直接粘进资源管理器地址栏即可用，正斜杠虽被多数场景接受但会造成困惑。
- **C-02 遥测首启事件丢失**：`clientId` 在首次启动时本地预生成并持久化；首启事件不立即上报，而是进入 `events.jsonl` 缓冲，待**首次成功同步**时随批量一起补发。这样既不丢事件，也不需要为它单独改 ADR-008 的数据结构。
- **C-03 分组超过 8 组**：主窗口内容区纵向滚动，不做折叠、不做分页、不做标签页切换。PRD §11.2 补记此条。

---

## 1. 产品定义

- **一句话**：Windows 桌面端团队统一入口启动器——管理员一处发布软件、文件夹、网页三类入口，全员一致；管理员离线时每人仍能用本机缓存照常打开。
- **目标用户**：10–50 人内网团队。管理员多为行政或 IT 兼职（非专职运维）；员工覆盖技术与非技术岗位。
- **核心问题**：团队入口分散在群发的快捷方式、浏览器书签、口述路径和共享盘里；谁装了什么、链接还活不活着无人知晓，新员工无人告知，失效只能靠群里喊。

---

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

三个 Epic：**统一入口工作区**、**团队内容发布与离线同步**、**失效诊断与反馈闭环**。

| 编号 | P0 功能 | 验收标准摘要 | RICE |
|---|---|---|---|
| P0-01 | 双工作区 | 顶部并列「团队入口」「我的入口」Tab，首次默认团队页；团队页无编辑控件 | 5.00 |
| P0-02 | 三类入口卡片 | 软件 / 文件夹 / 网页统一卡片骨架，类型图标 + 文字双重区分 | 5.00 |
| P0-03 | 单层分组与排序 | 管理员维护团队分组与顺序，个人页独立维护，不做嵌套 | 5.00 |
| P0-04 | 一键打开与错误解释 | 点击交给系统打开；本机可判定的失败显示原因、建议与诊断详情 | 5.00 |
| P0-05 | 失效反馈 | 可选 5 种原因上报；离线进待发送队列，恢复后自动重试 | 4.27 |
| P0-06 | 搜索与全局热键 | 默认 `Ctrl+Space`；匹配标题、关键词、分组、路径末级/域名；冲突可改键 | 5.00 |
| P0-07 | 个人入口管理 | 本机增删改移，支持 JSON 导出/导入，冲突不静默覆盖 | 5.00 |
| P0-08 | 管理员编辑模式 | 设备标识 + 口令解锁；员工只读；编辑态显式标记 | 4.29 |
| P0-09 | 可视化编辑与发布 | 客户端内编辑、校验、预览变更摘要、一键发布 | 4.29 |
| P0-10 | 版本同步与缓存 | 启动拉取 + 手动刷新 + 30 秒轮询；无变化不重绘；失败用最近成功缓存 | 4.29 |
| P0-11 | 发布记录 | 每次记录时间、版本、变更摘要，保留最近 20 条；只查看不做一键回滚 | 4.29 |
| P0-12 | Windows 常驻与入口采集 | 可选开机自启、托盘常驻（打开/刷新/退出）；手选 exe/快捷方式 + 开始菜单扫描 | 4.29 |

---

## 3. 明确不做（Out-of-Scope——锁定）

| 不做项 | 原因 | 何时考虑 |
|---|---|---|
| 账号注册 / 手机号 / 邮箱 / SSO | 与 D-04 轻量身份冲突 | 跨网络、跨组织或需人员级审计 |
| 独立服务器 / NAS / 云端同步 | 用户已锁定内嵌方案（D-02） | 管理员离线造成 SLA 不可接受或团队 >50 人 |
| 部门/岗位可见性 | MVP 全员同页，权限矩阵成本过高 | 出现敏感入口或多部门 >50 人 |
| 个人入口自动跨设备同步 | 无账号难安全映射身份 | 导出/导入抱怨持续出现时 |
| 两层及以上分组 | 会变成新目录树，增加路径记忆 | 单层 8 组不够时优先考虑标签而非嵌套 |
| 一键安装或软件分发 | 涉及授权、管理员权限、包可信度 | 有专职 IT 且明确需要终端管理 |
| 任意脚本 / 插件市场 / 自定义命令 | 引入执行安全与兼容性风险 | 三类入口稳定且有审核机制后 |
| 团队聊天 / 公告 / 审批 / 文档编辑 | 不替代协同套件 | 不考虑，仅允许链接跳转 |
| 实时推送（长连接 / WebSocket） | MVP 30 秒轮询已满足 AC-08 | 45 秒延迟不可接受时 |
| TLS 加密通道 | D-07 已接受 HMAC 替代 | 出现敏感入口、网络不可信或跨地点办公 |
| 一键回滚历史版本 | 回滚也以新增 revision 实现，不做独立回滚分支 | 发布错误率 >2% 且手工修复影响明显 |
| macOS / 移动端 | 超出 Windows 优先范围 | 有明确跨平台需求 |

---

## 4. 技术架构（锁定——含版本锚定）

| 层 | 技术 | 版本 | 锁定原因 |
|---|---|---|---|
| 桌面运行时 | Electron | **44.4.5**（Chromium 152.0.7977.130 / Node 24.21.0），回退 43.7.5 | 主进程可直接起 HTTP 服务；Windows 生态成熟 |
| 打包 | electron-builder NSIS | **26.15.3** | 决定性理由：防火墙规则必须在**提权安装阶段**创建（ADR-004） |
| 自更新 | electron-updater | **6.8.9** | 与 electron-builder 同源 |
| 服务 HTTP 层 | Fastify | **5.12.5** | 比 Express 更轻、Schema 校验内建（示例选型，非指定） |
| 服务发现 | UDP 广播 + 单播应答，四级阶梯 L0→L3 | 自实现，UDP **17891** | **否决 mDNS**：它要求每台员工机开 UDP 5353 入站，摧毁零配置前提 |
| 同步协议 | revision 整数 + contentHash + ETag/304 | TCP **17890–17899** | 版本闸门式全量拉取，避开字段级 diff 的沉默逻辑错误 |
| 本机存储 | JSON 文档 + 内存索引 + 原子写 | 自实现 | 不上 SQLite：MVP 规模 ≤700 条，单次写 <5ms（ADR-005） |
| 渲染层 | React | **19.3.0** | — |
| 构建 | Vite | **8.3.1** | — |
| 样式 | Tailwind CSS | **4.3.3** | Token 通过 CSS 变量注入 |
| 无头组件 | Radix UI | **1.6.7** | 无障碍与键盘行为 |
| 类型与校验 | TypeScript + zod | **5.9.3（已回退，原定 7.0.2）** / **4.6.5** | D-04 已触发：`typescript-eslint@8.71.0` peer `>=4.8.4 <6.1.0` 与 TS 7.0.2 冲突致 ERESOLVE 失败。**开发必须按 5.9.3 的 API 写代码，不得使用 TS 7 特有语法或编译器行为**。zod 同时用于 API 与本地文档校验 |
| 图标库 | **lucide-react** | **1.48.0** | 全项目唯一图标源；Tabler 例外 ≤5 且须登记 |

**代码组织铁律**（出现即退回）：
1. `src/server/**` 禁止 import electron（迁移可行性守卫，可 grep 硬校验）
2. 单文件 ≤300 行
3. 入口文件不得含业务逻辑，只做装配
4. 依赖只向下：`routes → controllers → services → repositories`

---

## 5. API 端点清单（锁定——开发唯一依据）

基址 `http://<管理员主机>:<17890..17899>/api/v1/`，统一信封 `{code, data, message}`，`code=0` 成功。完整契约见 `docs/api/openapi.yaml`（**1106 行，13 操作 / 32 schema，终版非草稿**）。端点 2 的 404（`ERR_NOT_FOUND`）表示**服务可达但尚无团队配置**，其处理口径见本节下方与 §13 变更记录。

**两个补充字段（表格未展开，实现必须遵守）**：

- 端点 9 `POST /revisions/{rev}/restore` 请求体为 `RestoreRequest { baseRevision }`。还原同样必须走乐观并发——否则管理员 A 打开还原对话框期间，B 发布的内容会被静默覆盖。
- 端点 13 `GET /diagnostics` 响应含 `topIssue` 与 `checks[]`，由服务端直接判定最可能根因，优先级为
  `SERVICE_NOT_LISTENING > PUBLIC_NETWORK_PROFILE > FIREWALL_RULE_MISSING > PORT_DRIFTED > DATA_INTEGRITY_FAILED > PEER_UNVERIFIED > NONE`。
  其中 `PUBLIC_NETWORK_PROFILE` **刻意排在 `FIREWALL_RULE_MISSING` 之前**：公用网络下防火墙规则是「已创建」状态的，先报规则缺失会让管理员盯着一条正常规则反复排查（这正是已知坑 K-01 的现场表现）。

| # | Method | Path | 功能 | 认证 |
|---|---|---|---|---|
| 1 | GET | `/health` | 存活探测，发现后确认端口 | 无 |
| 2 | GET | `/config` | 拉取团队配置（支持 `If-None-Match`，304 空体） | 无 |
| 3 | GET | `/changes` | 变更记录增量 `?since&limit≤20` | 无 |
| 4 | GET | `/assets/{hash}` | 图标资源，不可变，长缓存 | 无 |
| 5 | POST | `/auth/challenge` | 申请挑战（拿 salt 与 kdf 参数） | 无 |
| 6 | POST | `/auth/verify` | proof 换令牌（8 小时有效） | 无 |
| 7 | PUT | `/config` | 发布新版本 | Bearer + **HMAC 签名** |
| 8 | GET | `/revisions` | 发布历史 `?limit≤20` | Bearer + 签名 |
| 9 | POST | `/revisions/{rev}/restore` | 以指定版本内容**生成新版本** | Bearer + 签名 |
| 10 | POST | `/feedback` | 员工上报失效（可离线排队） | 仅 deviceId 限流 |
| 11 | GET | `/feedback/summary` | 按入口聚合失效反馈 | Bearer + 签名 |
| 12 | POST | `/telemetry` | 匿名埋点批量上报 | 仅 deviceId 限流 |
| 13 | GET | `/diagnostics` | 巡检（监听地址、实际端口、防火墙规则、活动网络配置文件） | Bearer + 签名 |

**关键错误码**：`ERR_REVISION_CONFLICT`(409) 发布版本冲突 · `ERR_INSTANCE_MISMATCH`(409) 连错数据源 · `ERR_SIGNATURE_INVALID`(401) 签名不通过 · `ERR_VALIDATION_FAILED`(422) 附字段路径 · `ERR_PAYLOAD_TOO_LARGE`(413) 超 1MB 或超容量上限 · `ERR_RATE_LIMITED`(429)

---

## 6. 数据模型（锁定）

存储根目录：`%APPDATA%\TeamLaunch\`（`app.getPath('userData')`）

**团队配置文档**（同时是同步报文体）：
`schemaVersion` · `instanceId` · `revision`（单调递增，永不复用）· `contentHash`（sha256，排除 revision/contentHash 后计算）· `publishedAt` · `groups[]`

- Group：`id` · `name` · `sort` · `entries[]`
- Entry：`id` · `type`(app|folder|web) · `name` · `description` · `keywords[]` · `sort` · `target`（app/folder）· `sourcePath`（原始 lnk，用于重新解析）· `args` · `cwd` · `expandEnv` · `url`（仅 web）· `icon.kind`(local|asset|fallback) · `iconAssetHash` · `updatedAt`

**`icon.kind` 语义（关键设计，不得改）**：
- `local`：每台客户端按自己的 target **本地提取**，不跨网同步（管理员机器上提取的 exe 图标对没装该软件的员工无意义，且放大流量）
- `asset`：随服务下发（favicon、管理员上传图标）
- `fallback`：本地生成首字单体图

**其他文件**：
- `settings.json` —— **人写人读**（`role` 默认 `member`，安全默认值）· `serviceUrl` · `autoLaunch` · `trayEnabled` · `hotkey` · `pollIntervalMs` · `editIdleTimeoutMs` · `theme` · `telemetryEnabled` · `telemetryNoticeAckedAt` · `iconCacheVersion` · `deletedConflictPolicy`
- `discovery.json` —— **机器写机器读**，服务发现 L1 的端点记忆（含 lastSuccess/failCount/冷却时间戳），约 30 秒量级高频覆写。**刻意与 settings.json 分离**：混在一起会导致用户设置被高频覆写、备份/迁移时携带陈旧端点、且无法单独删除重置
- `identity.json` · `credential.json`（仅管理员，scrypt 参数与 verifier）· `cache/team-current.json` · `config/personal.json` · `revisions/index.jsonl`（保留 20 条）+ 快照（滚动 20 个）· `assets/` · `outbox/feedback.jsonl` · `events/events.jsonl`

**版本序列铁律**：只增不减，回滚也必须新增 revision → 历史始终线性，客户端不需要任何"版本回退"分支。

**K-11 scrypt 参数必须客户端夹紧（安全硬约束，不得省略）**：线上存在"局域网内冒名实例"的场景——攻击者起一个假服务，在 `POST /auth/challenge` 里回 `N=2^20`，客户端照单派生就会去申请约 1GB 内存，主线程卡死，表现为"双击应用就假死"，且没有日志、没有报错、无法解释。

因此客户端**必须**对 challenge 返回的 `N/r/p` 做上下界夹紧后再派生（N 上界 2^15、p 上界 1、派生内存上限 64MB）。缺了这道夹紧，KDF 参数就成了可被对端单方面控制的内存放大攻击面。

---

## 7. 页面 / 视图清单（锁定）

| 视图 | 核心组件 | 对应 API |
|---|---|---|
| 团队入口页 | MainWindowShell · TitleBar · Toolbar · PageTabs · GroupHeader · CardGrid · EntryCard · SyncIndicator(**8 态**) | GET /config |
| 我的入口页 | 同上，PageTabs 第二项 | 本地 personal.json |
| 迷你唤起面板（Ctrl+Space） | MiniPalette · ResultRow | 本地索引 |
| 窗口内搜索 | SearchInput · SearchResultsState | 本地索引 |
| 管理员编辑态 | EditActionBar · PublishDialog | PUT /config |
| 设置面板 | SettingsPanel（热键/自启/托盘/遥测开关） | 本地 |
| 反馈对话框 | FeedbackDialog · FeedbackStatus(PENDING/SENT/DROPPED) | POST /feedback |
| 隐私说明门 | PrivacyGate（未确认前不发送任何上报） | 本地 |
| 诊断页 | 巡检信息展示 | GET /diagnostics |
| 空 / 离线 / 错误态 | EmptyState · OfflineState · ErrorState | — |

组件分层（前端必须按此拆分）：
- Atoms：Button · Input · SearchInput · Icon · Badge · TypeTag · SourceTag · Skeleton · Spinner · Divider
- Molecules：EntryCard · CardGrid · ResultRow · GroupHeader · StatusPill · SyncIndicator · MenuItem · Toast · Banner · EmptyBlock · FeedbackStatus
- Organisms：TitleBar · Toolbar · PageTabs · MiniPalette · EditActionBar · PublishDialog · SettingsPanel · FeedbackDialog · PrivacyGate

每个组件必须实现状态矩阵至少：Default / Hover / Focus / Active / Disabled / Loading / Error / Selected。

---

## 8. 设计 Token（锁定）

- **主色（电光青蓝，色相 205°）**：浅色交互 `#106696`、浅色强调文本 `#0D5278`；深色交互 `#3890CE`、深色强调文本 `#4FA8DC`
- **刻意避开**：Tailwind 默认 Indigo `#6366F1`、常见 `#3B82F6`、紫粉系全部
- **字体**：Inter Variable（latin 子集）+ **Noto Sans SC**（GB2312 子集，400/510，SIL OFL）+ JetBrains Mono（版本号/路径/诊断）
- **字重仅三级**：400 / 510 / 590
- **字号**：8 级 11→28px，正文 14px，卡片标题 13px/510，副标签 12px
- **主题**：跟随系统；读取失败兜底深色。双主题 Token 全集已交付
- **窗口**：主窗口 **1040 × 720**，最小 704 × 480。1040 宽 = 6×152 卡片 + 5×16 间距（恰整除 6 列）；内容区高 576 = 4×132 + 3×16（恰整除 4 行）→ **默认一屏 24 张卡片零滚动**
- **图标**：lucide-react 1.48.0，24×24 / stroke 2 / round cap / currentColor；尺寸阶梯 12/16/20/24px；57 个图标清单见 UIUX §6.2
- **Token 交付物**：`docs/design-system/design-tokens.css` + `.json`（前端直接 import）

---

## 9. 验收标准（EARS 格式——QA 唯一依据）

| 编号 | 功能 | EARS 验收标准 | 优先级 |
|---|---|---|---|
| AC-01 | 分层 | While 用户处于员工模式，打开主窗口时系统**必须**显示两个并列 Tab 且默认团队页、团队内容无编辑控件 | P0 |
| AC-02 | 打开 | When 用户单击任一有效卡片，系统**必须**以对应默认方式打开且主窗口保持可继续操作 | P0 |
| AC-03 | 类型识别 | When 用户查看卡片或搜索结果，系统**必须**同时呈现类型图标与类型文字，关闭颜色辨识后仍可区分 | P0 |
| AC-04 | 搜索 | When 用户按热键并输入关键词，系统**必须**在 300ms 内给出首批本地结果且 Enter 可打开 | P0 |
| AC-05 | 热键冲突 | If `Ctrl+Space` 已被占用，系统**必须**告知冲突并引导改键，且不得反复弹窗或静默抢占 | P0 |
| AC-06 | 发布 | While 口令验证通过，When 管理员确认发布，系统**必须**先展示校验与变更摘要，成功后生成更高版本并新增记录 | P0 |
| AC-07 | 校验失败 | If 存在空名称、非法 URL 或缺失目标，系统**必须**阻止发布、定位问题项并保留其他编辑 | P0 |
| AC-08 | 在线同步 | When 管理员发布新版本，在线员工端**必须**在 p95 45 秒内软更新并保留当前 Tab、搜索词与滚动位置 | P0 |
| AC-09 | 无变化 | While 本地版本与服务端一致，后台轮询**必须**不替换列表、不改变焦点、不显示干扰提示 | P0 |
| AC-10 | 离线缓存 | If 管理员不可达且本机曾有成功同步，系统**必须**在 3 秒内展示缓存并标注离线与缓存时间，卡片仍可点击 | P0 |
| AC-11 | 首次离线 | If 从未成功同步且管理员不可达，系统**必须**显示空状态、手动刷新按钮与「我的入口」入口，不得显示空白页 | P0 |
| AC-12 | 本机失效 | If 软件或文件夹目标在本机不存在，系统**必须**不崩溃、不无限加载，并给出原因与重新定位/复制诊断/反馈入口 | P0 |
| AC-13 | 反馈 | When 员工提交失效反馈，在线**必须**进入管理员待处理列表，离线**必须**标记待发送并在恢复后自动重试 | P0 |
| AC-14 | 导入 | If 导入 JSON 非法或损坏，系统**必须**不改动现有个人数据并给出可复制的错误说明 | P0 |
| AC-15 | 冲突 | When 导入遇到 ID 冲突，系统**必须**让用户选择跳过/覆盖/另存副本，不得静默覆盖 | P0 |
| AC-16 | 安全 | If 写请求签名不通过，服务端**必须**拒绝；UI 隐藏编辑入口不得被视为安全边界 | P0 |
| AC-17 | 防火墙 | If 活动网络为公用配置文件，系统**必须**在诊断页提示并提供切换引导，不得静默失败 | P0 |
| AC-18 | 隐私 | While 用户未确认隐私说明，系统**必须**不发送任何上报；关闭遥测**必须**立即停止记录并清空缓冲 | P0 |

---

## 10. 边界与约束

- **容量硬上限（服务端强制）**：单份配置 ≤1MB、≤8 个分组、≤200 个入口
- **性能**：首屏 ≤1.5s；搜索首批结果 ≤300ms；离线缓存展示 ≤3s；30 秒轮询，p95 更新 ≤45s
- **网络**：服务仅监听内网，防火墙规则限定 `-RemoteAddress LocalSubnet` 且只作用于 Domain/Private 配置文件
- **端口**：TCP 17890–17899（自动探测，真实端口靠信标广播），UDP 17891（发现）
- **系统**：Windows 10 22H2 及以上；不支持公用网络下的服务暴露
- **管理员机器硬前提**：至少一次提权安装（创建防火墙入站规则）。做不到解压即用的绿色版
- **离线边界**：离线不阻塞本地软件与文件夹打开；网页能否打开由实际网络决定
- **零外网出口**：产品不向任何外网域名发送数据（可验证硬约束）

---

## 11. 内嵌已知坑（开发前必读，逐条规避）

| # | 坑 | 根因 | 修法 |
|---|---|---|---|
| K-01 | 防火墙规则在公用网络配置文件下不生效 | Windows 按网络类型应用规则 | 诊断页检测 + 引导切换 + 一键提权修复（**最高频现场故障**） |
| K-02 | 本机自连自身 IP 的自检不可信 | 回环不经过防火墙入站规则 | 真实验证**必须由第二台机器**完成 |
| K-03 | mDNS 被否决 | 要求每台员工机开 UDP 5353 入站，摧毁零配置前提 | 改用 UDP 广播 + 单播应答四级阶梯 |
| K-04 | `exec` / `shell:true` 命令注入与解析错误 | 路径含空格、中文、特殊字符 | 无参走 `shell.openPath`；带参走 `spawn` 数组传参且 `shell:false` |
| K-05 | 同步 IO 卡死主线程 | UNC 下线路径 `*Sync` 调用可阻塞数十秒 | **禁止一切 `*Sync` IO** |
| K-06 | 首屏被击穿 | 渲染期对 200 个入口做 stat 预检查 | 禁止渲染期预检查，改为点击时判定 |
| K-07 | 内置浏览器打开内网系统失败 | 内置 Chromium 是独立 profile，内网 SSO 失效 | 网页**一律走外部浏览器** |
| K-08 | 图标提取拖垮性能 | 同步 exe 图标既无意义又放大流量 | `icon.kind=local` 本地提取，不跨网同步 |
| K-09 | Electron 44.4.5 发布仅 6 天 | 新版本未经充分验证 | Phase 2 第一天先做 Win10 22H2 冒烟，出问题整体降级 43.7.5 |
| K-10 | TypeScript 7.0.2 是新编译器主线 | `typescript-eslint@8.71.0` peer 区间 `>=4.8.4 <6.1.0` 与其冲突 | **已触发并已回退至 5.9.3**（D-04 Closed）。开发按 5.9.3 API 写代码；重新评估条件：`typescript-eslint` 发布支持 TS 7 的主版本，且 Vite 8 / Tailwind 4 / electron-vite 均无报错 |

---

## 12. 端到端验证步骤（Spec 锁定的最后一项）

```bash
# 1. 安装依赖并构建
npm install
npm run build

# 2. 管理员机：以管理员权限运行安装器（关键：防火墙规则在此阶段创建）
#    安装后在管理员机启动应用，设置中启用「管理员角色」并设置口令

# 3. 管理员机：解锁编辑模式，新增 1 个软件 + 1 个文件夹 + 1 个网页入口，发布
#    断言：返回 200 且 revision 递增，发布记录新增一条

# 4. 第二台机器（必须与步骤 2 不同机，K-02）：安装并启动
#    断言：3 秒内展示步骤 3 发布的三个入口；顶部显示「已同步」而非离线

# 5. 核心成功流：点击三个入口
#    断言：软件启动 / 资源管理器打开 / 外部浏览器打开网页；主窗口仍可操作

# 6. 关键错误流：管理员再改一次并发布，员工端不手动刷新
#    断言：45 秒内自动软更新，且当前 Tab 与滚动位置保留（AC-08）

# 7. 离线流：关闭管理员机上的应用或断开网络，重启员工端
#    断言：3 秒内展示缓存，顶部显示「离线，数据时间 HH:mm」，卡片仍可点击（AC-10）

# 8. 安全流：在员工机用 curl 直接 PUT /api/v1/config（不带签名）
curl -X PUT http://<管理员主机>:17890/api/v1/config -H "Content-Type: application/json" -d '{}'
#    断言：返回 401 ERR_SIGNATURE_INVALID，团队配置未变更（AC-16）

# 9. 防火墙流：把管理员机网络切换为「公用」，重启员工端
#    断言：进入离线态且诊断页给出网络配置文件提示（AC-17）
```

---

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|---|---|---|---|
| 2026-09-29 | Spec v1.0 生成，锁定 12 项 P0、13 个 API、技术栈版本、设计 Token、18 条 AC | 基于用户已确认的三文档与 9 项决策 | 全局基线 |
| 2026-09-29 | 安全方案由「TLS + JWT」正式变更为「HMAC 写请求签名」 | 用户决策 D-07，论证见 ADR-006 §"等价机制" | API 鉴权链路、ADR-006 |
| 2026-09-29 | 补充裁决 C-01/C-02/C-03 | 三专家交叉对齐遗留的技术细节 | 诊断文案、遥测上报、分组展示 |
| 2026-09-30 | **首次发布前 `GET /config` 返回 404 的处理口径**：同步层翻译为「一次成功的同步 + 空配置」（revision 视为 0，`groups: []`），UI 判定 `groups.length === 0` 走正常空状态「团队入口还没有内容」；`hasCache` 保持"本机是否曾有成功缓存"的纯净语义，不借壳表达"从未发布"。**不新增第 9 个同步态**——状态机只描述同步链路，不描述内容多少；加态会让语义膨胀并多一条 QA 验收项 | 后端实测发现的契约缺口 | 同步层、AC-11 空状态 |
| 2026-09-30 | **TypeScript 由 7.0.2 回退至 5.9.3** | `typescript-eslint@8.71.0` 的 peer 为 `>=4.8.4 <6.1.0`，与 TS 7.0.2 冲突导致 npm ERESOLVE 失败。按 §11 K-10 执行整体回退；保住 TS 语法 lint 比编译器版本号重要 | 构建工具链 |
