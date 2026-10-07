# TeamLaunch 架构技术方案（ARCHITECTURE.md）

版本：v1.8 ｜ 日期：2026-09-30 ｜ 作者：高见远（首席架构师）
配套文档：`docs/SPEC.md`（team-lead 锁定）、`docs/PRD.md`（v1.1）、`docs/UIUX.md`、`docs/decisions/ADR-*.md`、`docs/decisions/OPEN-DECISIONS.md`、`docs/api/openapi.yaml`（**终版 FINAL**）、`src/shared/schema.ts`（zod 契约）、`docs/DELIVERY.md`
适用平台：Windows 10 22H2 及以上、Windows 11 当前与上一主版本

> 本文是"规格即契约"意义上的可执行架构约束，不是选型说明文。凡是本文点名的文件路径、接口、版本号、禁止项，开发必须照做；与之冲突时先改本文再改代码。

变更记录：
- v1.0（2026-09-29 初版）：技术选型、八大难题方案、API 与数据模型。
- v1.1（同日）：对齐 PRD v1.1 的四条确认项 —— 新增 T3.6 同步状态机（禁止状态误导）、§11.1 埋点零外网出口三层防线、§11.2 服务端日志禁写来源 IP、§11.3 首次隐私说明状态门与更严格的关闭语义；风险登记新增 R18–R20；端到端验证新增第 11、12 组。
- **v1.2（同日）：对齐 PRD §5.4.1 与"数据完整度"指标** —— T3.6 状态集扩展为 7 态并补齐 PRD 要求的离线有/无缓存、同步失败未知三类语义（配 `offlineReason` / `hasCache` 两个由同步服务写入的伴随字段）；新增 T3.7 反馈投递状态（禁止谎报"已上报成功"）；新增 §11.4 遥测完整度自证（丢弃率与设备覆盖率的可机器计算口径，随 `/api/v1/diagnostics` 暴露）；openapi.yaml 同步新增 `TelemetryBatch.clientStats` 与 `DiagnosticInfo.telemetryCompleteness`；端到端验证扩至第 13、14 组；ADR-008 补充完整度自证段落。
- **v1.3（同日）：登记遥测样本不可判定时的既定路径** —— 风险登记新增 R21（`sampleJudgable` 长期为 false 时回到 P1「管理员内容健康中心 + 逐项人工确认」，**不得以此为由改用云端/第三方埋点**，并附推翻门槛）与 R22（残缺样本硬判定导致管理员删改正常入口，已被条件判定机制根除）；ADR-008 同步登记同一路径与其不可推翻的理由。技术选型与接口本次无变更。
- **v1.4（同日）**：输出文案映射的正式键名并锁定隐私门口径 —— 新增 T3.6.1 `offlineReason` 四值枚举（`SERVICE_NOT_FOUND` / `CONNECTION_BLOCKED` / `NETWORK_UNREACHABLE` / `UNKNOWN`）+ 可检出性说明 + "禁止显示原始错误码/堆栈/端口/IP"；新增状态 `SYNC_DATA_REJECTED`，并明确"返回数据校验失败"是状态而非离线原因；§11.3 隐私门定为**零记录**（不预缓冲、不内存暂存、未确认前磁盘无遥测文件），并登记零记录对首次事件指标的代价与两个待 PM 裁定的处理方案。openapi.yaml 本次无变更（`offlineReason` 属客户端本地状态，不进服务端契约）。
- **v1.5（同日）：Phase 2 契约落地与可验证化** —— ① `docs/api/openapi.yaml` 审定去 Draft：补 `operationId`、错误信封（`error` / `details` / `diagnosticId` + `ErrorCode` 枚举）、分页参数、限流响应头、`Entry` 按 `type` 拆 `oneOf` + discriminator；`/diagnostics` 新增 `topIssue` 与 `checks[]`，让自用管理员首屏就能区分"服务没起来 / 公用网络 / 防火墙规则缺失 / 端口漂移 / 数据校验失败 / 对端未认证"；`POST /revisions/{revision}/restore` 补 `RestoreRequest.baseRevision`（还原同样受乐观并发保护，否则会静默覆盖他人发布）。② 新增契约文件 `src/shared/schema.ts`（zod 4.6.5）作为前后端唯一契约入口，定义按资源拆分到 `src/shared/schema/*.ts`（受 §3.2 单文件 ≤300 行约束，`schema.ts` 本身只做 re-export）。容量闸门（≤8 组 / ≤200 入口 / ≤1 MB）、入口 id 全局唯一、遥测 props 键名黑名单、时间必须带 Z 全部写进 schema。③ 新增两个**可执行的契约校验门** `scripts/verify-openapi.cjs` 与 `scripts/verify-schema.mjs`（见 §14.1），契约漂移不再靠人肉核对。④ ADR-006 状态补充：用户于 2026-09-29 确认 HMAC 签名作为 PRD §14「TLS + JWT 或经架构师确认的等价机制」条款的正式替代，TLS 保留 P1。⑤ 新增 §14 Spec 交叉索引（端点 1–13、坑位 K-01–K-10 与本文章节的双向对照）。
- **v1.7（2026-09-30）：按已发生的事实回写版本锚定** —— ① §1.1 TypeScript 从"7.0.2（回退 5.9.3）"改为**"5.9.3（已回退）"**：D-04 已真实触发，触发插件 `typescript-eslint@8.71.0`（peer `typescript ">=4.8.4 <6.1.0"` 与 7.0.2 冲突，npm ERESOLVE 失败，已核实），按 Spec §11 K-10 整体回退，team-lead 已批准；开发必须按 5.9.3 的 API 写代码。② `OPEN-DECISIONS.md` D-04 状态由 Decided 改为 **Closed（已回退）**，记录触发插件、原因与重新评估条件。③ §1.1 前置说明补"两个 Node 版本不要混淆"：运行时由 Electron 44.4.5 内置 Node 24.21.0 提供，开发机最低 22.18（`engines.node` 已放宽），22.18+ 默认开启类型剥离故校验门可直接 import `.ts`。④ §14.4 新增 **K-11**（scrypt 参数夹紧）及其可验证用例。
- **v1.8（同日）：把依赖锚定变成可执行约束** —— 起因是一起真实事故：`fastify` 装进了 node_modules 却从未写进 package.json，后来有人跑 `npm install`，npm 把它当多余包**静默裁掉**，内嵌服务当场起不来（现象与原因隔着一层，review 看不出来）。新增第三个校验门 `scripts/verify-deps.mjs`（`npm run verify:deps`，已接进 `verify:all`）：① 扫 `src/` 与 `scripts/` 的 import，**import 了但 package.json 没声明即红灯**；② 声明版本出现 `^`/`~`/`*`/区间即红灯（`@types/*` 除外，不进产物）；③ 从 §1.1 锚定表解析出的依赖若未安装必须在脚本内显式登记延期理由，防止"打包时才发现没装 electron-builder"。该门一跑即抓到 `fastify ^5.12.5` 与 `js-yaml ^4.1.0` 两处未写死（后者是我自己用 `npm i --save-dev` 装时默认带上 `^` 造成的），均已改为精确版本。当前 §1.1 中 7 项尚未安装，已全部登记延期理由（含 `@fastify/swagger` 接入时**不得**覆盖 openapi.yaml 的规定）。
- **v1.6（同日）：收口后端落地暴露的三处契约分叉** —— ① ADR-006 新增 §1.1（scrypt `maxmem` 必须显式给 64 MiB：N=2^15/r=8 实际用量 33,555,456 B 比默认上限 33,554,432 B **多 1,024 B**，已实测）与 §1.2（线上 `N/r/p` 必须先夹紧再派生，否则伪造 `N=2^20` 即可让管理员机器分配 1 GB 内存，是不需要口令的 DoS）。② 端点记忆归属收口到 `discovery.json`（ADR-002 L1、ADR-005 文件布局、§5.1），**删除 `settings.knownEndpoints`**——一个事实不允许两个写入点；同时补写节流纪律（不得每轮轮询重写）。③ §5.2 字段集与 `SettingsSchema` 对齐：`telemetryUpload` 改名 **`telemetryEnabled`**（原名会被读成"只控制上传"，而 AC-18 要求关闭即停止记录并清空缓冲），补齐 `editIdleTimeoutMs` / `theme` / `iconCacheVersion` / `deletedConflictPolicy`。④ 新增 T3.6.2：`GET /config` 的 404（服务可达但未发布）必须走空状态且 `offlineReason=null`，**不得显示为离线**；openapi 同步补该分支的 404 说明与"服务恒不会返回 SERVICE_NOT_LISTENING"的说明。

---

## 0. 产品边界锁定（来自 PRD，架构不得推翻）

| 结论 | 含义（架构必须满足） |
|---|---|
| 客户端 Electron 桌面端，Windows 优先 | 单平台交付，不抽象跨平台层 |
| 同步服务内嵌在管理员客户端进程内 | 服务与 UI 同进程；但必须保留迁往独立机器的能力 |
| 管理员在客户端内可视化编辑并发布 | 编辑走 IPC，不要求改配置文件 |
| 身份 = 设备标识 + 管理员口令，无账号体系 | 无注册、无邮箱、无 SSO |
| 团队页单向同步 | 员工端在任何路径上都不得回写团队配置 |
| 完整校验后才替换缓存 | 校验失败保留上一份可用缓存 |

### 0.1 本次明确不做（out-of-scope）

以下项进入架构禁止清单，出现即退回：

1. 账号、邮箱、SSO、手机号。
2. 独立服务器 / NAS / 云端同步（仅预留迁移位，不做实现）。
3. 个人页跨设备同步。
4. 两层及以上分组。
5. 嵌套子页面式的复杂管理后台；本项目只有主窗口 + 搜索面板 + 设置 + 诊断。
6. 一键安装软件 / 软件分发。
7. 任意脚本执行、插件系统、自定义命令。
8. **以管理员权限（提权）打开目标** —— PRD §13 明确"不自动提权"。MVP 不实现 `runAsAdmin`。
9. 内置浏览器窗口（详见 T4.3，MVP 一律外部浏览器）。
10. 自动判定网页业务可用性（仅反馈 URL 与系统交接结果）。
11. 互联网远程访问同步服务。
12. macOS / Linux / Web / 小程序端。
13. 第三方互联网埋点服务（原因见 T9 埋点章节）。

---

## 1. 版本锚定（Version Pinning）

所有版本号于 2026-09-29 通过 `npm view <pkg> version` 与 Electron 官方发布页核实，非记忆推测。实现时必须按下列版本的 API 编写。

**两个 Node 版本不要混淆**：应用**运行时**由 Electron 44.4.5 内置 Node **24.21.0** 提供；**开发机**（跑 lint / typecheck / 校验门）最低 **22.18**（`engines.node`），本机实测 v22.22.2。22.18+ 已默认开启 Node 类型剥离，因此 `npm run verify:schema` 可直接 import `.ts` 源文件。统一用户开发机的 Node 版本不在可控范围，故 `engines` 取下限而非要求升级。

### 1.1 运行时与框架

| 依赖 | 版本 | 用途 | 核实来源与备注 |
|---|---|---|---|
| electron | **44.4.5** | 桌面运行时 | npm `dist-tags.latest`；Chromium 152.0.7977.130 / Node.js **24.21.0**（应用运行时由它提供） |
| electron-builder | **26.15.3** | Windows NSIS 打包 | 同一直线维护版 |
| electron-vite | **5.0.0** | 主/预加载/渲染进程构建 | 三进程 Vite 构建 |
| electron-updater | **6.8.9** | 应用自更新 | 与 electron-builder NSIS 产物配套 |
| fastify | **5.12.5** | 内嵌同步服务 HTTP 框架 | Node HTTP 封装，纯 Node 无原生模块 |
| @fastify/swagger | **9.9.0** | 由 JSON Schema 生成 openapi.yaml | 保证契约与实现不漂移 |
| react / react-dom | **19.3.0** | 渲染层 | — |
| vite | **8.3.1** | 渲染层构建（经 electron-vite） | 需 Node 20.19+，本机 Node v22.22.2 满足 |
| typescript | **5.9.3**（**已回退**，原定 7.0.2） | 类型系统 | **D-04 已触发**：`typescript-eslint@8.71.0` 的 peer 为 `typescript ">=4.8.4 <6.1.0"`，与 7.0.2 冲突，npm ERESOLVE 失败。按 Spec §11 K-10 整体回退 5.9.3（已实测确认 peer 区间）。**开发必须按 5.9.3 的 API 写代码，不得使用 TS 7 特有语法或编译器行为** |
| zod | **4.6.5** | 请求/配置/校验的唯一 Schema 来源 | 主进程与 Fastify 共用 |
| **lucide-react** | **1.48.0** | **唯一图标库（已锁定）** | 见 §1.3 |
| tailwindcss / @tailwindcss/vite | **4.3.3** | 样式 | v4 Vite 插件方案 |
| radix-ui | **1.6.7** | 对话框/菜单/气泡等无样式交互原语 | 无障碍（WCAG 2.1 AA）由它兜底 |
| @electron-toolkit/utils | **4.0.0** | `is dev` 等 Electron 辅助 | — |
| @electron-toolkit/typed-ipc | **1.0.2** | IPC 类型契约 | 主/preload/renderer 共享类型 |
| node-html-parser | **9.0.4** | 解析网页首页取 favicon link | 轻量，无原生模块 |
| js-yaml | **4.1.0** | **仅 devDependency**：契约校验门解析 openapi.yaml | 不进产物，见 §14.1 |

### 1.2 明确不引入的依赖

| 不引入 | 原因 |
|---|---|
| better-sqlite3 / 任何 Node-API 原生模块 | Electron 需按 ABI 重新编译，Windows 上需 VS Build Tools，是本项目最大的安装与打包风险源。MVP 数据规模远不需要它（见 T6.1） |
| bonjour-service / multicast-dns | Windows 防火墙与组播不可用问题，见 ADR-002 |
| express | 相比 Fastify 缺内建 Schema 校验，无法由 Schema 直接生成 openapi.yaml |
| electron-store | 我们只需要受控的原子写 + 明确目录布局，自行实现更可控（≤120 行） |
| 第三方互联网埋点 SDK | 见 T9；内部工具不应把数据出网 |

