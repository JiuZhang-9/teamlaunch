# AGENTS.md — TeamLaunch

Windows 桌面团队统一入口启动器（Electron）：管理员维护一份入口清单并发布，
员工端经局域网自动同步；管理员机内嵌同步服务，无独立服务器部署。
当前 v1.0.18 已开源（GitHub JiuZhang-9/teamlaunch，MIT）并小范围试点。

## 命令

```bash
npm install              # postinstall 自动给 electron-builder 打 rename→cp 补丁（scripts/patch-builder.cjs）
npm run electron:dev     # 跑桌面应用（开发态）
npm run dev              # 仅浏览器预览渲染层（127.0.0.1:5180，strictPort）
npm run dist:win         # 构建 + NSIS 安装包（dist/installer/）
npm run verify:all && npm run verify:qa && npm run typecheck && npm run lint   # 提交前必须全绿
```

## 技术栈（版本锚定唯一权威：docs/ARCHITECTURE.md §1.1）

- Electron 44.4.5（应用运行时 Node 24.21.0；开发机 Node ≥22.18）+ electron-builder 26.15.3 NSIS
- TypeScript **5.9.3** 硬约束：按 5.9.3 的 API 写代码，勿用 TS 7 语法（D-04 曾因此整体回退）
- React 19.3 + Vite 8.3（经 electron-vite）+ Tailwind 4；fastify 5.12 内嵌同步服务
- electron-updater 6.6.2（≥6.8.9 升级待办 = OPEN-DECISIONS O-04）

## 目录与硬规矩

- `src/renderer/**` 不得 import electron（eslint 拦截）；`src/preload|main/**` Electron 侧；
  `src/server/**` 同步服务；**判定类纯函数放 `src/shared/**`**（只活在主进程＝smoke 跑不到）
- UI 走设计令牌，硬编码色值会被 `verify:p0` / `verify:tokens` 抓；新增 IPC 必须同步
  `docs/api/openapi.yaml` 与 `verify:qa-channels` 断言
- 读 Windows 控制台程序输出必须按系统代码页解码（K-12；唯一落点 `src/main/winConsole.ts`）
- 发版必升版本号 + CHANGELOG（用户视角）+ 同名 git tag（教训见 CHANGELOG 1.0.5）
- 失败要诚实：错误文案与状态如实反映原因，禁止把失败画成成功

## 文档地图

需求与路线图 `docs/PRD.md`（§8.5）｜架构、风险 R 表、经验 K 表 `docs/ARCHITECTURE.md`｜
契约 `docs/SPEC.md`（服务端契约文件 `docs/api/openapi.yaml`）｜UI 规格 `docs/UIUX.md` +
`docs/design-system/`｜分发与现场排障 `docs/DELIVERY.md`｜开发细节 `docs/DEVELOPMENT.md`｜
决策与待办登记 `docs/decisions/OPEN-DECISIONS.md` + `docs/decisions/ADR-001..008`

## 当前状态（2026-10-17）

- **v1.0.21 已发布**（GitHub 正式源 + 局域网镜像回落，ADR-009；四件套含 latest.yml 已挂 Release）
- **v1.0.22 / v1.0.23 / v1.0.24 / v1.0.25 均未打 tag**：1.0.22 因"跳过 build"界面版本号显示旧值（结构修复：界面版本号运行时读取 +
  `release-gh` 加"产物比源码新"校验）；**1.0.24** = 容量门控按动作拆开 + 被禁按钮点击有回声；
  **1.0.25** = 批 2（新建分组命名确认框 / 扫描确认 / 团队编辑态批量添加 / 团队容量门控）。按纪律：**验收通过后再打 tag**
- **1.0.25 的交付方式经用户拍板**：直接发 Release，让已装 1.0.24 的机器自己走「发现新版 → 后台下载 → 常驻横幅 → 确认安装」
  —— 这一步同时是**自动更新闭环的首次真实验证**；兜底同时给安装包
- **本机构建受 360 拦截**（三步绕过见下），根治要把项目目录 + `%LOCALAPPDATA%\electron-builder\Cache` 加信任区
- 每批固定流程：门禁五项全绿（`verify:qa-http` 单独补跑）→ **完整 `npm run build`** → electron-builder 输出到 `%TEMP%` →
  生成后立刻改名 `.bin` → sha512 对 `latest.yml` + SHA256SUMS → 打包产物自验（隔离档案 + CDP）
- 待办：`OPEN-DECISIONS` O-04 依赖升级／O-05 仓库安全开关／O-06 CI 与社区基建／O-07 更新检查的隐私披露与开关；
  已知未修：启动缓存竞态（R23，重启即好）、局域网多机同步实测待做
