# 页面设计提示词 · 团队入口页（V-01）

> 触发：主窗口启动后的默认页（AC-01）｜数据源：`GET /api/v1/config` + `cache/team-current.json`
> 角色：**只读**。任何编辑控件都不得出现在本页（AC-01 / AC-16）

---

## 1. 布局结构（具体尺寸）

```
┌───────────────────┬──────────────────────────────────────────────────┐
│ TitleBar          │                                           h=40   │
│ [logo16] TeamLaunch│                        [−][□][×] 各 40×40        │
├───────────────────┼──────────────────────────────────────────────────┤
│ Sidebar    w=240  │ ContentHeader                             h=48   │
│ p 12              │ p-x 24 [SearchInput ≤420 h=32] <flex>            │
│ ┌ nav 36 ───────┐ │        [SyncIndicator] [filter] [refresh 32]     │
│ │团队入口       │ │                                                  │
│ │我的入口       │ ├──────────────────────────────────────────────────┤
│ └───────────────┘ │ Banner（条件出现）                         h=40   │
│ ───────────────── │                                                  │
│ [编辑模式]（管理员）├─────────────────────────────────────────────────┤
│ <flex 可拖窗口>   │ Content                          752 × ~500      │
│ ───────────────── │ padding: 20px 24px 24px                          │
│ [设置]            │  ┌ GroupHeader ────────────────────┐   h=32      │
│                   │  └─────────────────────────────────┘            │
│                   │  ┌ CardGrid ───────────────────────┐            │
│                   │  │ 176  176  176  176    gap 16    │            │
│                   │  └─────────────────────────────────┘            │
│                   │  组间距 margin-top 24（首组 0）                  │
└───────────────────┴──────────────────────────────────────────────────┘
```

| 元素 | 尺寸 | Token |
|---|---|---|
| TitleBar | h 40，p-x 12 | `--win-titlebar-h` `--space-3` |
| 窗口按钮命中区 | 40 × 40（图标 16） | `--icon-16` |
| Sidebar | w 240，p 12 | `--sidebar-w` `--sidebar-pad` |
| 侧栏导航项 | h 36，选中态左侧 3px 竖条 | `--sidebar-nav-h` `--sidebar-indicator-w` |
| 侧栏操作项 | h 32，整行左对齐 | `--sidebar-action-h` |
| ContentHeader | h 48，p-x 24，gap 12 | `--content-header-h` `--space-6` `--space-3` |
| PageTabs（侧栏竖排） | w 216，单项 h 36，圆角 6 | `--sidebar-nav-h` `--radius-sm` |
| SearchInput | w ≤420（可伸缩 160–420），h 32 | `--control-h-md` |
| 图标按钮 | 32 × 32，图标 20 | `--control-h-md` `--icon-20` |
| SyncIndicator | 最小宽 200，p-x 8，两行文本 | 见 §2 |
| Content | p 20 / 24 / 24 / 24 | `--space-5` `--space-6` |
| GroupHeader | h 32，标题 13/510，计数 12/400 | `--text-sm` `--text-xs` |
| 组间距 | 24（首组 0） | `--space-6` |
| CardGrid | `repeat(auto-fill, minmax(140px, 1fr))`，gap 16 | `--card-w-min` `--grid-gap` |
| EntryCard | 152 × 132，p 12，圆角 12 | `--card-w` `--card-h` `--radius-lg` |

**网格列数推导（不可写死列数）**：内容区可用宽 `1040 − 240（侧栏）− 24×2 = 752`；
`floor((752 + 16) / (140 + 16)) = 4`，列宽 `(752 − 3×16) / 4 = 176`（正好是 `--card-w-max` 上限）。
最小宽度 880px 时为 `floor((592 + 16) / 156) = 3` 列。

---

## 2. 组件组合（Spec §7 组件名）

```
MainWindowShell
├─ TitleBar            [Icon 16, 产品名, Spacer, Button(ghost)×3]   ← 唯一 app-region: drag
├─ Sidebar (w 240)
│  ├─ PageTabs(vertical)  [BuildingComplex 团队入口][UserRound 我的入口]  ← 选中第一项
│  ├─ Button(ghost)       [Pencil 编辑模式]  ※仅管理员角色可见
│  ├─ Spacer                ← 空白区也为 app-region: drag
│  └─ Button(ghost)       [Settings 设置]
└─ 内容列
   ├─ ContentHeader
   │  ├─ SearchInput      [Search 16] placeholder="搜索团队入口"
   │  ├─ Spacer
   │  ├─ SyncIndicator   ← 7 态，见 ../components/sync-indicator.md
   │  ├─ TypeFilterButton [Filter 筛选]
   │  └─ Button(ghost)    [RefreshCw 20] aria-label="刷新团队入口"
   ├─ Banner（条件）       ← 见 §3
   └─ Content
      ├─ GroupHeader ×N   [名称][Spacer][Badge 计数]
      └─ CardGrid
         └─ EntryCard ×M  ← 完整规格见 ../components/entry-card.md
```