### 1.3 图标库锁定（P0 硬规则）

**锁定：lucide-react 1.48.0。** 全项目唯一图标来源，任何 other icon library / iconfont / 内联自绘 SVG 图标 / emoji 一律禁止。

- 许可证 ISC，24px 网格 + 2px 描边，tree-shaking 后单图标约 1 kB。
- 图标尺寸规范：**16px（行内文本）／20px（按钮内）／24px（独立图标）**。这三个尺寸封装为 `renderer/src/components/Icon.tsx` 的三个 size token，禁止在业务组件里直接写 `size={}`。
- 卡片类型图标与状态图标必须同时配文字标签（PRD AC-03：关闭颜色辨识后仍可区分）。
- Lucide 1.0 起已移除品牌图标；本项目不需要品牌图标，若将来需要，走 Simple Icons 并单独评审。
- 与其配合，`radix-ui 1.6.7` 提供交互原语但不提供图标，避免混用。
- **版本必须写死，禁止 `*` / `latest`**：以 npm registry 实测为准，`lucide-react` 当前 latest 为 **1.48.0**（注意：UIUX.md 中"lucide-react 为 0.x 线"的表述已过时，Lucide 自 2026-07 的 1.0 起整包进入 v1 线）。Lucide 历史上存在图标重命名（如 `alert-triangle` → `triangle-alert`），所以**所有图标名必须对照 1.48.0 实际导出核验**，禁止凭旧名书写。
- **Tabler 例外通道（唯一允许的第二个来源，严控）**：`docs/UIUX.md` §6.1 登记了 Lucide 确实缺失的极少数概念（登记数以设计方为准，当前为个位数）。规则：
  1. 每个 Tabler 图标必须在 `docs/design-system/icon-exceptions.md` 逐条登记：图标名、Lucide 缺失理由、24px/2px 视觉对齐核验人；
  2. 例外总数不超过 5 个，超出即由设计方改用 Lucide 近似图标；
  3. **除 Tabler 外不接受任何第三个图标来源**（含图标字体、自绘 SVG、emoji、品牌图标）；
  4. CI 中加一条依赖白名单检查：`package.json` 的 dependencies 中只允许出现 `lucide-react`，例外发生时必须同步更新本文件登记。

---

## 2. 技术选型对比矩阵

评分口径：1 分最低，5 分最高。**结论列即最终决定，不得推翻。**

### 2.1 Windows 打包方案

| 方案 | 安装包质量 | 上手成本 | Windows 控制力 | 自更新 | 生态存量答案 | 总分 | 结论 |
|---|---|---|---|---|---|---|---|
| **electron-builder 26.15.3（NSIS）** | 5 | 4 | 5 | 5（electron-updater） | 5 | **24** | **选定** |
| Electron Forge 7.x（Squirrel） | 3 | 5 | 2 | 3 | 3 | 16 | 否决 |
| electron-packager + 自写 NSIS | 4 | 1 | 5 | 1 | 2 | 13 | 否决 |

选定理由：
- 需要 NSIS。Windows 防火墙入站规则必须在**提升权限的安装阶段**创建（见 T2.2），NSIS 安装器以提权运行，天然满足；Squirrel 安装器不提权。
- Squirrel 的自启动注册需要指向上一级的 stub 启动器（`path` 指向 `..\\Stub.exe`），容易被写错；NSIS 下 `app.getPath('exe')` 路径稳定。
- PRD 要求"试点管理员能独立完成，不依赖命令行"，安装包必须能顺带完成防火墙配置。

### 2.2 服务的 HTTP 层

| 方案 | 依赖数 | 首包体积 | Schema 校验 | 生成 openapi | 学习成本 | 总分 | 结论 |
|---|---|---|---|---|---|---|---|
| **Fastify 5.12.5** | 中 | 中 | 内建 JSON Schema | 原生（@fastify/swagger） | 中 | **22** | **选定** |
| Express 5.2.1 | 低 | 小 | 无（需外挂） | 需外挂 | 低 | 17 | 否决 |
| 原生 node:http 手写路由 | 0 | 0 | 无 | 无 | 低（但易写错） | 12 | 否决 |

选定理由：Endpoint 少不代表可以裸写。**zod/JSON Schema 单一来源 → Fastify 校验 → @fastify/swagger 生成 `docs/api/openapi.yaml`**，这条链路保证 API 契约与实现无法漂移；这是本项目选 Fastify 的唯一实质理由（性能在 <50 客户端的局域网里毫无意义）。

### 2.3 服务发现（核心难题，详见 T1 与 ADR-002）

| 方案 | 员工端零配置 | Windows 防火墙成本 | 抗 DHCP 变更 | 实现复杂度 | 网络噪声 | 总分 | 结论 |
|---|---|---|---|---|---|---|---|
| **UDP 广播探测 + 单播应答（UDP 17891）** | 是（仅管理员机器需规则） | 低（安装时装 1 条） | 强 | 低（约 150 行） | 低 | **22** | **选定（L2 层）** |
| mDNS / bonjour-service | 否（**每台员工机都要开 UDP 5353 入站**） | 高 | 强 | 中 | 低 | 9 | **否决** |
| 固定配置服务地址 | 否（需人工维护） | 无 | 弱（需 DHCP 预留） | 极低 | 无 | 14 | 作为 L0 覆盖项保留 |
| 网段 TCP 端口扫描 | 是 | 无 | 强 | 中 | 中高（254 次 SYN） | 16 | 末位兜底 L3 |
| "上次成功端点"缓存 | 是 | 无 | 弱 | 极低 | 无 | 18 | 快速路径 L1 |

**最终采用"阶梯式发现"：L0 手动覆盖 → L1 上次成功端点 → L2 UDP 广播 → L3 网段扫描 → 离线。** 单一方案都有致命短板，阶梯组合后每一层覆盖上一层的失败场景。mDNS 被否决的决定性理由写在 ADR-002：它要求**员工机器**开放 UDP 5353 入站，直接摧毁"员工零配置"这一产品前提。

### 2.4 本机存储

| 方案 | 适配数据规模 | 安装风险 | 原子写 | 迁移到 SQLite 成本 | 总分 | 结论 |
|---|---|---|---|---|---|---|
| **JSON 文档 + 内存索引 + 原子写** | ≤5000 条（MVP 上限 200 团队 + 500 个人） | 零（无原生模块） | 自行实现（临时文件 + rename） | 低（仓储层已隔离） | **22** | **选定** |
| SQLite（better-sqlite3） | 无上限 | 高（需按 ABI 重编译） | 事务原生 | — | 14 | 否决（已记录迁移触发条件） |
| IndexedDB / localStorage | 中 | 零 | 弱（无事务保证） | 高 | 9 | 否决 |

迁移触发条件（写进 ADR-005）：团队入口 > 2000 条，或个人入口 > 5000 条，或需要提供 JSON 之上的复杂查询。触发时只需替换 `src/main/repositories/*` 的实现，上层 service 与 API 不变。

### 2.5 渲染层

| 方案 | 与本项目的契合度 | 备注 |
|---|---|---|
| **React 19 + Vite 8 + Tailwind 4 + Radix UI** | 选定 | 卡片墙是标准列表 + 网格 UI，无特殊需求；Radix 负责键盘可达与焦点管理（PRD 无障碍 P1） |
| Vue 3 | 可行但不选 | 团队已有 React 倾向（lucide-react / radix-ui 生态） |
| 原生 DOM 手写 | 否决 | 编辑器的草稿/发布/校验状态管理收益不抵成本 |

---

## 3. 系统架构

### 3.1 进程与分层

