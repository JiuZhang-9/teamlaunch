# AGENTS.md — TeamLaunch

Windows 桌面团队统一入口启动器（Electron）：管理员维护一份入口清单并发布，
员工端经局域网自动同步；管理员机内嵌同步服务，无独立服务器部署。
当前 v1.9.0 已开源（GitHub JiuZhang-9/teamlaunch，MIT）并小范围试点。

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

- Electron 44.9.1（应用运行时 Node 24.22.0；开发机 Node ≥22.18）+ electron-builder 26.15.3 NSIS
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

## 当前状态（2026-11-21，latest = v1.11.0 已发布）

- v1.0.13 起逐版发布到 **v1.9.1**（latest = v1.9.1；自 1.1.0 起小修改按最后一位递增，
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
  默认切页键对调 Ctrl+E 正序 / Ctrl+Q 反序；判定抽 shared/favorites.ts 并加 verify:favorites）、
  v1.7.1（启动恢复上次窗口 / 自启静默后台 / 悬停与键盘选中分离 / 主页精简顶栏 /
  「我的入口」改名「个人入口」含老数据迁移；启动面判定抽 shared/startup-surface.ts 并扩 verify:surface）、
  v1.7.2（启动先弹快捷窗口再切主窗口 / 主窗口启动即搜索态：无记录默认主窗口 + 启动面立即落盘；
  Ctrl+Space 才进入搜索态，启动/托盘/切回都显示正常页面；新增 TL-SURFACE 日志）、
  v1.7.3（更新检查节奏：启动 8s 首查 / 每 15min 兜底 / 睡眠唤醒与网络恢复补查，事件检查 10min 节流）、
  v1.8.0（卡片身份：路径尾部副标题 / 类型形状 + 稳定身份色 / 团队·个人页面上下文条与底色 /
  网页 favicon 默认按需抓取 + 手动表情覆盖；新增 verify:identity）、
  v1.8.1（撤掉冷暖底色；团队/个人页改中性网点水波背景：静止不动、鼠标移动才起波纹，团队方形点阵+圆形波 / 个人错位点阵+菱形波）、
  v1.8.2（撤掉常驻页面上下文条，改为卡片区顶部中央 18×2px 淡线热区；切页/悬停同中心线展开 30px 页面横幅）、
  v1.8.3（入口卡片类型水印 G1：应用窗口/文件夹/球体线稿，右下出血 -14°、整组 10% 透明）、
  v1.8.5（应用图标焕新：ip-as-logo 珊瑚企鹅吉祥物，gen-icon.cjs 改源图派生 + 依赖安全更新 zod 4.6.7；
  1.8.4 号被 %TEMP% QA 实例占用作废，跳号发布——同号不同内容对更新器不可见）、
  v1.8.6（应用内品牌标同步换企鹅：BrandMark 组件渲染图标方图，标题栏/关于页与系统图标统一）、
  v1.8.7（主窗口搜索改「顶部结果浮层卡（上限面板 50%）＋底部遮罩透出当前页」，点遮罩即退出；
  遮罩档位进设置：默认变暗，可选毛玻璃＋变暗；搜索态停用框选与 Ctrl+A，被遮内容 inert）、
  v1.9.0（八项合一：任务栏/托盘图标圆角 24% ＋ 应用内企鹅双色标（gen-icon 源图实算 alpha 遮罩
  brand-mask-dark/light，T=113 半透 30%，CSS mask 上主题色）；框选改光圈渐亮（600ms）＋距离错峰（180ms/100px 上限 300ms，三轮定稿 S5——
  前两版被否：快扫来不及亮完 / 读不出缓缓变亮）；
  删除动效六机制＋FLIP 补位（lib/card-removal.ts）；弹窗开合缓动；搜索图标格 86×86 方格自适应列
  （sectionMax 8）；连锁可收藏（chain: 前缀进 favorites，保存即收藏、搜索/快捷窗可开、删除撤收藏，
  ChainLaunchBar 改名「收藏」）；横幅撤回延迟进设置（pageHintLeaveMs 0.5–2s 默认 1s）；
  卡片页 Tab/Shift+Tab 翻页一屏；顶栏常驻「检测更新」按钮；
  复测二轮：删除动效改六机制进设置（deleteFx：RGB 爆散/CRT 关机/像素溶解默认/熔化下滴/烧灼扫描/方块爆飞）、
  搜索浮层入场缓动、右键菜单图标、卡片中键进编辑、六点柄移除、主页改开关式态且侧栏对齐）