- **PageTabs 只做切换，不做路由跳转**，切换保留滚动位置与搜索词
- **本页没有 `plus` / `pencil` / `trash` / `grip-vertical` 中的任何一个**（只读判定）
- 卡片右键菜单在只读态只有 4 项：打开 / 复制路径或链接 / 在浏览器中打开（仅网页）/ 反馈给管理员

---

## 3. 需要实现的全部状态

| # | 状态 | 触发 | 呈现 | AC |
|---|---|---|---|---|
| S1 | Loading（首次） | 启动首次拉取 | 24 张 `Skeleton`（同 152×132，圆角 12，微光 1200ms） | — |
| S2 | Populated | 有配置 | 分组 + 卡片网格 | AC-01 |
| S3 | Empty（有配置但 0 项） | 管理员发布了空配置 | `EmptyBlock`：图标 `layout-grid` 24，标题「团队入口还没有内容」，描述「管理员还没有发布任何入口。你可以先使用我的入口。」，动作 Button(ghost)「去看看我的入口」 | AC-11（注意：这不是故障，不得显示离线/错误样式） |
| S4 | Offline Banner | `OFFLINE_CACHED` / `OFFLINE_EMPTY` / `SYNC_DATA_REJECTED` / `SYNC_FAILED_UNKNOWN` | 顶部 Banner h40，图标 16，两行文案见 §4 | AC-10 / AC-11 |
| S5 | 更新已应用 Banner | 轮询软更新成功 | 「团队入口已更新至 v27（3 项变更）」，3s 后自动消失，不打断焦点 | AC-08 |
| S6 | 容量预警 Banner | 接近 8 组 / 200 项 | warn 配色，文案见 §4 | — |
| S7 | SyncIndicator 7 态 | 同步服务写入 | 见 `../components/sync-indicator.md` | AC-09 / AC-10 |
| S8 | 卡片失效（本机可判定） | 点击时判定（禁止渲染期预检查 K-06） | 卡片角标 `triangle-alert` 12 + 副标签换文案 | AC-12 |
| S9 | 打开失败 | 点击后系统拒绝 | Toast（3s）+ 底部「查看诊断」「反馈给管理员」 | AC-12 |
| S10 | 无变化轮询 | revision 相同 | **不替换列表、不改焦点、不显示任何提示**（AC-09） | AC-09 |
| S11 | 滚动 | 分组 > 4 行 | 覆盖式滚动条；GroupHeader 不吸顶（不做 sticky，避免与 Banner 抢层级） | — |

**S11 补充**：C-03 已裁定——分组超过 8 组时内容区纵向滚动，不折叠、不分页、不切换标签页。

---

## 4. 真实中文文案

**PageTabs**：`团队入口` / `我的入口`

**GroupHeader**：`日常办公` `设计与素材` `项目资料` `数据与后台` `团队门户` `财务与报销`；右侧计数 `6 项`

**卡片（名称 / 副标签）**

| 类型 | 名称 | 副标签 |
|---|---|---|
| 软件 | 企业微信 | 桌面应用 · 今天用过 |
| 软件 | 飞书文档 | 桌面应用 · 3 天前 |
| 软件 | 审稿工具 | 桌面应用 |
| 文件夹 | 2026 年度归档 | `D:\共享\2026 归档` |
| 文件夹 | 本周活动素材 | `\\NAS\市场部\本周活动` |
| 网页 | 费用报销系统 | `expense.internal.company.com` |
| 网页 | 生产环境监控 | `grafana.internal.company.com` |

**SearchInput placeholder**：`搜索团队入口`

**Banner 文案**
- S5 更新已应用：`团队入口已更新至 v27（3 项变更）`
- S6 容量预警：`团队页已接近整理上限（8 组 / 200 项），建议先合并相似分组`
- S4 离线两行（第二行必须自带下一步动作，禁止出现端口、地址、错误码）：
  - 第 1 行：`离线 · 数据时间 今天 09:12`
  - 第 2 行（按 `offlineReason` 取，四值映射见 `../components/sync-indicator.md` §3）：
    - `SERVICE_NOT_FOUND`（高频）：`管理员电脑未开机或未连接网络。稍后会自动重试，你也可以手动刷新。`
    - `NETWORK_UNREACHABLE`：`这台电脑连不上内网。检查网络后会自动重试，你也可以手动刷新。`
    - `UNKNOWN`（兜底）：`暂时连不上管理员电脑，稍后会自动重试。你也可以先使用我的入口。`
    - `CONNECTION_BLOCKED`（罕见）：`连接被安全软件或网络策略拦截。可手动刷新，仍不行请联系管理员或 IT。`
  - **四行视觉权重完全相同**（都是第二行 11px）。不得给罕见的 `CONNECTION_BLOCKED` 加事故级样式，也不得把高频的 `SERVICE_NOT_FOUND` 写得比兜底还轻

