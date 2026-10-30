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

## 当前状态（2026-10-29）

- v1.0.13 起逐版发布到 **v1.7.0**（latest = v1.7.0；自 1.1.0 起小修改按最后一位递增，
  大改按 minor 递增：1.2.0 起每块功能一个 minor）
- 用户反馈多批：v1.0.33（隐私门披露 / 书签两步 / 更新进度环）、v1.0.34（窗口尺寸记忆 / 卡片框选 /
  分组多选删 / 组名点击改名）、v1.0.35（连锁收藏 / 面板透明度 / Ctrl+空格 / Ctrl+Tab / 图标重画）、
  v1.0.36（连锁记住窗口位置与大小，O-09 关闭）、v1.1.0（系统通知 / 拖拽添加 / 已下载不重复下载 /
  框选单击语义）、v1.1.1（拖拽落到指定分组 / 手动输入热键 / 连锁卡片化 + 主页两栏 / 框选空白取消）、
  v1.1.2（快捷窗口固定行 / 图标缺失与跨窗口搜索 / 边缘描边 / 空组删除 / 导入选分组）、
  v1.1.3（Ctrl+Tab 主窗口↔快捷窗口互换 / Ctrl+空格唤起上次收起的窗口）、
  v1.1.4 / v1.1.5（Ctrl+W / Alt+F4 关掉主窗口后无法再打开；1.1.5 仅递增版本号重新发布）、
  v1.1.6（本机程序搜索 + Ctrl+Alt+F / 更新器跨重启安装修复；见 AC-19、K-14、K-15）、
  v1.2.0（主窗口↔快捷窗口互斥 / Ctrl+Space 只开关当前窗口 / 托盘关时最小化 /
  快捷窗口按主窗口所在显示器定位；窗口状态机抽 shared 并加 verify:surface）、
  v1.3.0（侧栏只留分组 / 操作进工作区弹窗 + 工作栏 / 顶栏更新进度 / 编辑态补回退出编辑；
  工作栏溢出判定抽 shared 并加 verify:toolbar）、
  v1.4.0（主窗口搜索吸收剪贴板候选 / 本机程序 / 固定+最近；候选与去重抽 lib/palette-source.ts 共用）、
  v1.5.0（快捷窗口 720×520 / 图标格 7 列 × 96px / 入口 9 条 / 程序专用 14 条 / 小屏按工作区夹紧）、
  v1.5.1（快捷面板 800×560 / 图标格 7 列 × 104px / 图标 36px / 间距 8px / 可拖动并记住位置 /
  主窗口打开默认聚焦搜索 / Ctrl+F 开关 + 点外部退出 / 搜索框后页面切换按钮）、
  v1.5.2（两个窗口空格进入 / 主窗口搜索补方向键+回车+空格+Ctrl+回车 / 输入法组词中不拦截）、
  v1.5.3（主窗口搜索 Tab 循环 / 搜索前小房子回主页 + 搜索后目标页一键切换 /
  快捷窗口打开主窗口按钮 / Ctrl+Q·E 正反循环切页 / 启动搜索态修复）、
  v1.5.4（托盘重启 + 未发布草稿确认 / 拖拽覆层看门狗 / Ctrl+Space 唤起后空格直接打开剪贴板候选；
  新增 `tl:main-shown` 推送通道）、
  v1.6.0（团队快捷添加方案 A：编辑态下粘贴 / 快捷窗口 / 剪贴板候选 / 拖拽写团队草稿；
  团队新建入口可选分组；判定抽 shared/quick-add.ts 并加 verify:quick-add）、
  v1.6.1（启动竞态修复：editStore 在 preload 预热后按真实 role 补一次 unlocked，
  解决管理员点编辑模式突然要口令；verify:wiring 的 R23 断言扩到 editStore）、
  v1.7.0（收藏与固定统一为一份收藏，主页 + 快捷窗口共用并跨窗口广播；旧固定项自动并入；
  默认切页键对调 Ctrl+E 正序 / Ctrl+Q 反序；判定抽 shared/favorites.ts 并加 verify:favorites）
- **O-05 已全关**（PVR + Dependabot alerts + security updates，均复核）；仍待办：
  局域网多机同步 + 员工机 per-user 装法（**仅公司环境测**，用户 2026-10-20 去公司实测）、
  360 信任区（用户"先这样吧"）、代码签名（用户"不着急"）、O-01..O-03 三个 PM 小裁定（有默认实现）、
  O-10（dev 依赖 2 条无破坏性修法，接受现状）
- **门禁踩坑**：跑 `verify:*` 前先确认有没有打包版实例在跑——**现在信标断言只认回显自己 nonce 的应答
  （2026-10-19 修），别人在跑不再造成假失败**；但真出现失败时先看这条。
  清理实例**必须按命令行匹配自己的测试实例**（`%TEMP%\tl-rel-*\win-unpacked`）或按启动时拿到的 PID 杀，
  **禁止 `taskkill /IM TeamLaunch.exe /F`**：用户真实安装版（`D:\Program Files\TeamLaunch`）平时就在这台机器上跑着，
  2026-10-18 深夜被这样误杀过一次（已当场重启——设置/个人入口都是逐次原子落盘，无数据损失）。
- **本机构建受 360 拦截**（三步绕过：输出到 `%TEMP%` → `NsisTarget.js` 重试补丁 → 生成后立刻改名 `.bin`）；
  根治要把项目目录 + `%LOCALAPPDATA%\electron-builder\Cache` 加信任区
- 每批固定流程：门禁五项全绿（`verify:qa-http` 单独补跑）→ **完整 `npm run build`** → electron-builder 到 `%TEMP%` →
  改名 `.bin` 拷回 → sha512 对 `latest.yml` + SHA256SUMS → 打包产物自验（隔离档案 + CDP）→ 发 Release

