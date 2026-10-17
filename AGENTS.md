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

- v1.0.13 起逐版发布到 **v1.0.31**（latest = v1.0.31）；**自动更新闭环已在实机多次跑通**
  （证据链：`目标 1.0.2x（源 github）` → 下载 → 用户点「立即更新并重启」→ `--updated,/S` 安装 → 重启后版本已升）
- **本轮 15 项需求 + 追加的关于页增强已全部交付并验收**（批 1~5，v1.0.24~v1.0.28）
- 清欠账进展：**O-04 / O-06 已关闭**（依赖升级；CI + Issue/PR 模板 + CoC，CI 已全绿）；
  **L2 局域网发现失效已修**（UDP 信标接入应用本体，v1.0.30）；
  **O-07 的②开关已实施**（「自动检查更新」，默认开；①首次隐私说明披露句仍待 PM）。
  仍待办：**O-05**（用户侧开私有漏洞报告 + Dependabot）、**R23**（启动缓存竞态，重启即好）、
  **O-08**（书签导入隐私口径是否需要更严）
- **本机构建受 360 拦截**（三步绕过：输出到 `%TEMP%` → `NsisTarget.js` 重试补丁 → 生成后立刻改名 `.bin`）；
  根治要把项目目录 + `%LOCALAPPDATA%\electron-builder\Cache` 加信任区
- 每批固定流程：门禁五项全绿（`verify:qa-http` 单独补跑）→ **完整 `npm run build`** → electron-builder 到 `%TEMP%` →
  改名 `.bin` 拷回 → sha512 对 `latest.yml` + SHA256SUMS → 打包产物自验（隔离档案 + CDP）→ 发 Release