**空状态**：`团队入口还没有内容` / `管理员还没有发布任何入口。你可以先使用我的入口。` / Button `去看看我的入口`

**失效卡片副标签**：软件 `本机未找到该软件`；文件夹 `文件夹不存在或当前无权限`；网页 `链接格式无效`

**打开失败 Toast**：`没能打开「2026 年度归档」` + 动作 `查看诊断` `反馈给管理员`

**禁用词（本行为清单原文，扫描豁免）**：Welcome to / Lorem ipsum / 快速开始 / 一站式 / 赋能 / 生态 / 无缝衔接 / 云端 / 上云

---

## 5. 键盘操作路径

| 按键 | 行为 |
|---|---|
| `Ctrl+1` | 切到团队入口页（本页） |
| `Ctrl+2` | 切到我的入口页 |
| `Ctrl+F` | 聚焦工具栏搜索框并全选 |
| `F5` | 手动刷新（等价于点击 `RefreshCw`） |
| `Tab` | TitleBar → PageTabs → SearchInput → 刷新 → 设置 → 第一张卡片 |
| 卡片网格内 `← →` | 左右移动一格（到行首/行尾不跨行） |
| 卡片网格内 `↑ ↓` | 上下移动一行（列不变；越界则停在边界） |
| `Enter` / `Space` | 打开当前聚焦卡片 |
| `Shift+F10` / `Menu` | 打开卡片上下文菜单 |
| `Esc` | 焦点在搜索框：清空并交回网格；焦点在网格：交回搜索框 |
| `Alt+←` | 无（本页无返回栈） |

- 卡片网格用 **roving tabindex**：整个网格只有 1 个 `tabindex="0"`，其余 `-1`
- 同步状态变化通过 `aria-live="polite"` 区域播报；**无变化时不播报**（AC-09）
- 每张卡片 `aria-label` = `名称，类型，来源`，例：`2026 年度归档，文件夹，团队入口`

---

## 6. 用到的图标（Lucide 1.48.0，全部已核验）

| 用途 | 名称 | 尺寸 |
|---|---|---|
| 团队入口 Tab | `building-complex` | 16 |
| 我的入口 Tab | `user-round` | 16 |
| 搜索 | `search` | 16 |
| 刷新 | `refresh-cw` | 20 |
| 设置 | `settings` | 20 |
| 空状态插画 | `layout-grid` | 24 |
| Banner 离线/更新 | `cloud-off` / `refresh-cw` | 16 |
| 卡片失效角标 | `triangle-alert` | 12（stroke 1.75） |
| 卡片类型（回退） | `app-window` / `folder` / `globe` | 24（卡内）/ 16（搜索行） |
| 反馈入口 | `message-square-warning` | 16 |

导出名（PascalCase）：`BuildingComplex` `UserRound` `Search` `RefreshCw` `Settings` `LayoutGrid` `CloudOff` `TriangleAlert` `AppWindow` `Folder` `Globe` `MessageSquareWarning`

---

## 7. 实现红线（本页最容易做错）

1. **绝不在本页渲染任何编辑控件**——`plus` / `pencil` / `trash` / `grip-vertical` 一个都不许出现。隐藏编辑入口只是 UI 层，**不是安全边界**（AC-16）。
2. **禁止渲染期对入口做 stat 预检查**（K-06）。首屏要对 200 个入口做存在性检查会击穿 1.5s 首屏预算；只在点击时判定。
3. **滚动条必须覆盖式**。占位滚动条会让 992px 可用宽变成 982px，6 列立刻掉成 5 列，而这个问题在代码审查里几乎看不出来。
4. **轮询无变化时不重绘**。不得 setState 一个新数组引用，不得重新挂载 CardGrid，焦点与滚动位置都要原样保留（AC-08 / AC-09）。
5. **有缓存但配置为空 ≠ 离线故障**。S3 必须走正常空状态，不能套用离线样式，否则"管理员没发内容"会被误报成"网络坏了"。
6. **员工可见界面禁止出现端口、IP、错误码、堆栈**。`192.168.1.24:5577` 这类信息只在诊断页出现。
7. **网页一律走外部浏览器**（K-07）。内置 Chromium 是独立 profile，内网 SSO 会失效。