- v1.9.1（2026-11-18，已发布；commit `6102e9e` + tag/Release v1.9.1 四件套，exe 118,419,984）：
  **最近打开扩展**——除入口外，通过 TeamLaunch 打开成功的本机程序、文件夹、网页与整条连锁也进
  最近打开（不自动加入入口、不写 personal.json）；文件夹显示名称、网页显示标题（与添加入口同一
  pageTitle 逻辑）、连锁一条记录不拆步骤；设置·通用 + 「最近打开」标题行两处开关
  `recentIncludeUnlisted`（默认开、跨窗口同步）；记录模型抽 `shared/recent.ts` 并加 `verify:recent`
- v1.10.0（2026-11-21，**随 v1.11.0 一起发布**——1.11.0 包含本批全部改动）：用户六条反馈——
  ① 搜索浮层收藏/最近**跟随实测列数只显示 1 行**（默认 1280 约 10 个，不再写死 8）；
  ② 收藏**拖拽排序**：主页 + 搜索浮层都能拖，显式 `sort` 0..n-1 落盘，快捷窗跟随；
  ③ 收藏顺序唯一口径 `favoriteIdsForDisplay`（主页/搜索/快捷窗不再各自 reverse）；
  ④ 连锁**取消自动收藏**：保存连锁不再进收藏、不再补老连锁，主页「连锁」菜单手动收藏，
  按钮文案回到「保存为连锁」；⑤ **点击反馈方案 C**（按下 0.97 + 图标下压，成功 1→1.12→1
  弹跳 300ms，失败抖动 260ms + 红边，reduced-motion 全关）；⑥ 导入书签**动态扫描**
  `%LOCALAPPDATA%`/`%APPDATA%` 的 Chromium 数据目录（本机实识别 8 个：Chrome/Edge/豆包/ima/
  千问/夸克/Tabbit/360安全；判定只认 profile 内含 Bookmarks，避免 Electron 应用误报）；
  新增 `verify:bookmarks`，`verify:favorites` 扩排序断言。安装包
  `dist/installer/TeamLaunch-Setup-1.10.0.exe`（118,434,073，sha512 已对 latest.yml）
- v1.11.0（2026-11-21，已发布；commit `f7e7cf2` + tag/Release v1.11.0 四件套，
  exe 118,445,306；局域网镜像已同步 1.11.0 三件套）：搜索框**直接网页搜索**——
  主窗口/快捷窗口查询非空时，搜索框右侧「在浏览器中搜索」按钮 + `Alt+Enter` + 结果区底部
  吸底一行；用**目标浏览器自己的默认搜索引擎**（读 Preferences 的 `default_search_provider_data`；
  新版 Chrome 只有 `mirrored_template_url_data.keyword`，按内置 Bing/Google/百度/搜狗/360 映射），
  目标浏览器确定后读不到直接回退 Bing、**不借别的浏览器的引擎**（避免来源显示错）；输入是
  网址/路径时不显示；不写最近打开、不进同步/上报。门禁 `verify:web-search`（模板解析/URL 拼接/
  网址识别/exe↔目录匹配/四端接线）。安装包
  `dist/installer/TeamLaunch-Setup-1.11.0.exe`（118,445,306，sha512 已对 latest.yml）
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
  改名 `.bin` 拷回 → sha512 对 `latest.yml` + SHA256SUMS → 打包产物自验（隔离档案 + CDP）→ 发 Release →
  **把 `latest.yml` + 新 exe + blockmap 拷进管理员机 `%APPDATA%\TeamLaunch\updates`（局域网镜像）**。
  不拷的后果：镜像仍报旧版本；GitHub 不可达时选源会落到镜像，全团队被钉在旧版，界面只显示
  “已是最新 · 来源 局域网镜像”（2026-11-18 实际踩到：镜像停在 1.8.2，1.9.1 发不出去）。