```
┌──────────────────────────── 渲染进程 (Chromium 152, sandbox=true) ────────────────────────────┐
│  React 19 页面                                                                                │
│   团队卡片墙 / 我的入口 / 管理员编辑模式 / 发布预览 / 发布历史 / 反馈列表 / 设置 / 诊断        │
│   搜索面板（Ctrl+Space 唤起）                                                                 │
│  规则：禁止 import 'electron'（除 preload 暴露的 window.api）；禁止直接 fs / child_process     │
└───────────────────────────────────────────┬──────────────────────────────────────────────────┘
                          IPC（preload contextBridge，类型由 typed-ipc 契约保证）
┌───────────────────────────────────────────▼──────────────────────────────────────────────────┐
│ 主进程（Node.js 24.21.0，随 Electron 44.4.5 提供）                                            │
│                                                                                              │
│  ipc/handlers/*.ts      薄：参数校验 → 转调 service → 组装 IPC 结果（禁止写业务逻辑）         │
│           │                                                                                  │
│  services/*.ts          业务层：规则编排、发布校验、乐观并发、发现调度、失败重试               │
│           │             禁止持有 req/res HTTP 对象；禁止返回 HTTP 响应                        │
│  repositories/*.ts      数据层：JSON 原子读写、内存索引、资源落盘                              │
│           │                                                                                  │
│  ────────────────────────────────────────────────────────────────────────────────────────    │
│  server/**  ← 内嵌同步服务：Fastify 5 + UDP 信标，仅角色=admin 时启动                         │
│     硬约束：src/server/** 与 src/discovery/** 禁止出现 import 'electron'                       │
│     这是"将来迁到独立机器"的唯一技术保证：该目录可被 node 直接拉起 standalone 运行            │
│  server/routes/* → 同一套 services/* → repositories/*                                        │
│  ────────────────────────────────────────────────────────────────────────────────────────    │
│  platform/*.ts  Windows 系统能力：openPath 策略、lnk 解析、图标提取、开始菜单扫描、防火墙巡检  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 依赖方向铁律（出现即退回）

```
允许： ipc handler → service → repository → 文件系统
禁止： repository → service（反向）
禁止： ipc handler → repository（跨层）
禁止： service → electron 的 req/res 对象
禁止： src/server/** → import 'electron'
禁止： renderer/** → import 'electron'（renderer 只认 window.api）
```

可用命令守卫（CI 与开发自检都要跑）：

```bash
# 1) 迁移可行性守卫：同步服务目录不得依赖 Electron
grep -rn "require('electron')\|from 'electron'" src/server src/discovery && echo "FAIL: server 层不得依赖 electron"

# 2) 单文件 ≤ 300 行
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | sort -rn | awk '$1>300 && $2!="total" {print "OVER LIMIT:", $0}'

# 3) 入口文件不得含业务逻辑
wc -l src/main/index.ts src/server/app.ts   # 均应 < 120 行
```

### 3.3 可执行目录结构

```
src/
├── main/
│   ├── index.ts                 # 入口：仅装配（单实例锁/窗口/托盘/服务启动）≤120 行
│   ├── window.ts
│   ├── tray.ts
│   ├── hotkey.ts                # Ctrl+Space 全局热键注册与冲突处理
│   ├── lifecycle.ts             # 角色决定关闭行为、powerMonitor 挂起/恢复
│   └── ipc/
│       ├── index.ts             # 集中注册（薄）
│       ├── team.handlers.ts
│       ├── personal.handlers.ts
│       ├── publish.handlers.ts
│       ├── launch.handlers.ts
│       ├── icon.handlers.ts
│       ├── feedback.handlers.ts
│       ├── settings.handlers.ts
│       ├── diagnostics.handlers.ts
│       └── telemetry.handlers.ts
├── services/                    # 业务层（纯逻辑，可单测，不 import electron）
│   ├── team-config.service.ts   # 当前快照、软更新判定、缓存替换
│   ├── personal.service.ts      # 个人页 CRUD + 导出/导入
│   ├── publish.service.ts       # 发布校验、变更摘要、乐观并发、版本推进
│   ├── revision.service.ts      # 快照写盘、最近 20 条记录、轮询只读
│   ├── launch.service.ts        # 打开三类入口的策略编排与错误分类
│   ├── shortcut.service.ts      # .lnk / .url 解析与重新定位
│   ├── icon.service.ts          # 本地图标提取队列 + 落到缓存
│   ├── favicon.service.ts       # 管理员侧抓取 favicon → asset
│   ├── asset.service.ts         # 资源寻址与校验
│   ├── discovery.service.ts     # L0→L3 阶梯
│   ├── sync.service.ts          # 30 秒轮询、条件请求、软更新、离线判定
│   ├── feedback.service.ts      # 离线待发送队列 + 上线重放
│   ├── telemetry.service.ts     # 本地环形缓冲 + 可选批量上报
│   ├── credential.service.ts    # scrypt 派生、验证、会话令牌
│   ├── startmenu.service.ts     # 开始菜单/桌面候选扫描
│   └── settings.service.ts
├── repositories/                # 数据层
│   ├── paths.ts                 # userData 下所有路径常量 + 首次运行建目录
│   ├── atomic-json.ts           # 临时文件 + fsync + rename 的原子写基类
│   ├── team-config.repository.ts
│   ├── personal.repository.ts
│   ├── revision.repository.ts
│   ├── settings.repository.ts
│   ├── credential.repository.ts
│   ├── asset.repository.ts
│   ├── feedback.repository.ts
│   └── telemetry.repository.ts
├── platform/                    # Windows 能力封装（同步 API 必须异步，禁止 existsSync）
│   ├── open-strategy.ts
│   ├── shortcut-reader.ts
│   ├── icon-extractor.ts
│   ├── firewall-probe.ts
│   ├── start-menu.ts
│   └── net-profile.ts           # 活动网络配置文件、本地 IPv4/掩码/定向广播地址
├── discovery/                   # 客户端侧发现（纯 Node）
│   ├── endpoint-resolver.ts     # L0→L3 编排
│   ├── beacon-probe.ts          # UDP 广播 + 应答收集
│   └── lan-scan.ts              # 末位兜底 TCP 扫描（限频）
├── server/                      # 内嵌同步服务（纯 Node，禁 electron）
│   ├── app.ts                   # Fastify 装配，≤120 行
│   ├── routes/
│   │   ├── health.route.ts
│   │   ├── config.route.ts
│   │   ├── changes.route.ts
│   │   ├── assets.route.ts
│   │   ├── auth.route.ts
│   │   ├── revisions.route.ts
│   │   ├── feedback.route.ts
│   │   ├── telemetry.route.ts
│   │   └── diagnostics.route.ts
│   ├── hooks/
│   │   ├── error.ts             # 统一 {code,data,message} 信封
│   │   ├── auth.ts              # Bearer + 请求签名校验
│   │   └── rate-limit.ts        # 认证/反馈/埋点分别限流
│   ├── beacon.ts                # UDP 17891 应答
│   └── http-client.ts           # 客户端侧 HTTP（超时/重试/多网关/响应校验）
├── shared/                      # 主进程与渲染进程共享
│   ├── schema.ts                # 契约唯一入口（仅 re-export，不含定义，29 行）
│   ├── schema/                  # zod 定义，按资源分文件，单文件 ≤300 行
│   │   ├── common.ts            # CAPACITY / SCHEMA_VERSION / IsoDateTime / Sha256Hex / Revision
│   │   ├── entry.ts             # IconRef + app/folder/web 三类判别联合
│   │   ├── group.ts             # Group + GroupList（≤8 组 / ≤200 入口 / id 唯一闸门）
│   │   ├── config.ts            # TeamConfig / TeamConfigWire（≤1MB）/ PublishRequest
│   │   ├── local.ts             # Settings（含 telemetryNoticeAckedAt 隐私门）/ PersonalConfig
│   │   ├── feedback.ts          # FeedbackItem / FeedbackBatch（仅 reasonCode，无自由文本）
│   │   ├── telemetry.ts         # TelemetryItem（事件名白名单 + props 键名黑名单）
│   │   └── envelope.ts          # ErrorCode + envelopeOf()
│   ├── types.ts
│   ├── errors.ts                # 错误码字典
│   └── constants.ts             # 端口、容量上限、超时阈值
├── preload/index.ts             # contextBridge 暴露 window.api
└── renderer/
    ├── pages/  components/  hooks/  services/  stores/  styles/  types/
    └── services/ 封装 window.api 调用；禁止跨上一层直连 IPC
```

---

## 4. 八大技术难题逐条方案

### T1 服务发现

**结论：阶梯式发现 L0→L3，主用 UDP 广播 + 单播应答（UDP 17891），mDNS 明确否决。详见 ADR-002。**

#### T1.1 为什么否决 mDNS（三条硬证据）

1. **致命**：mDNS 的答案以组播形式回到 `224.0.0.251:5353`。Windows Defender 防火墙默认拦截未经授权进程的入站 UDP，意味着**每台员工机器**都要为 Node/Electron 可执行文件开 UDP 5353 入站规则。这直接违反"员工零配置下载即用"的产品前提。多条社区证据指出纯 JS mDNS 实现（bonjour / bonjour-service）在 Windows 上"查询发出但收不到回包"，根因即此。
2. **端口冲突**：UDP 5353 常被已安装的 Bonjour 服务（iTunes / iCloud / Adobe 套件）占用，触发 `EADDRINUSE`，无法 bind。
3. **企业网络**：大量办公 Wi-Fi 开启 AP 隔离或禁用组播，mDNS 静默无结果且极难排查。

#### T1.2 选定方案的形状（只有管理员机器需要防火墙规则）

员工端**主动发出** UDP 广播 → 管理员单播回包。Windows 防火墙对"自己发出的 UDP 的应答"做状态放行，因此员工机**完全不需要任何入站规则**。

```
员工端                                            管理员端
  │  UDP datagram → 255.255.255.255:17891           │
  │                → 192.168.1.255:17891 (定向广播)  │
  │  {magic,type:"query",nonce,anonDeviceId} ──────► │ bind UDP 0.0.0.0:17891
  │                                                  │
  │  ◄──────── 单播应答 ───────────────────────────── │
  │  {magic,type:"offer",nonce,serviceId,            │
  │   instanceId,name,httpPort,revision,addrs[]}      │
```

- `magic = "TLDISCOVER1"`：协议版本哨兵，不匹配直接丢弃，保证将来升级不串。
- `nonce`：16 字节随机，应答必须回显，用于丢弃过期/重复应答与防止跨交换机迟到包。
- `httpPort`：管理员实际监听端口（可能因端口占用而漂移），**必须靠信标广播真实端口**，不能写死。
- `instanceId`：团队配置实例的 UUID，用于识别"换了数据源"（例如迁移到新管理员机器）。
- 客户端 bind 一个临时 UDP 端口后发送，等待应答 2500 ms；第 0 ms 与第 600 ms 各发一轮。
- 定向广播地址由本机 IPv4 与掩码实时计算：`bcast = (ip & mask) | (~mask)`，对每个非 internal 的 IPv4 网卡各发一份，并额外发一份 `255.255.255.255`。

#### T1.3 完整阶梯

| 层 | 手段 | 超时 | 失败后 |
|---|---|---|---|
| L0 | `settings.serviceUrl` 手动覆盖（迁移到独立服务器的开关） | 1500 ms | 落 L1 |
| L1 | `discovery.json` 中最近成功的端点（≤3 个，按 lastSuccessAt 降序） | 1500 ms/个 | 落 L2 |
| L2 | UDP 广播探测（与 L1 并行发出，谁先回用谁） | 2500 ms | 落 L3 |
| L3 | 网段 TCP 扫描候选端口 + `/api/v1/health` 校验（限频：每 5 分钟至多 1 次；仅非 internal IPv4 所在 /24；并发 96；单主机 250 ms） | 4000 ms | 判定离线 |

- **抗 DHCP 变更**：管理员 IP 变了 → L1 失败 → L2/L3 兜底恢复，并把新端点写回 `discovery.json`。这正是管理员 IP 会在 DHCP 下漂移这一顾虑的答案。
- **端点记忆的唯一写入点是 `discovery.json`**（ADR-005）：`settings.json` 只放用户意图，不保留 `knownEndpoints`。写入需节流（端点变化时才写，或 ≥5 分钟刷新一次时间戳），不得每轮轮询重写。
- **L3 是末位手段而非默认**：254 次 SYN 在部分企业环境会触发安全软件告警，因此必须限频、必须在 UI 明示"正在扫描局域网"，且结果一经确认立即写回 L1 缓存，避免重复扫描。
- 未找到任何端点即进入离线模式（T7）。

### T2 内嵌同步服务

**结论：Fastify 5 实例跑在主进程；只有管理员机器需要且只需在安装时创建两条防火墙规则；员工零配置。**

#### T2.1 生命周期与端口

- 仅当 `settings.role === 'admin'` 且 `settings.syncEnabled` 为真时启动。
- 监听 `0.0.0.0`（必须，否则局域网不可达）；端口从 17890 起向右探测至 17899，实际端口通过信标对外广播，因此端口漂移不影响发现。
- **单实例锁**：`app.requestSingleInstanceLock()` 必须最先调用，否则重复启动会争抢端口并产生两个互相覆盖的数据源。
- **管理员端不得因"窗口全部关闭"而退出**：`role==='admin'` 时 `window-all-closed` 不清空也不 quit，改为驻留托盘；否则同步服务随窗口关闭停止，直接违反 PRD"同步服务停止是显性事件"。员工端则按 `settings.trayEnabled` 决定。

#### T2.2 Windows 防火墙（最高风险项，必须照做）

Windows 防火墙默认拦截未授权进程的**入站**连接，这是本项目最容易踩的坑。规则必须在**提权的安装阶段**创建：

```powershell
# 由 NSIS 安装器以提升后的权限执行；先删后加以保证重装幂等
netsh advfirewall firewall delete rule name="TeamLaunch Sync TCP" | Out-Null
New-NetFirewallRule -DisplayName "TeamLaunch Sync TCP" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 17890-17899 -Profile Domain,Private -RemoteAddress LocalSubnet

netsh advfirewall firewall delete rule name="TeamLaunch Discovery UDP" | Out-Null
New-NetFirewallRule -DisplayName "TeamLaunch Discovery UDP" -Direction Inbound -Action Allow `
  -Protocol UDP -LocalPort 17891 -Profile Domain,Private -RemoteAddress LocalSubnet
```

要点：
- **`-RemoteAddress LocalSubnet`** 是关键：管理员可能连着 VPN / Hyper-V 虚拟网卡，把来源限制在同子网可显著降低暴露面。
- **`-Profile Domain,Private`**：若活动网络是 **公用（Public）配置文件，规则不生效**。这是现场最常见的"配了规则还是连不上"。诊断页必须显示活动配置文件并给出切换指引。
- 兜底修复：设置页提供"修复防火墙规则"，用提升后的 PowerShell 重新执行一次（`Start-Process powershell -Verb RunAs`，会弹 UAC）。
- **诚实说明**：本机自连自身 LAN IP 的连通性测试不可信（同主机回环不走入站规则）。真正的验证必须由**第二台机器**完成，这一点要写进测试用例，不能靠自检通过就放行。

#### T2.3 与 UI 进程通信

- **本机 UI → IPC（不改 HTTP）**；**远端客户端 → HTTP**。两条路径落到同一个 service 层。
- 这样设计的收益：员工/管理员 UI 不经过 loopback HTTP，避免为本地流量再开一次校验与可能的防火墙干扰；且将来服务外迁时，只需把本机 UI 的传输从 IPC 换成带令牌的 HTTP，业务层零改动。

### T3 同步协议

**结论：单调整数 `revision` 作为版本锚，`contentHash` 保证完整性，`ETag` + 条件请求实现"增量"（无变化不传正文、不重绘）。详见 ADR-003。**

#### T3.1 版本三要素

| 字段 | 定义 | 不变式 |
|---|---|---|
| `revision` | int64，管理员每次发布 +1 | **永不复用、永不回退**。回滚也产生新的更高 revision（内容等于旧版） |
| `contentHash` | `sha256` 规范化 JSON（键排序、无空白、UTF-8）的十六进制 | 用于发现"版本对但内容被改坏" |
| `ETag` | 强校验：`"<revision>-<contentHash前16位>"` | 与 `If-None-Match` 配对 |

- **为什么不用纯内容哈希当版本**：哈希无法比较先后，且无法满足 PRD"发布后生成递增版本"的产品呈现。
- **为什么不用时间戳**：PRD §13 明确"避免用本机时钟判断版本先后"，员工机时钟不准不得影响正确性。因此**缓存新旧只用 revision 比较**，时间仅用于展示。

#### T3.2 请求与响应

```
GET /api/v1/config HTTP/1.1
Host: 192.168.1.10:17890
If-None-Match: "128-9f2c1a7b3d5e0f11"
X-TL-Device-Id: <anon-dev-id>

HTTP/1.1 304 Not Modified          # 正文为空，UI 不做任何重绘（PRD AC-09）
ETag: "128-9f2c1a7b3d5e0f11"

HTTP/1.1 200 OK                    # 仅当版本不同才返回正文
Content-Type: application/json
ETag: "129-7a4c..."
X-TL-Revision: 129
X-TL-Published-At: 2026-09-29T12:00:00.000Z   # 服务端时间，用于"数据时间"展示

{ "code": 0, "data": { ...团队配置文档... }, "message": "" }
```

#### T3.3 增量策略与它的边界

- **MVP 采用"版本闸门式全文档拉取"，不做字段级 diff。** 理由：MVP 上限 200 个入口，正文远小于 500 KB，局域网下一次全量 < 30 ms；而 diff 合并是典型的"沉默逻辑错误"高发区（漏合并一个字段，两端永久不一致且无任何报错）。
- 真正的增量体现在两处：① `ETag/304` 让"无变化"零字节传输；② `GET /api/v1/changes?since=N` 只回变更记录增量，供发布历史/time-line 使用。
- 触发升级 diff 的条件（写进 ADR-003）：单次正文 > 2 MB 或 入口 > 2000 条。

#### T3.4 30 秒轮询（PRD P0-10 / AC-08）

- 定时间隔 30 s，单次预算 ≤ 15 s；含一个轮询周期的 p95 ≤ 45 s 成立（**不做实时推送，MVP 无长连接**）。
- **手动刷新忽略轮询计时器立即执行**，完成后给出可感知结果（已更新 / 无变化 / 离线）。
- 上一轮未结束时**跳过本轮**，严禁请求堆积。
- `powerMonitor.on('suspend')` 停表，`'resume'` 与 `'unlock-screen'` 立即触发一次（含重新发现），满足 PRD"休眠唤醒与网络切换后可恢复"。
- 连续 2 次失败 → 下一轮走完整 L0→L3 发现，重新绑定端点。
- **软更新**：仅当 `revision` 变化时替换内存快照并通知渲染层；渲染层必须保留当前 Tab、滚动位置与搜索词（AC-08）。
- **无变化不重绘**：304 或 revision 相同 → 不调用任何状态更新 → 不重渲染列表（AC-09）。

#### T3.5 抗并发、抗抖动、抗管理员关机

| 场景 | 处理 |
|---|---|
| 多员工并发拉取 | 服务端回复来自**内存快照** `currentSnapshot`（发布时同步重算），无磁盘 IO、无锁竞争；`GET` 天然幂等 |
| 网络抖动（ECONNRESET / 超时） | 已知端点：退避重试 2 次（300 ms / 900 ms），且只对幂等 GET 重试；扫描出的新端点不重试 |
| 管理员关机 / 退出 | 员工收到 ECONNREFUSED → 离线模式，**不删除任何缓存** |
| 并发发布（多管理员未来场景） | MVP 单写者；`baseRevision` 乐观并发，不匹配返回 409 与当前 revision |
| **缓存投毒** | 只有"HTTP 200 + zod 校验通过 + `sha256(body)` 与响应 `contentHash` 一致"三重通过才落盘新缓存；任一失败保留旧缓存并给出"更新未完成，仍使用上一版本"（PRD §13 数据损坏） |

最后一条是**防沉默逻辑错误的关键防线**：任何时候服务器返回残缺/被中间件改写的内容，都不会污染员工的可用数据。

#### T3.6 同步状态机：禁止状态误导（PRD §5.4.1 产品硬规则）

PRD 明确要求："轮询未命中新版本期间，界面不得把'已发布但本机尚未拿到'表达成其他状态"。这不是文案问题，是**状态机必须有显式定义**才能守住，否则实现一定会把"上次成功=最新"沿用下去，形成误导。

状态枚举（`SyncState`，唯一真源，**由 `sync.service.ts` 写入；UI 只读，禁止自行推导**）。PRD §5.4.1 要求显式覆盖的六类语义全部在内：

| 状态 | 进入条件 | 覆盖 PRD §5.4.1 语义 | UI 表达 |
|---|---|---|---|
| `NEVER_SYNCED` | 从未成功拿到过配置 | 首次未同步 | 空状态 / 骨架屏，不伪造卡片 |
| `SYNCING` | 首轮或手动刷新进行中 | 同步进行中 | 骨架屏或静默进度 |
| `ONLINE_LATEST` | **本轮成功与服务端核对**且 revision 相同 | 在线且已最新 | "已是最新"或不显示 |
| `ONLINE_UPDATE_PENDING` | 本轮成功拿到更高 revision，尚未完成软应用 | 在线有待应用更新 | 软更新 + 轻提示 |
| `OFFLINE_CACHED` | 本轮失败且本机有可用缓存 | 离线有缓存 | "离线 · 数据时间 XX" |
| `OFFLINE_EMPTY` | 本轮失败且无缓存（含首次） | 离线无缓存 | 空状态 + 手动刷新 + 我的入口 |
| `SYNC_FAILED_UNKNOWN` | 本轮失败且无法归类 | 同步失败 / 未知 | "同步状态未知"，不谎报最近是否有更新 |
| `SYNC_DATA_REJECTED` | **拿到响应**但三重校验失败，已保留旧缓存 | 在线但数据被拒 | "更新未完成，仍使用上一版本"（PRD §13 数据损坏） |

#### T3.6.1 `offlineReason` 枚举（文案映射表的键名，以此为准）

| 枚举名 | 语义 | 判定依据 | 可检出性 |
|---|---|---|---|
| `SERVICE_NOT_FOUND` | 服务未找到 | 发现阶梯 L0→L3 **零应答** | 可靠 |
| `CONNECTION_BLOCKED` | 被拦截不可达 | **UDP 信标有应答，但 TCP 连接失败** | 可靠（信标通而 TCP 不通，是防火墙/安全软件拦截的强证据） |
| `NETWORK_UNREACHABLE` | 网络不可达 | 端点已知但网络层失败：`ECONNREFUSED` / `ETIMEDOUT` / `EHOSTUNREACH` / `ENETDOWN` | 可靠（但**无法**区分"管理员关机"与"被拦截"，此时只能用本码） |
| `UNKNOWN` | 未归类兜底 | 以上均不成立或异常未识别 | 兜底 |

**不可检出的区分（诚实说明，别为它设计文案）**：`NETWORK_UNREACHABLE` 无法在技术上区分"管理员机器已关机"和"中间件拦截"。只有当**信标 UDP 通、TCP 不通**时才能判定为 `CONNECTION_BLOCKED`；信标也不通时一律归 `SERVICE_NOT_FOUND`。因此文案上不要把"被拦截不可达"写成一种常见状态——它只在信标通而 TCP 不通这一窄条件下出现。

**配套规则**：
1. `offlineReason` 仅 `OFFLINE_CACHED` / `OFFLINE_EMPTY` / `SYNC_FAILED_UNKNOWN` 三个状态携带，其余状态为 `null`。
2. **"返回数据校验失败"不是 `offlineReason`**，它是独立状态 `SYNC_DATA_REJECTED` —— 此时服务是连通的，只是数据被拒，归入离线语义会误导（会让人以为断网）。文案映射请按**状态键**取这一行，不要按原因键。
3. 未覆盖/未识别的原因一律回落 `UNKNOWN`，UI 回退到兜底行。**禁止显示原始错误码、堆栈、端口地址或 IP**（PM 已定口径）。

主标题统一为状态语义「暂时无法获取团队入口」，第二行才由 `offlineReason` 决定 —— 该口径由产品侧定义，本表只提供键名与取值。
- `hasCache`：由 sync 服务依磁盘缓存实际情况写入，**UI 禁止依据"卡片是否渲染出来"反推**。

#### T3.6.2 `GET /config` 返回 404 的处理（服务可达但从未发布）

服务端在**首次发布之前**对 `GET /config` 返回 **404 `ERR_NOT_FOUND`**（不是返回一份空配置）。这条必须单独处理，否则会被误判成离线：

| 情形 | HTTP | 应有状态 | 禁止 |
|---|---|---|---|
| 已发布过，版本一致 | 304 | `ONLINE_LATEST` | 不得重绘 |
| 已发布过，有更高版本 | 200 | `ONLINE_UPDATE_PENDING` | 不得整表替换式重绘 |
| **服务可达，尚未发布任何版本** | **404** | **`OFFLINE_EMPTY` 同族的空状态**（"管理员还没发布入口"），`offlineReason = null` | **不得**归入 `OFFLINE_CACHED`、不得标"离线"、不得标"同步失败" |
| 服务不可达 | 超时/连接错 | `OFFLINE_CACHED` / `OFFLINE_EMPTY` + 对应 `offlineReason` | 不得谎报"已最新" |

关键区分：**404 是服务应答了**，链路是通的。`offlineReason` 描述的是"为什么连不上"，此时没有"连不上"这回事，所以必须为 `null`，文案按空状态走而不是按离线走。员工在此时仍可正常使用「我的入口」。

轮询照常继续（管理员一发布就能拿到），但不弹错误 Toast、不记同步失败。

**四条核心不变式（实现必须守住）**：

1. **`ONLINE_LATEST` 的有效期只到下一次轮询开始为止。** 一旦下一轮轮询未能成功完成，状态必须退回 `OFFLINE_*` 或 `SYNC_FAILED_UNKNOWN`，**绝不允许沿用上一轮的"已是最新"**。这是防止"已发布但本机尚未拿到却被表达成已是最新"的唯一可靠机制。
2. UI 禁止根据"本地 revision 未变化"自行推断在线状态；在线与否只能由本轮轮询结果决定。
3. **手动刷新必须忽略轮询计时器立即执行**，完成后必须给出可感知结果（已更新 / 无变化 / 离线），不得静默成功。
4. 状态转换只能发生在 `sync.service.ts`；渲染层只读不写。

#### T3.7 反馈投递状态：不得谎报"已上报成功"

PRD §5.4.1 明确"失败反馈可离线排队，但界面不得暗示'已上报成功'"。落地到状态：

- `FeedbackDeliveryState`：`PENDING`（待发送，仍在本地 outbox）/ `SENT`（服务端确认接收）/ `DROPPED`（超队列上限或超保留期被丢弃）。
- 在线发送前一律显示 `PENDING` 并有可见标记；**只有服务端返回 200 后才允许转为 `SENT`**。写入 outbox 成功不等于上报成功，UI 不得在写入本地时就提示"已提交/已反馈成功"。
- `DROPPED` 必须可见地告知用户（队列上限 200 条 / 30 天），不允许静默丢弃。
- 埋点 `entry_feedback_submitted` 的 `delivery_state` 必须与上述三个值一致，不得直接记为 success。

**核心不变式（实现必须守住）**：

1. **`ONLINE_LATEST` 的有效期只到下一次轮询开始为止。** 一旦下一轮轮询未能成功完成，状态必须退回 `OFFLINE_*` 或 `SYNCING`，**绝不允许沿用上一轮的"已是最新"**。这是防止"已发布但本机尚未拿到却被表达成已是最新"的唯一可靠机制。
2. UI 禁止根据"本地 revision 未变化"自行推断在线状态；在线与否只能由本轮轮询结果决定。
3. **手动刷新必须忽略轮询计时器立即执行**，完成后必须给出可感知结果（已更新 / 无变化 / 离线），不得静默成功。
4. 状态转换只能发生在 `sync.service.ts`；渲染层只读不写。

### T4 三类入口的打开

#### T4.1 统一决策表

| 条件 | 手段 | 说明 |
|---|---|---|
| 软件，无参数无工作目录 | `shell.openPath(target)` → `Promise<string>`，空串即成功 | ShellExecute 语义，天然支持空格、中文路径、文件关联 |
| 软件，带 args 或 cwd | `child_process.spawn(target, argvArray, {cwd, detached:true, stdio:'ignore'}).unref()` | **必须 `shell:false`**，见下方陷阱 |
| `.lnk` 快捷方式 | 新增时 `shell.readShortcutLink(p)` 解析并落库；打开时用解析结果 | 见 T4.2 |
| 文件夹 | `shell.openPath(dir)` → 资源管理器 | 失败按 T4.4 分类提示 |
| 网页 | `shell.openExternal(url)` → 默认浏览器 | MVP 唯一模式，见 T4.3 |

**必须写入规格的三个陷阱：**

1. **禁止 `child_process.exec` / `shell:true`**。数组传参 + `shell:false` 天然免疫命令行注入与"路径含空格被截断"，而 `exec` 会把员工/管理员填写的参数喂给 shell。
2. **禁止在主进程使用 `fs.existsSync` / 任何 `*Sync` 检查路径**。对已下线的 UNC 共享路径（`\\server\share`）或断线的映射盘，同步 IO 会**阻塞主线程数十秒**，表现为整个应用假死。一律用 `fs.promises` + `Promise.race` 超时包装（本地 500 ms / UNC 1500 ms）。
3. **不做渲染期预检查**。200 张卡片各一次 stat 会在首屏产生 200 次 IO，直接击穿"有缓存时卡片可见 < 1.5 s"。存在性只在**点击时**判断，失败按 T4.4 的错误分类给出文案。

#### T4.2 快捷方式解析

`shell.readShortcutLink(shortcutPath)` 返回 `ShortcutDetails`：`{target, cwd, args, description, icon, iconIndex, appUserModelId, toastActivatorClsrd...}`（字段名以 Electron 44 文档为准：`target` / `cwd` / `args` / `description` / `icon` / `iconIndex` / `appUserModelId` / `toastActivatorClsid`）。

- 落库时同时保存：`sourcePath`（原始 lnk，用于将来重新解析）与 `resolvedTarget` / `resolvedCwd` / `resolvedArgs`（打开与图标提取用）。
- 打开策略：解析目标存在 → 走带参 spawn；否则退回 `shell.openPath(sourcePath)` 让系统自己处理。
- **已知边界**：`.url` 文件不是快捷方式，`readShortcutLink` 不适用，需按 INI 文本读 `[InternetShortcut]` 下的 `URL=`。UWP 应用的 lnk 目标形如 `explorer.exe shell:AppsFolder\...`，得不到可执行文件路径——此时必须保留原始 lnk 并用 `openPath(sourcePath)` 打开。
- 环境变量：允许目标写作 `%LOCALAPPDATA%\...`，打开前按**白名单**（`%APPDATA%` / `%LOCALAPPDATA%` / `%USERPROFILE%` / `%PROGRAMFILES%` / `%PROGRAMDATA%` / `%WINDIR%`）做字面展开，禁止通用 shell 展开。这让同一入口在不同机器上有机会指向正确位置，回应 PRD 风险"安装路径在设备间不同"。

#### T4.3 网页：只用默认浏览器

**MVP 一律 `shell.openExternal`，不提供内置窗口。** 理由：内置 BrowserWindow 使用独立的 Chromium 会话与 profile，**不带用户主浏览器的登录态**，企业内常见的 NTLM/SSO 内网系统会在内置窗口里失败，而这恰恰是反馈噪音最大的来源。schema 中因此**不新增**任何浏览器模式字段——避免出现无人实现的死配置项。
注意 `shell.openExternal` 在 Windows 上 URL 上限 2081 字符，超长直接判定并提示。

#### T4.4 失败分类（对应 PRD §13）

| 可观测结果 | 判定 | 文案方向 |
|---|---|---|
| `access(F_OK)` 失败 | 目标不存在 | "本机未找到该软件" / "文件夹不存在" |
| `access(R_OK)` 失败 | 权限不足 | "当前无权限访问该位置" |
| UNC/超时/`ENETUNREACH`/`EBADF` | 网络位置不可达 | "共享路径当前不可达" |
| `openPath` 返回非空串 | 系统拒绝 | 返回串 + 诊断详情 |
| 提升权限被要求 | 不提权 | "需要更高权限，请联系 IT" |

每个错误都必须带 `diagnosticId` + 可复制的结构化详情。
**Electron 44 破坏性变更**：`clipboard` 模块不再直接暴露给渲染进程，复制诊断必须经 preload 的 IPC 通道完成，渲染层不得直接用 `clipboard`。

#### T4.5 去抖

同一 `entryId` 在 800 ms 内的重复打开请求合并，避免连点弹出多个相同软件（PRD §13 重复点击）。合并窗口结束后用户再次点击仍须响应。

### T5 图标

**结论：本地图标用 Electron 原生 `app.getFileIcon` 提取并在本地缓存；网页 favicon 只在管理员侧抓取、作为资源同步给员工。**

#### T5.1 三类来源

| 来源 | 手段 | 是否跨网同步 |
|---|---|---|
| 软件/快捷方式/文件夹 | `await app.getFileIcon(path, {size:'large'})` → `NativeImage.toPNG()` | **否**，每台机器按自己本机目标提取 |
| 网页 favicon | 管理员侧抓取 → 写入 asset（hash 寻址） | **是**，随 config 的资源一起下发 |
| 兜底单体图 | 首字 + 色相哈希背景，本地生成 | 本地纯函数，零网络 |

不同步本地图标不是省事而是正确：**管理员机器上提取出来的 exe 图标对没有装该软件的员工毫无意义**，且会白白放大同步体积。

#### T5.2 提取顺序（favicon）

1. `GET <scheme>://<host>/favicon.ico`，状态码 200 且非 ico 占位即采纳。
2. 否则抓首页 HTML，用 `node-html-parser` 取 `<link rel="icon|shortcut icon|apple-touch-icon">` 的 `href`，按 base URL 解析。
3. 均失败 → 单体图兜底（保证永远不会出现破图或空白卡片）。
抓取必须带 3 s 超时、≤ 1 MB 大小上限，且**不得阻塞 UI**（异步队列）。

#### T5.3 已知限制（诚实写明）

Electron 44 官方 `app.getFileIcon` 的 `size` 语义为：`small` = 16x16，`normal` = 32x32，`large` = Linux 48x48、**Windows 32x32**、macOS 不支持。
即 **Windows 上拿不到高于 32x32 的系统图标**（这是 `SHGetFileInfo` 体系 imagelist 的现实上限，换 `extract-file-icon` / `icon-extractor-win` 等第三方包也一样，且这些包最后发布于 2018–2022 年，已不活跃）。

缓解方案：
- 卡片图标按 **32 逻辑像素**渲染（正好是 `large` 的原生尺寸，缩放 100% 时无损）；
- 150% 缩放允许轻微上采样；如试点反馈明显糊再跟进——升级路径是引入 `IShellItemImageFactory` 的极小原生插件，**MVP 不做**（会带回 T2.4 规避的原生模块风险）。

#### T5.4 性能设计（体验关键）

- **不得把图标转 base64 经 IPC 传给渲染层**（200 张卡 × 数十 KB = IPC 洪水 + 主线程压力）。
- 采用自定义协议 + 浏览器原生懒加载：
  - `protocol.registerSchemesAsPrivileged([{scheme:'tl-icon', privileges:{standard:true, secure:true}}])`，**必须在 `app.ready` 之前**调用；
  - 主进程 `protocol.handle('tl-icon', handler)`：命中磁盘缓存直接回 PNG；未命中则进**并发上限 4** 的提取队列，提取完落盘再回；
  - 渲染层 `<img src="tl-icon://cache/<cacheKey>" loading="lazy" />`，视口外卡片不触发任何提取。
- 缓存键 `cacheKey = sha1("v1|" + 归一化后的 resolvedTarget)`，落在 `%APPDATA%\TeamLaunch\assets\<前2位>\<hash>.png`；`iconCacheVersion` 自增可整体失效，设置页提供"重建图标缓存"。

### T6 权限与安全

**结论：管理员口令 scrypt 派生存本地 + 挑战应答 + 短时令牌 + 写请求签名；明确指出能防什么、防不住什么。**

#### T6.1 口令落地

- 首次以管理员角色运行进入"设置管理员口令"引导，**无默认口令**（禁止 admin123 之类）。
- 口令最少 8 字符；仅本地记忆强度提示，不在错误文案里泄露口令规则（PRD §14.1）。
- 存储 `credential.json`：`{kdf:'scrypt', N:2**15, r:8, p:1, salt:32B, verifier:32B, createdAt}`。`verifier = scrypt(password, salt, 32)`，**口令明文从不落盘**。使用 Node 内建 `crypto.scrypt`，不引第三方。
- 写文件后用 `icacls` 收敛 ACL 到当前用户，拒绝继承。

#### T6.2 认证握手（口令永不上网）

```
1) 客户端 → POST /api/v1/auth/challenge   {deviceId}
   服务端 ← {challengeId, challenge(32B base64), salt(base64), kdf:{N,r,p}, expiresAt(60s), serverId}

2) 客户端本地计算：
     verifier = scrypt(password, salt, 32)
     proof    = HMAC-SHA256(key=verifier, msg = challengeId + ":" + challenge + ":" + deviceId + ":" + serverId)

3) 客户端 → POST /api/v1/auth/verify      {challengeId, deviceId, proof}
   服务端用自己存的 verifier 重算并用 crypto.timingSafeEqual 比对
   成功 ← {token: base64url(randomBytes(32)), expiresAt: now+8h}

4) 后续写请求必须携带（见 T6.3）
```

- 内存中保存 `verifier` 用于验签，进程重启不丢失（本地文件已有），口令在 UI 解锁后仅驻留在当前进程内存，不写回磁盘。
- **管理端空闲自动退出编辑模式**（PRD §14.1）：默认闲置 10 分钟清除内存中的解锁态，回到只读。

#### T6.3 写请求签名（应对 PRD"TLS 或等价机制"）

PRD 要求"HTTPS/TLS + JWT 短时会话或经架构师确认的等价机制"。本项目是纯内网工具，无 PKI；直接把 bearer token 明文放在 HTTP 上，一旦被嗅探即可被重放用于发布。**因此采用请求签名作为等价机制：**

```
写请求（PUT/POST/DELETE）必须携带：
  Authorization: Bearer <token>
  X-TL-Timestamp: <unix ms>
  X-TL-Nonce:     <随机串，服务端 5 分钟内去重>
  X-TL-Signature: base64(HMAC-SHA256(key=verifier,
                     msg = token + "\n" + method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + sha256(rawBody)))
```
- 服务端校验：时间戳偏差 ≤ 120 s、nonce 未出现过、签名一致，否则 401。
- 收益：即使攻击者嗅探到 token，**没有 verifier（即没有口令）也无法构造任何一次合法发布**；同时天然防重放与正文篡改。
- 成本：一个 `hooks/auth.ts` 中间件，约 80 行，无第三方依赖、无证书维护。
- 局限（必须告知）：**正文仍是明文**，同一局域网内的被动嗅探者可以读到团队入口清单。见下表第 4 行。

#### T6.4 限流与 Lockout

按 `X-TL-Device-Id` 分桶，内存计数（重启清零，可接受）：
- `/api/v1/auth/verify`：5 分钟内 > 10 次失败 → 该设备锁定 15 分钟。
- `/api/v1/feedback`：20 条/设备/小时；同一 `(entryId, reasonCode)` 24 小时内去重。
- `/api/v1/telemetry`：1 批/设备/分钟。
- 全局请求体上限 1 MB（`bodyLimit`），超限 413。

#### T6.5 员工能否绕过口令直接改

**不能。** 唯一的防线在服务端，且是三层：

1. **服务端强制鉴权**：`PUT /api/v1/config`、`POST /api/v1/revisions/{rev}/restore` 未通过签名校验即拒绝。员工端 UI 隐藏编辑入口只是视觉层过滤，**不是安全边界**——这一点是本项目中"缺失系统上下文"这一失效模式的定向防线，开发不得把鉴权只做在 UI。
2. **员工端本地数据不参与同步**：个人页数据只在 `%APPDATA%` 内，永不进入任何请求体。
3. **读取也得经过 schema + contentHash 双重校验**，脏数据来源无论身份都会被拒（防的是被误导，不是被攻击）。

#### T6.6 务实安全边界（必须让团队与试点用户看到）

| 能防 | 防不住 |
|---|---|
| 1. 局域网内"临时起意"的冒名发布（同事写脚本伪造发布） | 1. 对管理员机器有本地文件访问权限的人：可直接删 `credential.json` 重置口令，或直接改配置文件 |
| 2. 口令被嗅探：口令明文从不上网，网上只有一次性 proof | 2. 物理接触管理员机器并取得其 Windows 登录会话的人 |
| 3. 令牌被嗅探后被重放：缺 `verifier` 无法构造签名 | 3. 局域网内的被动嗅探者读取团队入口清单（明文 HTTP） |
| 4. 令牌被盗后的长期冒用：8 小时过期 + 仅内存不落盘 | 4. 员工虚构失效反馈或埋点数据（行为层不作恶，靠反馈去重与聚合削弱） |
| 5. 超大数据轰炸：1 MB bodyLimit + 8 组/200 入口服务端硬上限 | 5. 已在管理员机器上的恶意软件（此时防线应在操作系统与 EDR） |

**口令忘了怎么办**：MVP 不提供找回。在管理员本机删除 `%APPDATA%\TeamLaunch\credential.json` 后重启客户端，即回到首次运行引导重设口令。这条本身就是"本地访问权 = 管理权"的诚实体现，必须写进试点说明，不能包装成一种安全功能。
**升级路径（P1）**：自签证书 + 首次连接时公钥固定（TOFU），把第 3 条也纳入防护范围。

### T6.7 数据与容量硬上限（服务端强制）

| 约束 | 值 | 位置 |
|---|---|---|
| 分组数 | ≤ 8 | 服务端 zod + UI 预览 |
| 团队入口总数 | ≤ 200 | 服务端 zod + UI 预览 |
| 名称长度 | 1–40 字符 | zod |
| 说明长度 | ≤ 80 字符 | zod |
| URL | `http(s)` scheme，长度 ≤ 2048 | zod |
| 请求体 | ≤ 1 MB | Fastify bodyLimit |

服务端必须校验，不得只做在管理员 UI 上。

### T7 离线与降级

- **缓存位置**：`%APPDATA%\TeamLaunch\`（Electron `app.getPath('userData')`），完整布局见 §5。
- **落盘**：每次成功同步的结果均采用原子替换——写 `team-current.json.tmp` → `fsync` → `rename` 覆盖。任何中断都不会留下半截文件。
- **失效策略**：**缓存不按时间过期**。离线用户可能隔天甚至隔周才连上，按时间失效会造成"有数据却不用"的糟糕体验。只在成功拿到更高 revision 时替换。
- **离线判定**（不引入 Windows NLM API，避免复杂度）：启动同步总预算 3 s 内未拿到任何可用远端响应 → `SyncState=OFFLINE`。细分两种文案：
  - **未发现服务**：L3 也没有任何应答 → "未找到同步服务（管理员可能未开机）"；
  - **服务有响应但请求失败**：访问放宽到 HTTP 层失败 → "服务异常或被防火墙拦截"，并给出诊断页引导。
- **UI 行为**：顶部状态条 + "数据时间"（取自服务端 `X-TL-Published-At`，**不用本机时钟推算**）；离线时卡片照常可点，本地软件与文件夹不受影响；从未成功同步过且管理员不可达 → 走 PRD §11.4 的空状态文案，禁止展示示例卡片。
- **优先渲染本地缓存**：启动即先渲染磁盘上的 `team-current.json`（目标 < 1.5 s 出卡片），同步结果异步回来再做软更新；> 300 ms 未完成则显示骨架屏（PRD §13）。

### T8 迁移到独立服务器的预留

架构上只做四件事，其余一行代码都不为将来写：

1. **服务地址唯一出口**：客户端所有远端访问只能经 `discovery/endpoint-resolver.ts` 解析出的 `baseUrl` 发出；`settings.serviceUrl` 一旦有值，**优先级最高**（L0），迁移时只需下发这一个配置。
2. **`src/server/**` 零 Electron 依赖**：该目录可被 `node dist/server/app.js` 直接拉起成为独立服务。这是可 grep 的硬约束（§3.2 守卫命令 1）。
3. **API 从第一天起带版本前缀** `/api/v1/`；不兼容变更新增 `/api/v2/`，v1 至少并行 6 个月。
4. **`instanceId` / `serviceId` 随每次响应下发**：客户端可以识别"数据源换了 instance"，避免接错到另一套团队数据上。

不做的事：**不为"将来可能有 LAN 访问"、"将来可能多管理员"预留任何代码分支**。真到了那天，改的是这四处，不是全局。

---

## 5. 数据模型

存储位置一律 `$APPDATA = app.getPath('userData')`（Windows 下 `%APPDATA%\TeamLaunch`）。全部为 UTF-8 JSON 与 PNG。

### 5.1 文件布局

```
%APPDATA%\TeamLaunch\
├── settings.json            本机设置（只放用户意图，字段集见 §5.2）
├── discovery.json           发现缓存：上次成功端点（ADR-002 L1）+ 上次 L3 扫描时间
├── identity.json            deviceId / anonId / 安装时间
├── credential.json          仅管理员：scrypt 派生参数与 verifier
├── cache\
│   └── team-current.json    团队配置缓存（员工端只读；管理员端为权威源）
├── config\
│   └── personal.json        个人入口（本机，永不进网）
├── revisions\
│   ├── index.jsonl          变更记录追加日志（保留最近 20 条）
│   └── 0000000128.json      发布快照（滚动保留最近 20 个）
├── assets\
│   └── <hash前2位>\<hash>.png   图标缓存：本地提取结果 + 同步下发的资源
├── outbox\
│   └── feedback.jsonl       待发送反馈（离线队列）
├── events\
│   └── events.jsonl         本地埋点环形缓冲
└── logs\
    └── main.log
```

### 5.2 `settings.json`

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
字段集以 `src/shared/schema/local.ts` 的 `SettingsSchema` 为机器可执行版本，两者必须一致（校验门会跑默认值断言）。

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `schemaVersion` | int | 1 | 文件结构版本，用于迁移 |
| `role` | enum `admin` / `member` | `member` | 决定内置服务是否启动与关闭行为。**默认 member 是安全默认值**：不显式开启就不起服务 |
| `serviceUrl` | string? | null | L0 手动覆盖；迁移开关 |
| `autoLaunch` | boolean | true | 开机自启 |
| `trayEnabled` | boolean | true | 托盘常驻 |
| `hotkey` | string | `Ctrl+Space` | 全局热键加速器串 |
| `pollIntervalMs` | int | 30000 | 轮询间隔（schema 夹紧 5s–300s） |
| `editIdleTimeoutMs` | int | 600000 | 管理员解锁闲置自动退出（PRD §14.1） |
| `theme` | enum `system`/`light`/`dark` | `system` | 跟随系统；读取失败兜底深色（Spec §8） |
| `telemetryEnabled` | boolean | true | 可关闭；**关闭即刻停止本地记录并清空未发送缓冲**，不只是停止上传（见 §11.3） |
| `telemetryNoticeAckedAt` | string? | null | 首次隐私说明已确认时间。**未确认前一律不发送任何上报** |
| `iconCacheVersion` | int | 1 | 自增使全部图标缓存失效 |
| `deletedConflictPolicy` | enum | `ask` | 个人导入 ID 冲突策略：ask/skip/overwrite/copy（AC-15 禁止静默覆盖） |

**两处改名/删字段，开发按新表实现**：
1. `telemetryUpload` → **`telemetryEnabled`**。原名字会被读成"只控制上传"，而 AC-18 要求关闭时**停止记录并清空缓冲**；名字必须不暗示错误语义。
2. **删除 `knownEndpoints`**。端点记忆是机器维护的高频状态，唯一所有者是 `discovery.json`（ADR-005）。一个事实不允许两个写入点。

### 5.3 团队配置文档（同时也是同步报文体）

```jsonc
{
  "schemaVersion": 1,
  "instanceId": "0f7a...",              // 团队数据源 UUID
  "revision": 128,                      // 单调递增，永不复用
  "contentHash": "sha256:9f2c...",      // 对去掉 revision/contentHash 后的规范 JSON 计算
  "publishedAt": "2026-09-29T12:00:00.000Z",   // 服务端时间
  "groups": [
    {
      "id": "g01",
      "name": "日常办公",
      "sort": 0,
      "entries": [
        {
          "id": "e01",
          "type": "app",                // app | folder | web
          "name": "企业微信",
          "description": "内部沟通",
          "keywords": ["企微", "wxwork"],
          "sort": 0,
          "target": "%LOCALAPPDATA%\\WXWork\\WXWork.exe",  // app/folder
          "sourcePath": "C:\\...\\企业微信.lnk",            // 原始快捷方式，用于重新解析
          "args": "",
          "cwd": "",
          "expandEnv": true,
          "url": null,                                     // 仅 web
          "icon": { "kind": "local" },                     // local | asset | fallback
          "iconAssetHash": null,                           // kind=asset 时的资源哈希
          "updatedAt": "2026-09-29T12:00:00.000Z"
        }
      ]
    }
  ]
}
```

**`icon.kind` 语义（关键设计）**
- `local`：每台客户端按自己的 `target` 本地提取，**不跨网同步**（管理员机器上提取的 exe 图标对没装该软件的员工无意义，且会放大流量）。
- `asset`：由 `iconAssetHash` 指向 `%APPDATA%\TeamLaunch\assets\`，随服务同步下发（favicon 与管理员上传图标走这里）。
- `fallback`：本地生成的首字单体图。

### 5.4 `index.jsonl`（变更记录，每行一条）

```json
{"revision":128,"publishedAt":"2026-09-29T12:00:00.000Z","operatorDeviceId":"anon-...","summary":"新增 2 项、修改 1 项、删除 0 项","diff":{"added":2,"updated":1,"removed":0}}
```

- 追加写 + 读取时 **tail 20**（保留策略：超过 20 条重写为新文件，原子替换）。快照文件 `revisions/0000000128.json` 同步滚动清理至最近 20 个。
- PRD §13：版本序列只增不减，**回滚也必须新增 revision**，历史因此始终线性可追溯，客户端不需要任何"版本回退"分支。

### 5.5 `personal.json`

结构与 groups/entries 同构（复用同一 zod entry schema，但不含 `revision` 相关字段），额外带 `exportedAt` 便于导出。导入流程：
1. zod 全量校验通过才允许继续（AC-15：非法 JSON 不得改动现有数据）；
2. 预览新增/覆盖/冲突数量；
3. ID 或 target 冲突按 `deletedConflictPolicy` 处理，默认 `ask`，**绝不静默覆盖**。

### 5.6 索引策略（JSON 存储的等效做法与边界）

- **内存即主索引**：进程启动时把 `team-current.json` / `personal.json` 全量读入并建立 `Map<groupId, Group>` 与 `Map<entryId, Entry>`，以及搜索用的倒序联想表（名称/关键词/分组名/路径末级/域名，均做小写 + 去符号归一化）。
- **写入**：全量序列化 + 原子替换；MVP 规模下（≤700 条）单次 < 5 ms。
- **IO 最小化**：每个关注点一个文件，避免"改一个入口重写整个库"以外的额外 IO；磁盘本身也是最后的容灾副本。
- **边界与 MySQL 迁移触发点**：当团队入口 > 2000 条或个人入口 > 5000 条，或需要跨条件的复杂查询时，迁移到 SQLite。届时只重写 `repositories/`，service 与 API 不变（ADR-005）。

---

## 6. API 端点清单

基址：`http://<管理员主机>:<17890..17899>`，所有路径带 `/api/v1/`。统一信封 `{code, data, message}`，`code = 0` 表示成功；资源类接口直接返回二进制。

| # | Method | Path | 功能 | 认证 | 请求 | 响应 |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/health` | 存活探测；发现后确认端口 | 无 | — | `{status:'ok', role:'admin', serviceId, instanceId, revision, httpPort, serverTime}` |
| 2 | GET | `/api/v1/config` | 拉取团队配置（条件请求） | 无 | 头 `If-None-Match` | 200 `{团队配置文档}` + `ETag`；304 空体 |
| 3 | GET | `/api/v1/changes` | 变更记录增量 | 无 | `?since=<rev>&limit<=20` | `{items:[Change], latestRevision}` |
| 4 | GET | `/api/v1/assets/{hash}` | 图标资源（不可变） | 无 | — | `image/png`，`Cache-Control: public, max-age=31536000, immutable` |
| 5 | POST | `/api/v1/auth/challenge` | 申请挑战 | 无 | `{deviceId}` | `{challengeId, challenge, salt, kdf, expiresAt, serverId}` |
| 6 | POST | `/api/v1/auth/verify` | proof 换令牌 | 无 | `{challengeId, deviceId, proof}` | `{token, expiresAt}` |
| 7 | PUT | `/api/v1/config` | 发布新版本 | Bearer + 签名 | `{baseRevision, config, summary}` | 200 `{revision, contentHash, publishedAt}`；409 `{currentRevision}` |
| 8 | GET | `/api/v1/revisions` | 发布历史（含操作设备） | Bearer + 签名 | `?limit<=20` | `{items:[RevisionMeta]}` |
| 9 | POST | `/api/v1/revisions/{revision}/restore` | 以指定版本内容生成新版本 | Bearer + 签名 | `{baseRevision}` | 200 `{revision, contentHash, publishedAt}`；409 `{currentRevision, currentContentHash}` |
| 10 | POST | `/api/v1/feedback` | 员工上报失效（可离线排队） | 仅 deviceId 限流 | `{items:[{entryId, entryRevision, reasonCode, occurredAt}]}` | `{accepted, duplicated}` |
| 11 | GET | `/api/v1/feedback/summary` | 按入口聚合的失效反馈 | Bearer + 签名 | `?since=` | `{items:[{entryId, deviceCount, latestAt, reasonCounts}]}` |
| 12 | POST | `/api/v1/telemetry` | 匿名埋点批量上报 | 仅 deviceId 限流 | `{items:[{name, ts, props}]}` | `{accepted}` |
| 13 | GET | `/api/v1/diagnostics` | 巡检信息（一屏定位） | Bearer + 签名 | — | `{topIssue, checks[], listening, expectedPortRange, portDrifted, firewallRules[], activeNetworkProfile, lanAddresses[], telemetryCompleteness, peerCheckHint}`；`topIssue` 优先级见 §14.2 |

**错误码字典**（HTTP 状态 + 机器可读 `code`）

| HTTP | `code` | 触发 |
|---|---|---|
| 400 | `ERR_BAD_REQUEST` | 结构非法 |
| 401 | `ERR_AUTH_REQUIRED` / `ERR_BAD_PROOF` / `ERR_CHALLENGE_EXPIRED` / `ERR_TOKEN_INVALID` / `ERR_SIGNATURE_INVALID` | 鉴权全链路 |
| 403 | `ERR_ROLE_MISMATCH` | 目标不是管理员实例 |
| 409 | `ERR_REVISION_CONFLICT` | `baseRevision` 与当前不符（PRD §13 发布冲突） |
| 409 | `ERR_INSTANCE_MISMATCH` | 连到了另一个数据源实例 |
| 413 | `ERR_PAYLOAD_TOO_LARGE` | 超过 1 MB 或超出 8 组 / 200 入口 |
| 422 | `ERR_VALIDATION_FAILED` | zod 校验失败，附带字段路径 |
| 429 | `ERR_RATE_LIMITED` | 触发限流或锁定 |
| 500 | `ERR_INTERNAL` | 未预期错误，附 `diagnosticId` |

> **实现约定（终版）**：
> - 端点请求/响应 Schema 的**唯一来源**是 `src/shared/schema.ts`（zod 4.6.5），本文表格只作速查。
> - 机器可读契约是 `docs/api/openapi.yaml`（终版 FINAL，已去 Draft 标记）。前后端联调以它为唯一依据，**任何变更先改契约文件再改代码**。
> - 两者的一致性由 `scripts/verify-schema.mjs` 强制校验（required 字段、枚举逐项比对），openapi 自身结构由 `scripts/verify-openapi.cjs` 强制校验。见 §14.1。
> - `src/shared/schema.ts` 刻意不包含 `/diagnostics` 响应体：该结构随巡检项演进，由 openapi 的 `DiagnosticInfo` 单独约束，Phase 3 再按需落窄 schema。这是**已登记的取舍**，不是遗漏。

---

## 7. 关键流程

### 7.1 员工端启动与同步

```
应用启动
  │
  ├─ requestSingleInstanceLock 失败 → 聚焦已有实例并退出
  ├─ 读 %APPDATA% 下 settings / identity / personal / team-current(缓存)
  ├─ 立刻用缓存渲染团队卡片（目标 < 1.5 s，> 300 ms 显示骨架屏）
  │
  └─ 并行启动 SyncService
        ├─ resolveEndpoint() 执行 L0→L3 阶梯发现
        │     命中 → discovery.json[命中项].lastSuccessAt = now（按 §5.1 节流写入）
        │     未命中 → SyncState = OFFLINE_NOT_FOUND → 走 §7.3
        ├─ GET /api/v1/config  (If-None-Match = 本地 revision-contentHash)
        │     304 → nothing changed，不重绘
        │     200 → 三重校验：zod 通过 且 sha256(body)==contentHash 通过 且 revision 单调递增
        │              ├─ 通过 → 原子写 team-current.json → 软更新 UI（保留 Tab/滚动/搜索词）
        │              └─ 任一失败 → 保留旧缓存 + 提示"更新未完成，仍使用上一版本"
        └─ 启动 30 s 轮询；flush 离线反馈队列；批量上报埋点
```

### 7.2 管理员发布

```
解锁编辑模式（本地口令 → scrypt 校验；闲置 10 min 自动退出）
  │
  ├─ 编辑产生本机草稿（员工不可见）
  ├─ 点击发布
  │    ├─ 本地预校验：名称非空 / 类型与目标匹配 / URL 合法 / 重复目标提示 /
  │    │              8 组 & 200 入口上限 / 已下线提示（PRD §13 容量边界）
  │    ├─ 生成变更摘要 "新增 2 项、修改 1 项、删除 0 项"，管理员可补充说明
  │    └─ 服务端 PUT /api/v1/config {baseRevision, config, summary}
  │          ├─ 401/403 → 要求重新解锁
  │          ├─ 409 → 展示差异，强制先看最新版本再发布（禁止静默覆盖）
  │          ├─ 422 → 定位到问题项，保留未发布编辑
  │          └─ 200 → revision+1 → 写快照 + append index.jsonl（滚动 20 条）
  │                    → 重算内存 currentSnapshot
  │                    → 员工下一次 30 s 轮询命中（p95 ≤ 45 s）
  └─ 发布历史（仅查看，MVP 不做一键回滚）
```

### 7.3 离线降级

```
SyncService 总预算 3 s 未获可用响应
  │
  ├─ 判定分支
  │    ├─ L3 也零应答        → OFFLINE_NOT_FOUND：「未找到同步服务（管理员可能未开机）」
  │    └─ 有 TCP 连接但请求失败 → OFFLINE_UNREACHABLE：「服务异常或被防火墙拦截」→ 引导诊断页
  │
  ├─ 有缓存 → 渲染 team-current.json
  │           顶部状态条：「离线 · 数据时间 <服务端 publishedAt>」
  │           卡片照常可点；本地软件/文件夹不受影响
  │           反馈写入 outbox/feedback.jsonl（≤200 条 / 30 天）
  ├─ 无缓存 → 空状态：「暂时无法获取团队入口。你仍可使用我的入口，并可稍后刷新。」
  │           禁止展示示例卡片，禁止空白页
  └─ 恢复触发：手动刷新 / 30 s 轮询 / powerMonitor resume / 网络变更
               → 自动 flush 反馈队列 → 恢复在线状态
```

---

## 8. 性能 checklist（每项都要可被验证）

| 项 | 目标 | 架构手段 |
|---|---|---|
| 有缓存时团队卡片可见 | p95 < 1.5 s | 磁盘缓存直读 + 立即渲染，同步异步后置 |
| 局部搜索首批结果 | < 300 ms | 启动时建归一化倒序联想表，**全内存**过滤，禁止触发任何磁盘 IO |
| 新版本到达显示（在线） | p95 ≤ 45 s | 30 s 轮询 + 单次 ≤ 15 s 预算 |
| 同步 API | p95 < 500 ms | 内存快照响应，请求路径零磁盘 IO |
| 200 张卡片图标 | 不阻塞首屏 | 自定义协议 + `loading="lazy"` + 并发 4 提取队列 + 磁盘缓存 |
| 主进程不卡死 | 0 次 | **禁用一切 `*Sync` IO**；UNC 路径访问一律异步 + 超时竞速 |
| IPC 洪泛 | 0 次 | 图标不跨 IPC 传 base64；列表一次性传结构不传图片 |
| 轮询请求堆积 | 0 次 | 上一轮未结束跳过本轮 |
| 网络资源遍历 | ≤ 1 MB | 图标请求体大小上限 + 超时 3 s |

## 9. 安全 checklist（对照 PRD §14.1 与 §16.3）

- [ ] 口令明文不落盘、不上网（scrypt verifier + 挑战应答）
- [ ] 写请求令牌 + 请求签名双重校验，**服务端**强制（不依赖 UI 隐藏）
- [ ] 8 组 / 200 入口 / 1 MB 体积在服务端 zod 层硬校验
- [ ] 容量与重复目标的拦截在发布前可见，定位到具体项
- [ ] 管理人员口 demise 口令连续失败限速 + 锁定；错误文案不泄露口令规则与服务细节
- [ ] `X-TL-Timestamp` ±120 s 窗口 + nonce 5 分钟去重（防重放）
- [ ] 反馈限流 20 条/设备/小时，同 `(entryId, reasonCode)` 24 h 去重
- [ ] 反馈不含任何自由文本字段（对齐 PRD 隐私条款）
- [ ] 埋点不采集 IP、原始搜索词、完整路径、URL 查询串、硬件序列号；服务端**不记录任何请求来源 IP**（日志禁用 `remoteAddress`、`req.ip`，访问日志不含对端信息）
- [ ] 埋点**零外网出口**：运行时校验目标主机为 RFC1918 / link-local，否则丢弃；CI 静态门禁禁止埋点模块出现写死的外网 URL
- [ ] 首次隐私说明未确认前（`telemetryNoticeAckedAt == null`）不发送任何上报
- [ ] 设置中关闭埋点 ⇒ 立即停止本地记录 + 清空未发送缓冲 + 不再发起请求
- [ ] 管理员侧只提供聚合健康数据，不提供单设备行为序列回放
- [ ] `credential.json` 写后立即 `icacls` 收敛 ACL
- [ ] 渲染进程 sandbox=true、contextIsolation=true、nodeIntegration=false；IPC 走 typed-ipc 白名单
- [ ] 打开目标一律 `shell:false` + 数组传参；不支持 `runAsAdmin`
- [ ] 防火墙规则限制 `-RemoteAddress LocalSubnet` 且仅 `Domain,Private` 配置文件
- [ ] 不实现、不代持任何形式的自动脚本执行能力

## 10. 已知技术风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | Windows 防火墙入站拦截，员工连不上 | **高** | NSIS 提权安装时创建规则；`-RemoteAddress LocalSubnet`；诊断页显示规则状态与活动配置文件；提供一键提权修复 |
| R2 | 活动网络为 Public 配置文件，规则不生效 | **高** | 诊断页显式检测并给出切换指引；这是现场最高频故障，试点必须覆盖 |
| R3 | UNC/断线映射盘同步 IO 卡死主线程 | **中高** | 全面禁用 `*Sync`；异步 + Promise.race 超时（本地 500 ms / UNC 1500 ms） |
| R4 | 管理员 IP 因 DHCP 变化 | **中** | 阶梯发现 L2/L3 兜底并回写 `discovery.json`；信标随包广播真实端口 |
| R5 | 端口占用 / 多实例冲突 | **中** | 17890–17899 探测；`requestSingleInstanceLock`；真实端口由信标下发 |
| R6 | `app.getFileIcon` Windows 上限 32x32 | **中** | 卡片按 32 逻辑像素渲染；明确写入已知限制；升级路径为极小原生插件（MVP 不做） |
| R7 | UWP 应用快捷方式解析不到可执行文件 | **中** | 保留 `sourcePath`，回退 `shell.openPath(sourcePath)` |
| R8 | mDNS / 组播在本环境不可用 | — | 已规避（不使用 mDNS），见 ADR-002 |
| R9 | 明文 HTTP 可被同网被动嗅探 | **中** | 已文档化的边界（§6.6）；写请求强签名使嗅探无法用于发布；P1 升级 TOFU 证书 |
| R10 | 30 s 轮询在部分环境被安全软件误判 | **中** | 仅发往已确认端点；失败 2 次才重新扫描；扫描限频 5 分钟 1 次 |
| R11 | 网段 TCP 扫描触发 EDR 告警 | **中** | 扫描为 L3 末位手段，UI 明示，限频；设置中可在严格管控网络下整体关闭 |
| R12 | Electron 44 clipboard 破坏性变更 | **低** | 复制诊断/文案全部经 preload IPC 通道，渲染层不直接用 clipboard |
| R13 | TypeScript 7 与部分构建插件不兼容 | **中** | 已锁定回退版本 5.9.3；一旦构建报错整体回退并更新 §1.1 |
| R14 | Node-API 原生模块编译失败 | — | 已规避：**零原生模块**（这也是不引入 better-sqlite3 的核心原因） |
| R15 | Ctrl+Space 与输入法冲突 | **中** | `globalShortcut.register` 返回 false 即提示改键；托盘与主窗口入口始终可用（AC-05） |
| R16 | 员工时钟不准 | **中** | 版本先后只比 revision；"数据时间"取服务端 `publishedAt` |
| R18 | 轮询间隙把"未取到的新版本"表达成"已是最新" | **中高** | 状态机唯一真源（T3.6）：`ONLINE_LATEST` 有效期只到下一轮轮询开始，轮询未成功完成即退回离线/未知；UI 禁止自行推导在线状态 |
| R19 | 遥测被误读为监控，员工成规模关闭 | **中** | 首次说明聚焦入口健康与同步状态、明确不评价个人；开关可见；试点观察关停率（PRD §17） |
| R20 | 埋点模块意外产生外网出口 | **中** | 运行时 RFC1918 目标校验 + CI 禁止写死外网 URL + 依赖白名单，三层防线（§11.1） |
| R21 | `sampleJudgable` 长期为 false（遥测在当前管理员在线模式下不可用） | **中** | **既定产品处置路径：回到 P1「管理员内容健康中心 + 逐项人工确认」，而不是改用云端方案**（见下方 R21 专项说明） |
| R22 | 用残缺样本硬判定入口健康，导致管理员删改本属正常的入口 | **中高** | 已通过 PM 的"条件判定"机制根除：`sampleJudgable=false` 时入口健康不设硬门槛，只做参考（ADR-008 §样本残缺与可判定性） |

### R21 专项说明：样本不可判定时的既定路径（不得向上推翻）

PM 明确的判定归宿，登记在此以免未来争议：

- **触发**：试点期间 `GET /api/v1/diagnostics` 的 `telemetryCompleteness.sampleJudgable` 长期为 `false`（丢失率 ≥ 20%，或设备覆盖率 < 70%）。
- **含义**：这只说明**遥测在当前管理员在线模式下拿不到足够样本**，不等于入口有问题，也不等于遥测方案本身失败。
- **既定处置**：转向 P1 的「管理员内容健康中心 + 逐项人工确认」路径，靠管理员确认与失效反馈闭环维持入口健康。
- **明确不做**：**不得**以此为由把遥测迁到云端或引入第三方互联网埋点服务。理由已在 ADR-008 论证：这会导致 §16.2"第三方外网域名 0 条"的一票否决指标无法达成，并违反 §14 的隐私边界。
- **可复核**：若要推翻本条，必须同时提出"如何在不引入外网域名、不记录来源 IP 的前提下提升样本量"的方案，并由 PM 与架构师共同评审。
| R17 | Electron 44 是否仍支持 Windows 10 22H2 | **低** | 试点首日验证并在本机 + 一台 Win10 22H2 上冒烟；若不支持则降级到 Electron 43.7.5 并更新 ADR-001 |

## 11. 埋点（T9）决策

对齐 PRD v1.1 §15.3 / §15.3.1 / §15.3.2（PM 已确认：默认开启、不做默认关闭）。

- **不上第三方互联网埋点服务。** 采用自建 `trackEvent()` 封装 + 本机 `events/events.jsonl` 环形缓冲（**≤5000 条或 14 天，先到者滚动淘汰**），仅在用户未关闭时批量上报到管理员侧 `/api/v1/telemetry`。理由：纯内网团队工具，把使用数据出网既违反产品隐私定位，也额外增加外网依赖。
- `user_id` = 本地一次性安装匿名 ID：`anonId = base64url(hmacSha256(installSalt, deviceId)).slice(0,22)`，**非账号、非手机号、非硬件序列号、不可逆**。
- 事件字典完全对齐 PRD §15.2（`page_view`、`sign_up_complete`、`first_core_action`、`entry_open_attempted`、`entry_open_dispatched`、`entry_open_failed`、`team_sync_completed`、`offline_cache_rendered`、`entry_feedback_submitted`、`team_publish_completed`、`session_start`、`session_duration`、`error_occurred`）。
- 硬约束：同一失败在轮询循环中**不得重复上报**（单一失败 ←→ 单一 `error_occurred` 去重键）；上报失败永不影响入口打开。

### 11.1 零外网出口（可验证的硬约束，对应 PRD §16.2 隐私合规指标）

埋点模块**只允许向 `discovery/endpoint-resolver.ts` 解析出的局域网端点发送**，不得出现任何写死的外部域名或 IP。三层防线：

1. **运行时护栏（必做）**：发送前校验目标主机，非 RFC1918（`10/8`、`172.16/12`、`192.168/16`）或 link-local（`169.254/16`）一律**直接丢弃并记录一条本地警告**，不发请求。
2. **静态检查（CI 门禁）**：`src/main/services/telemetry.service.ts` 中不得出现任何字面 `http://` / `https://` 常量，除例外白名单（无）外一律构建失败。
3. **依赖白名单**：不引入任何外网 SDK。Pino/HTTP 客户端仅用于局域网。

### 11.2 服务端不得记录来源 IP（含访问日志）

PRD §15.3 明确"服务端不得记录来源 IP，访问日志也不记录"。落地方式：

- Fastify 日志自定义序列化器，**显式剔除 `req.remoteAddress`、`req.ip`、`req.socket`**；
- 访问日志只输出 `method / path / status / durationMs`，不输出任何对端信息；
- `/api/v1/telemetry` 与 `/api/v1/feedback` 的不落盘数据只保留 `anonDeviceId`（客户端上报），不补充任何服务端侧来源字段；
- 诊断端点返回 `knownClients` 只给设备数量与最后活跃时间的粗粒度桶，不给明细。

### 11.3 首次隐私说明与关闭开关

PRD §15.3.1 要求首次启动必须说明且提供关闭开关。这意味着**存在一条必须实现的状态门**：

- `settings.telemetryNoticeAckedAt == null` ⇒ **一律不发送任何上报**（即使用户尚未主动设置）。首次启动展示说明，说明文案必须讲清三件事：**上报什么**（匿名编号 / 版本 / 成功失败次数与原因类别，不含原始搜索词、完整路径、个人入口内容、IP）、**为什么**（帮助发现打不开的入口和同步状态，不评价个人）、**如何关闭**（设置开关位置与关闭影响）。

**隐私门的实现口径：零记录（PM 已裁定"禁止预缓冲"，并允许"直接零记录"）**

- **采用零记录，不做内存暂存。** 在 `trackEvent()` 入口处即判定：`telemetryNoticeAckedAt == null` ⇒ 事件直接丢弃，**不写内存、不写盘、不跨启动保留**。
- 不做"先缓冲、确认后补发"：预缓冲已把行为落进本机文件，一旦实现走样或用户长期不确认，就退化成事实上的"先采集后追认"，无法向员工解释。
- 不做"内存暂存、确认即写入"：内存暂存只在需要回填时才有意义，而遥测**没有本机离线消费场景**，且试点已接受样本缺失，暂存换不来任何价值，只多一处跨启动状态与潜在泄漏点。
- `events/events.jsonl` 与 `events/tel-stats.json` **只在确认后才创建**；未确认前磁盘上不存在任何遥测文件。

**零记录的一个真实代价（需 PM 知悉）**：`sign_up_complete`、`first_core_action` 是"一次性首次事件"。零记录意味着**用户确认说明之前发生的首次行为会被永久丢弃，且之后不会补发**（`first_core_action` 只在首次成功打开时触发一次）。这会低估激活漏斗，且是静默的——数据看起来正常，只是起点偏少。
两个可选处理，请 PM 定：
  (a) **接受丢失**：激活指标只统计"确认说明后"的用户，口径明确但分母变小；
  (b) **确认后重定义首次**：把"确认之后的第一次成功打开"记为 `first_core_action`，指标口径变为"同意遥测后的首次动作"，与原先语义略有差异但样本完整。
在 PM 裁定前，实现按 (a) 走（不丢埋点逻辑，只因未确认而不记录）。
- 若用户未确认，保持未发送状态，功能本身完全可用。
- 本机 `events/events.jsonl` 是**纯批量发送队列，不是离线消费数据**：PM 已确认遥测没有本机离线消费场景，所以本地保留只为攒批，这也正是"关闭即彻底停止本地记录"成立的前提（见 §11.3）。
- **关闭语义（采用更严格的一档，PM 已确认按此实现）**：用户在设置中关闭后，① 立即停止本地记录新事件；② **立即清空本机尚未发送的缓冲事件**；③ 不再发起任何上报请求。PM 明确要求**不得实现成"只停上行、继续本地记"**。
- 管理员侧只能查看**聚合健康数据**，不得查看单个设备的行为序列；`/api/v1/feedback/summary` 与 `/api/v1/telemetry` 的读取接口不得提供按设备回放明细的能力。

### 11.4 遥测完整度自证（对应 PRD 新增"数据完整度"指标）

PM 已把入口健康指标改为**条件判定**：只有下面两个完整度指标达标，"试点两周后仍被报告失效的入口占比 < 5%"才作为硬判定，否则只做参考 + 逐项人工确认。所以这两个值必须**可被系统算出来**，不能靠人工估算。

指标 1：**事件丢失率 < 20%**

- 每个客户端维护一个持久化计数器 `events/tel-stats.json`：`{recorded, uploaded, droppedByEviction, droppedByRetention}`。
- `droppedByEviction` = 环形缓冲超过 5000 条被挤掉；`droppedByRetention` = 超过 14 天被淘汰。两者均发生在尚未上传的事件上。
- `丢失率 = (droppedByEviction + droppedByRetention) / recorded`。
- 计数器随 `/api/v1/telemetry` 每批上报携带（作为该批的元数据随行），服务端汇总成全局丢弃率。

指标 2：**上报成功设备覆盖 ≥ 70% 试点设备**

- 分母 = 同期曾成功调用 `/api/v1/config` 的**匿名设备数**；分子 = 同期曾成功调用 `/api/v1/telemetry` 的**匿名设备数**。
- 两端均只用 `anonDeviceId`（客户端上报）做去重计数，**服务端不记录来源 IP**，因此该指标与我方隐私约束不冲突。
- 服务端只需维护两个匿名 ID 集合的实时计数，不落任何个人维度数据。

服务端侧只读暴露入口：`GET /api/v1/diagnostics` 返回 `telemetryCompleteness`（事件总数、已上传、丢弃数、丢弃率、配置侧设备数、上报侧设备数、覆盖率）。**PM §16.3 Go/No-Go 的"遥测样本可判定"一条直接以该字段为准**，试点当天查一次即可完成判定，不需要人工二次加工。

补充：管理员在线窗口本身就是 `team_sync_completed` 事件的既有证据，不需要新增机制，试点计划记录在线时段即可。

## 12. 端到端验证步骤（跑通才算完成）

前置：管理员机 A（Win10 22H2 或 Win11）、员工机 B（不同机型），同一局域网，交换机或办公 Wi-Fi 均可。

```
1) 安装
   A 与 B 均以 NSIS 安装包安装（A 的安装器必须已创建两条防火墙规则）
   PowerShell 校验：Get-NetFirewallRule -DisplayName "TeamLaunch Sync TCP" | Format-Table Enabled,Profile

2) 管理员侧首次运行
   A 首次启动 → 强制设置管理员口令 → 进入普通模式（无编辑把手）
   解锁编辑 → 界面出现显式"编辑模式"标记

3) 发布
   新增 2 个分组 + 5 个入口（≥1 软件 + ≥1 文件夹 + ≥1 网页），发布
   期望：版本号 +1；发布历史新增 1 条含摘要；校验 GET /api/v1/revisions 返回一致

4) 员工同步
   B 启动 → 期望 3 s 内渲染卡片；重复打开下一次 → 有缓存时卡片可见 < 1.5 s
   A 再发布一次 → B 在 ≤45 s 内软更新，且 Tab/滚动位置/搜索词不丢失

5) 无变化不重绘
   A 不发布 → B 连续两轮轮询 → 期望抓包看到两条 304，UI 无任何重绘

6) 离线
   关闭 A 的 TeamLaunch → B 期望 3 s 内判定离线并显示"数据时间"，卡片仍可点
   B 反馈一条失效 → 离线入队 → 重新打开 A → 期望自动补发，管理员侧按入口聚合可见

7) 故障注入（四类必过）
   a. 软件未安装 → "本机未找到该软件" + 可复制诊断
   b. 共享路径无权限 → "当前无权限访问该位置"
   c. URL 格式错误 → 发布阶段即被拦截，定位到该卡片
   d. 手工把 B 的 team-current.json 改成残缺 JSON → 期望保留旧缓存，
      服务端发布的下一版若校验失败同样应保留旧缓存（原子写 + 三重校验验证）

8) 竞态与去重
   连续快速点击同一卡片 5 次 → 只启动 1 个实例
   Ctrl+Space 冲突场景 → 提示改键，不反复弹窗

9)安全
   在 B 上用 curl 直接 PUT /api/v1/config（无签名）→ 期望 401，团队数据未变
   连续 11 次错误 proof → 期望 429 且该设备被锁定 15 分钟

10) 埋点隐私抽查
    检查 events.jsonl 与服务端日志 → 不得出现 IP、原始搜索词、完整路径、URL 查询串、硬件序列号
    抓包验证 → 遥测出站只允许出现在已解析出的局域网端点上，第三方外网域名 0 条
    服务端日志验证 → 访问日志不含对端 IP 或 socket 信息

11) 状态不误导（对应 R18）
    B 成功同步一次后显示"已是最新" → 立即关闭 A 的服务
    期望：B 在下一轮轮询失败后状态退回"未找到/不可达"，**不得沿用"已是最新"**
    B 手动点击刷新 → 期望立即发起请求并给出可感知结果（成功/无变化/离线）

12) 遥测开关
    B 首次启动 → 期望先看到隐私说明；未确认前抓包确认零遥测出站
    设置中关闭遥测 → 期望本机 events.jsonl 未发送部分被清空，且此后抓包零遥测出站
    额外验证：关闭后检查不再产生新的本地事件记录（不得实现成"只停上行、继续本地记"）
    可用性验证 → 5–8 名非项目成员均能找到并成功关闭该开关

13) 反馈不得谎报成功（对应 T3.7）
    B 在离线状态下提交一条失效反馈 → 期望界面明确标记"待发送"，
    不得出现"已提交/已反馈成功"类文案
    恢复连接 → 期望服务端返回 200 后才转为"已发送"
    埋点侧校验 entry_feedback_submitted.delivery_state 与实际一致

14) 遥测样本可判定（对应 PRD §16.3 Go/No-Go）
    GET /api/v1/diagnostics → 期望 telemetryCompleteness 返回
    lossRate / deviceCoverage / sampleJudgable 三个值均非空且与手工计算一致
    判定门槛：lossRate < 0.2 且 deviceCoverage >= 0.7 时才启用入口健康硬判定
```

## 13. ADR 索引

| 编号 | 标题 | 文件 |
|---|---|---|
| ADR-001 | Electron 版本与 Windows 打包方案 | `docs/decisions/ADR-001-electron-toolchain.md` |
| ADR-002 | 局域网服务发现方案（否决 mDNS） | `docs/decisions/ADR-002-service-discovery.md` |
| ADR-003 | 同步协议：版本号、条件请求与软更新 | `docs/decisions/ADR-003-sync-protocol.md` |
| ADR-004 | 内嵌服务形态与 Windows 防火墙策略 | `docs/decisions/ADR-004-embedded-service-firewall.md` |
| ADR-005 | 本机存储：JSON 文档 + 原子写（含 SQLite 触发条件） | `docs/decisions/ADR-005-local-storage.md` |
| ADR-006 | 安全模型：挑战应答 + 写请求签名（TLS 等价机制） | `docs/decisions/ADR-006-security-model.md` |
| ADR-007 | 图标策略：本地提取 + 自定义协议服务 | `docs/decisions/ADR-007-icons.md` |
| ADR-008 | 遥测方案：本地优先 + 局域网批量上报（零外网出口） | `docs/decisions/ADR-008-telemetry.md` |

带触发条件的决定不在 ADR 里，见 `docs/decisions/OPEN-DECISIONS.md`（D-01 代码签名 / D-02 TLS / D-03 Win10 冒烟 / D-04 TS 回退；O-01..O-03 待 PM 裁定）。

---

## 14. 契约、校验门与 Spec 交叉索引

### 14.1 两个可执行的契约校验门（提交前必跑）

契约不是文档，是能被机器判红灯的东西。以下两条命令必须能在 Phase 3 的仓库里直接跑通，CI 也要挂上。

依赖已进 `package.json`（`zod 4.6.5` 生产依赖、`js-yaml 4.1.0` 仅 devDependency），装完直接跑：

```bash
npm run verify:openapi    # openapi.yaml 结构：YAML 可解析 + $ref 可解析 + 端点完整性
npm run verify:schema     # schema.ts 行为：容量闸门 / 判别联合 / 隐私闸门 / 与 openapi 的字段与枚举一致性
npm run verify:deps       # 依赖锚定：孤儿依赖 / 版本没写死 / §1.1 未覆盖
npm run verify:all        # 连设计侧的 p0 / tokens / icons 一起跑
```

`verify:schema` 直接 import `.ts` 源文件（Node 类型剥离：22.18+ 默认开启，无需额外 flag；本机 v22.22.2 已实测可直接跑）。

| 门 | 脚本 | 拦什么 |
|---|---|---|
| 契约结构 | `scripts/verify-openapi.cjs` | 重复键、断链 `$ref`、缺 operationId/tags/summary、写操作缺 requestBody、缺 500 响应、孤儿定义、**端点与 Spec §5 的 13 条不一致** |
| 契约行为 | `scripts/verify-schema.mjs` | 容量闸门失效、判别联合放行非法入口、id 串号、遥测 props 泄 PII、时间不带 Z、**schema.ts 与 openapi.yaml 的 required / 枚举漂移** |
| 依赖锚定 | `scripts/verify-deps.mjs` | **孤儿依赖**（import 了却没写进 package.json，下次 `npm install` 被静默 pruned —— fastify 事故）、版本写成 `^`/`~`/`*`、§1.1 锚定表里的依赖既没装也没登记延期 |

改动 `src/shared/schema.ts` 或 `docs/api/openapi.yaml` 而不跑这两个门，等于把契约改成未验证状态。

### 14.2 `topIssue` 判定优先级（诊断页首行）

自用管理员要的是"一眼知道现在卡在哪"，不是一堆原始指标。服务端按固定优先级取第一个命中的问题：

```
SERVICE_NOT_LISTENING  >  PUBLIC_NETWORK_PROFILE  >  FIREWALL_RULE_MISSING
>  PORT_DRIFTED  >  DATA_INTEGRITY_FAILED  >  PEER_UNVERIFIED  >  NONE
```

`NETWORK_PROFILE` 排在 `FIREWALL_RULES` 之前，是因为公用配置文件下**规则存在也不生效**——先查它才能避免管理员对着一条"已启用"的规则反复排查（K-01）。`checks[]` 仍逐项给出证据与可执行建议，不因给出 `topIssue` 而省略。

### 14.3 Spec 端点交叉索引（Spec §5 → 本文）

| Spec §5 | 端点 | 本文方案章节 | 契约定义 |
|---|---|---|---|
| 1 | GET `/health` | T2 内嵌同步服务、T1 发现后端口确认 | `openapi.yaml` `/health` |
| 2 | GET `/config` | **T3 同步协议**（ETag/304/版本门）、T3.6 状态机 | `schema.ts` `TeamConfigSchema` |
| 3 | GET `/changes` | T3（变更记录由 `revisions/index.jsonl` 派生，见 §5.4） | `openapi.yaml` `ChangeList` |
| 4 | GET `/assets/{hash}` | T4.3 / **T5 图标**（`tl-icon://` 不可变寻址） | `openapi.yaml` `/assets/{hash}` |
| 5 | POST `/auth/challenge` | **T6 权限与安全**（挑战应答） | `openapi.yaml` `ChallengeInfo` |
| 6 | POST `/auth/verify` | T6（proof 换令牌、失败锁定） | `openapi.yaml` `TokenInfo` |
| 7 | PUT `/config` | T3.4 软更新、§7.2 发布流程、T6.7 容量硬上限 | `schema.ts` `PublishRequestSchema` |
| 8 | GET `/revisions` | T3 + §5.4（索引保留 20 条 + 快照滚动 20 个） | `openapi.yaml` `RevisionList` |
| 9 | POST `/revisions/{rev}/restore` | T3.1 版本只增不减（回滚也产生更大版本） | `openapi.yaml` `RestoreRequest` |
| 10 | POST `/feedback` | **T3.7 反馈投递状态**（禁止谎报成功） | `schema.ts` `FeedbackBatchSchema` |
| 11 | GET `/feedback/summary` | T3.7 聚合、防反馈洪峰 | `openapi.yaml` `FeedbackSummary` |
| 12 | POST `/telemetry` | **§11 埋点**（零外网、禁写来源 IP、隐私门、完整度自证） | `schema.ts` `TelemetryBatchSchema` |
| 13 | GET `/diagnostics` | T2 防火墙自检、**K-01/K-02**、§11.4 完整度、§14.2 | `openapi.yaml` `DiagnosticInfo` |

### 14.4 Spec 已知坑交叉索引（Spec §11 → 本文）

| Spec §11 | 坑 | 本文落地点 | 可验证方式 |
|---|---|---|---|
| K-01 | 防火墙规则在公用网络配置文件下不生效 | **T2.2**（`-Profile Domain,Private`）、`/diagnostics` `activeNetworkProfile` + `topIssue=PUBLIC_NETWORK_PROFILE`、AC-17 | 诊断页首行提示 + 切换引导；E2E 第 5 组 |
| K-02 | 本机自连自身 IP 的自检不可信 | **T2.2 末尾的诚实说明**（同主机回环不入站规则）、`peerCheckHint` | **必须由第二台机器验证**，见 §12 与 `docs/DELIVERY.md` |
| K-03 | mDNS 被否决 | **T1 服务发现**、ADR-002（三条硬证据） | 员工机零入站规则 |
| K-04 | `exec` / `shell:true` 注入与解析错误 | T4.1/T4.2（`shell.openPath` 与 `spawn(shell:false)`） | 路径含空格/中文的专项用例 |
| K-05 | 同步 IO 卡死主线程 | §3.2 依赖方向铁律：**禁止一切 `*Sync` IO** | 代码扫描 `Sync(` |
| K-06 | 首屏被击穿 | T4.4 禁止渲染期预检查，改为点击时判定 | 200 入口首屏 ≤1.5s |
| K-07 | 内置浏览器打不开内网系统 | T4.3 网页一律走 `shell.openExternal` | 内网 SSO 页面用例 |
| K-08 | 图标提取拖垮性能 | **T5 图标**（`icon.kind=local` 不跨网、并发 4 队列、懒加载） | 断网下图标仍可渲染 |
| K-09 | Electron 44.4.5 发布仅 6 天 | §1.1 版本锚定 + `OPEN-DECISIONS.md` D-03 | Phase 2 第一天 Win10 22H2 冒烟；失败整体降级 43.7.5 |
| K-10 | TypeScript 7.0.2 是新编译器主线 | §1.1 + `OPEN-DECISIONS.md` D-04 | **已触发并回退**：`typescript-eslint@8.71.0` peer `<6.1.0` 冲突 → 5.9.3。开发必须按 5.9.3 的 API 写 |
| **K-11** | **scrypt 参数必须客户端夹紧** | **ADR-006 §1.2**（`N/r/p` 线上字段须先比对本地常量再派生） | 造假服务回 `N=2^20` → 客户端申请约 1 GB 内存 → 主线程卡死。现象是"双击应用就假死"，**无日志、无报错、无法解释**。用例：构造回异常 N 的假 `/auth/challenge`，客户端必须拒绝派生且应用不卡 |
