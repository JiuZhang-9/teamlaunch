# AGENTS.md — TeamLaunch

Windows 桌面团队统一入口启动器（Electron）：管理员维护一份入口清单并发布，
员工端经局域网自动同步；管理员机内嵌同步服务，无独立服务器部署。
当前 v1.0.30 已开源（GitHub JiuZhang-9/teamlaunch，MIT）并小范围试点。

## 命令

```bash
npm install              # postinstall 自动给 electron-builder 打 rename→cp 补丁（scripts/patch-builder.cjs）
npm run electron:dev     # 跑桌面应用（开发态）
npm run dev              # 仅浏览器预览渲染层（127.0.0.1:5180，strictPort）
npm run dist:win         # 构建 + NSIS 安装包（dist/installer/）
npm run release:gh       # 打 tag + 发 Release，并把 exe + blockmap + latest.yml + SHA256SUMS 挂齐
npm run verify:all && npm run verify:qa && npm run typecheck && npm run lint   # 提交前必须全绿；CI（.github/workflows/verify.yml）跑同一套
```

## 技术栈（版本锚定唯一权威：docs/ARCHITECTURE.md §1.1）

- Electron 44.4.5（应用运行时 Node 24.21.0；开发机 Node ≥22.18）+ electron-builder 26.15.3 NSIS
- TypeScript **5.9.3** 硬约束：按 5.9.3 的 API 写代码，勿用 TS 7 语法（D-04 曾因此整体回退）
- React 19.3 + Vite 8.3（经 electron-vite）+ Tailwind 4；fastify 5.12 内嵌同步服务
- electron-updater 6.8.9（2026-10-17 升级，O-04 关闭）；js-yaml 直接依赖 4.3.2

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

- v1.0.13 起逐版发布到 **v1.0.34**（latest = v1.0.34）；**自动更新闭环已在实机多次跑通**
  （证据链：`目标 1.0.2x（源 github）` → 下载 → 用户点「立即更新并重启」→ `--updated,/S` 安装 → 重启后版本已升；
  用户实机已自行更新到 1.0.33）
- **本轮 15 项需求 + 追加的关于页增强已全部交付并验收**（批 1~5，v1.0.24~v1.0.28）
- 清欠账（v1.0.29~v1.0.32）已收口：O-04 / O-06 关闭、L2 信标接线、O-07 全关、R23、R25、O-05 私有漏洞报告；
  **2026-10-18 六项反馈（v1.0.33）+ 六项优化（v1.0.34）已落地**：隐私门披露句、书签两步识别、更新小窗与进度环、
  小窗主题/帮助/更新日志入口；窗口尺寸记忆、卡片区框选、侧栏分组多选批量删、组名点击改名 + 按名称重排本组、
  快捷面板首行图标格 + Ctrl+M 进主窗口
- 仍待办：**Dependabot 安全更新**（维护者侧，会自动开 PR）、局域网多机同步 + 员工机 per-user 装法
  （**用户明示只在公司环境测**）、360 信任区（用户侧，稍后处理）
- 仍待办：**Dependabot 安全更新**（维护者侧，会自动开 PR）、局域网多机同步 + 员工机 per-user 装法
  （**用户明示只在公司环境测**）、360 信任区（用户侧，稍后处理）
- **门禁踩坑**：跑 `verify:*` 前先确认有没有打包版实例在跑——**现在信标断言只认回显自己 nonce 的应答
  （2026-10-19 修），别人在跑不再造成假失败**；但真出现失败时先看这条。
  清理实例**必须按命令行匹配自己的测试实例**（`%TEMP%\tl-rel-*\win-unpacked`）或按启动时拿到的 PID 杀，
  **禁止 `taskkill /IM TeamLaunch.exe /F`**：用户真实安装版（`D:\Program Files\TeamLaunch`）平时就在这台机器上跑着，
  2026-10-18 深夜被这样误杀过一次（已当场重启——设置/个人入口都是逐次原子落盘，无数据损失）。
- **本机构建受 360 拦截**（三步绕过：输出到 `%TEMP%` → `NsisTarget.js` 重试补丁 → 生成后立刻改名 `.bin`）；
  根治要把项目目录 + `%LOCALAPPDATA%\electron-builder\Cache` 加信任区
- 每批固定流程：门禁五项全绿（`verify:qa-http` 单独补跑）→ **完整 `npm run build`** → electron-builder 到 `%TEMP%` →
  改名 `.bin` 拷回 → sha512 对 `latest.yml` + SHA256SUMS → 打包产物自验（隔离档案 + CDP）→ 发 Release
