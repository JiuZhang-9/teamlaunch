# TeamLaunch UI 重构定稿归档（2026-10-02）

> 本文件是壳重写的唯一视觉依据。原型在 docs/prototypes/，正式实现以此为准；冲突时以本文件 + 用户后续反馈为准。

## 已拍板决策

### 布局
- 顶部 **40px 自定义标题栏原样保留**（唯一 `app-region: drag`，TitleBar.tsx 未改），窗口按钮仍在右上。
- 标题栏**最左侧**加折叠按钮（PanelLeft 面板图标）：点击侧栏**完全消失**（宽 0，无图标栏形态），再点恢复；状态持久化到 settings。
- 标题栏 Logo：**A 框线 T**（圆角方框描边 + 一笔 T，Lucide stroke 语言，currentColor 跟主题色），文字 "TeamLaunch" 用次级灰 fg-2、字重 460。
- 左侧栏 **240px**，自上而下：导航（团队入口/我的入口，竖排，选中态左侧 3px 竖条 + accent tint 底）→ 分组锚点（组名 + 计数，点击滚动定位；团队只读也显示）→ 随模式操作区 → 弹性空白（drag）→ **V2 工作区条**。
- **V2 工作区条**（左下角）：`[产品部工作区方块 + 双行文案(工作区名/同步行)] ｜ ⚙`，两元素一行。
  - 点工作区条 → **窗口内**向上弹同步弹层：同步状态 + 时间说明 + 刷新 + 分隔线 + **反馈给管理员 / 查看诊断 / 关于 TeamLaunch**（原三点菜单内容并入此处）。
  - ⚙ → 设置弹窗（现有 SettingsPanel）。
- 内容区头部 48px：搜索（≤420px）+ 类型筛选 + 刷新（同步指示器移入工作区弹层，不再放内容头）。

### 三种状态
- 团队只读：侧栏操作区仅「编辑模式」入口（管理员可见）。
- 团队编辑：侧栏「编辑模式」pill + 撤销/新建分组/新建入口/退出管理员模式(红)；组头出现「拖拽排序已启用」徽标；底部 EditActionBar（草稿 N 项 · 基于 v12 ｜ 丢弃 ｜ 发布）；同步行显示「编辑中 · 未发布」。
- 我的入口：侧栏 新建分组/添加入口/导入/导出/更多操作；工作区行显示「本机数据」。
- **组头右侧**：`＋ 添加入口`（editing/personal 模式每组一个，开添加入口表单）+ `⋯`（**组设置**菜单：重命名分组/更改组图标/删除分组，向下弹出，**必须画在窗口框内**）。
- 所有弹层/菜单一律相对窗口内元素定位，禁止 fixed 到页面层。

### 视觉
- 配色：**中性灰 C1**（浅 #F5F5F5 系 / 深 #191919 系，零色温），原始 n 阶灰阶全部转纯中性。
- **主题色系统**：settings 增 accentColor（默认品牌青蓝 #106696），设置面板提供 8 预设（青蓝/粉/橙/松绿/天蓝/黛紫/绯红/琥珀）+ 自定义色盘；运行时派生 accent/hover/text/tint。
- **主题色只用于 7 处点缀**（画布/卡片/正文永远中性；主按钮不用 accent）：①侧栏选中竖条+tint 底 ②折叠按钮/齿轮 hover ③标题 Logo+工作区方块 ④卡片 hover 左缘强调条 ⑤搜索 focus 环 ⑥开关选中 ⑦徽标/进度。
- **动效 = S1 呼吸·分层**（全部走令牌 --motion-*/--ease-*，reduced-motion 自动归零）：
  卡片 hover 抬升 2px+elev-2+左缘条滑入、按压 scale .99、侧栏折叠 240ms ease-emphasis、弹层 popin（fade+上移+缩放）、主题/背景切换 200-220ms 渐变。
- 字体：侧栏导航/锚点/操作项用主文字色 fg + 字重 460（选中 510）；卡片主标题字重 460；标题 TeamLaunch fg-2/460。

### 不变项
- 主进程窗口配置（frame:false 等）、Ctrl+Q/E/F/, 等全部热键、对话框功能集、迷你面板 MiniPalette、托盘、同步 7 态逻辑。

## 原型索引（docs/prototypes/）
- 00-static-layout.html 静态布局；01-shell-interactive 可交互外壳；02-sidebar-bottom-5variants 左下角 5 版（V2 胜出）；
- 03-uiux-5directions 动效五方向（S1 胜出，S4 左缘条并入）；04-palette-5variants 配色五版（C1 胜出→去暖转中性灰）；
- 05-accent-picker 主题色系统；**06-full-states.html 全状态定稿演示（最接近正式实现，对照它套壳）**。

## 实施记录（2026-10-02 套壳完成）

- 令牌：n 阶 15 档全部转纯中性灰（css+json 同步）；--tab-bg-selected→var(--accent-tint)、--tab-fg→var(--fg)、--tab-indicator→var(--accent)（light+dark 双主题）；validate-tokens PASS。
- schema：settings + `accentColor`（默认 #106696）+ `sidebarCollapsed`；旧 settings.json 缺字段由 zod default 自动补齐。
- 新文件：`lib/color.ts`（hexToHsl/shade/rgba/applyAccentColor）、`atoms/BrandMark.tsx`（frame/solid 双变体）、`globals.d.ts`（__APP_VERSION__）。
- TitleBar：+PanelLeft 折叠按钮（最左，激活态 accent tint，状态持久化）；Logo=BrandMark frame；产品名 fg-2/400。
- Sidebar：+分组锚点区（点击 scrollIntoView 到 `tl-group-{name}`，GroupHeader 新增 id）；底部换 V2 工作区条（「工作区」+同步行 ｜ ⚙）；同步弹层（窗口内 absolute）：SyncIndicator/本机说明 + 刷新 + 分隔 + 查看诊断/关于（toast 版本号）；弹性空白 drag 保留；侧栏文字提亮为 fg。
- ContentHeader：移除 SyncIndicator（移入弹层）；搜索/筛选/刷新保留。
- EntryCard：hover 抬升 2px + 非编辑态左缘 2px accent 竖条；EditActionBar：riseup 入场 + 「发布」改中性深底反白（不再 accent 实心）。
- SettingsPanel：外观区新增主题色 8 预设 + 自定义色盘（写入 settings.accentColor）。
- 文案：AdminEditView「工具栏」→「侧栏」；vite define 注入 __APP_VERSION__。
- 功能底账 15 条风险点逐项核对：对话框/迷你面板/热键/右键菜单/导入导出/容量链路/aria 契约/关闭安全约束全部保留，未删任何功能。
- 校验：typecheck ✓ lint ✓ validate-tokens PASS ✓ build（renderer+preload+main）✓。
