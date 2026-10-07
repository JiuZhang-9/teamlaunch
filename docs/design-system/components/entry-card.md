# 组件规格 · EntryCard

> 唯一视觉契约 `docs/UIUX.md` §3.5 / §3.6 / §3.7 ｜ Token 源 `../design-tokens.css`
> 三类入口（软件 / 文件夹 / 网页）共用**同一张卡片骨架**，只换图标来源、副标签形态与类型 tint

---

## 1. 尺寸与内部构成

```
┌────────────────────────┐  152
│ p 12                   │
│ ┌──────────┐           │
│ │  icon 32 │      [⋯]  │  图标槽 40×40，圆角 8
│ │       ⌐12│           │  右下角叠 12px 类型角标（偏移 −2/−2）
│ └──────────┘           │
│                        │  gap 6
│ 2026 年度归档           │  13 / 510，行高 20，最多 2 行
│ （第二行截断…）          │
│                        │  gap 2
│ 文件夹 · D:\共享\2026…  │  12 / 400，行高 18，单行截断
└────────────────────────┘
  高度校验：12 + 40 + 6 + 40 + 2 + 18 + 12 = 130 ≤ 132  OK（底部余 2px）
```

| 项 | 值 | Token |
|---|---|---|
| 卡片 | 152 × 132，圆角 12，p 12 | `--card-w` `--card-h` `--radius-lg` `--space-3` |
| 图标槽 | 40 × 40，圆角 8 | `--icon-box` `--radius-md` |
| 图标（真实） | 32 × 32 | `--icon-app` |
| 图标（回退 Lucide） | 24 × 24，stroke 2 | `--icon-24` |
| 类型角标 | 12 × 12，叠在图标槽右下 −2/−2 | `--icon-12` |
| 标题 | 13 / 510，行高 20，**2 行截断** | `--text-sm` `--weight-emphasize` |
| 副标签 | 12 / 400，行高 18，**1 行截断** | `--text-xs` |
| 标题↔副标签间距 | 2 | `--space-half` |
| 卡片网格间距 | 16 | `--grid-gap` |
| 卡片列宽范围 | min 140 / 默认 152 / max 176 | `--card-w-min/max` |

**为什么图标槽 40 而图标 32**：40 是给"带圆角底色的容器"留的，32 是 Windows 能给出的最大图标（`SHGetFileInfo` 上限，K-08）。小于 24px 的图标**不放大**，直接回退 Lucide。

---

## 2. 图标来源优先级（三类入口各不相同）

| 类型 | 优先级链 | 说明 |
|---|---|---|
| 软件 | ① `icon.kind=asset`（管理员上传，随版本下发）→ ② 本机 `app.getFileIcon` 对 `target` 本地提取（`icon.kind=local`，**不跨网同步**）→ ③ `fallback` 首字单体图 → ④ Lucide `AppWindow` 24 | 管理员本机提取的 exe 图标对没装该软件的员工无意义（K-08） |
| 文件夹 | ① 本机系统文件夹图标 → ② Lucide `Folder` 24 | 不做自定义，系统与用户认知一致 |
| 网页 | ① `icon.kind=asset` 的 favicon（**管理员侧抓取后随版本下发**，员工端不联网抓）→ ② `fallback` 域名首字母单色圆 → ③ Lucide `Globe` 24 | 员工端禁止发起 favicon 网络请求 |

**类型 tint（只染文件夹和网页，软件保持中性）**

| 类型 | 容器底色 | 理由 |
|---|---|---|
| 软件 | `--type-app-container`（浅色 `#FFFFFF` / 深色 `#1F242A`）——**中性** | 真实应用图标自带颜色，再叠 tint 会打架 |
| 文件夹 | `--type-folder-tint` | 暖色，与系统文件夹认知一致 |
| 网页 | `--type-link-tint` | 冷色，与"链接/浏览器"认知一致 |

**类型角标（12px，永远显示，不靠 hover）**：软件 `app-window` / 文件夹 `folder` / 网页 `globe`。这是关闭颜色后仍能区分类型的第一通道。

---

## 3. 文字层级与 AC-03 的类型文字

- **类型文字 = 副标签的固定前缀**，不单独占行（卡片高度只有 132px，没有第 4 行的空间）
  - 软件：`桌面应用 · 今天用过`
  - 文件夹：`文件夹 · D:\共享\2026 归档`
  - 网页：`网页 · expense.internal.company.com`
- 副标签单行截断；**完整值写入 `title` 属性与 `aria-label`**，路径的完整值通过右键「复制路径」获取
- `aria-label` 模板：`{名称}，{类型}，{来源}`，例：`2026 年度归档，文件夹，团队入口`
- **三重类型通道**：12px 类型角标图标 + 副标签里的类型文字前缀 + tint（tint 只是第三通道，可关闭）

---

## 4. 九态矩阵

| # | 状态 | 视觉表现 | 时长 / Token |
|---|---|---|---|
| 1 | **Default** | bg `--card-bg`，1px `--card-border`，`--card-elev`（浅色 `--elev-1`，深色 none） | — |
| 2 | **Hover** | bg `--card-bg-hover`，`--card-elev-hover`；**不改边框颜色、不位移、不缩放**；编辑态右上角浮出 `Pencil`/`Trash`/`GripVertical` | `--motion-fast` 120ms `--ease-standard` |
| 3 | **Focus-visible** | `--ring-focus`（2px 表面色 + 4px 强调色）；**仅键盘触发**，鼠标点击不出现 | 即时 |
| 4 | **Active** | bg `--card-bg-active`，无位移（**不做 scale 0.98**——卡片网格里缩放会让整片墙抖） | `--motion-instant` 80ms |
| 5 | **Disabled** | 文本 `--disabled-fg`，图标 `opacity .5`；**保留在 tab 序列**，带 `aria-disabled="true"`；点击不打开，Toast 说明原因 | — |
| 6 | **Loading** | 图标位换成 `LoaderCircle` 24（旋转，`data-motion="loop"`）；标题保持；**卡片仍可再次点击**（不阻塞） | `--motion-loop` 1200ms |
| 7 | **Error** | 图标槽右上角叠 `TriangleAlert` 12（`--danger-fg`）；副标签换成失效文案：软件 `本机未找到该软件` / 文件夹 `文件夹不存在或当前无权限` / 网页 `链接格式无效`；边框 `--danger-solid` | 即时 |
| 8 | **Empty（图标缺失）** | 走第 2 节回退链：`fallback` 首字单体图（40×40 圆角 8，bg `--bg-surface-2`，字 17/590 `--fg-2`）→ Lucide 24 | — |
| 9 | **Selected** | 编辑态多选：边框 2px `--accent` + 左上角 `CircleCheck` 16 填充块；列表/搜索态：左 2px `--row-indicator` | `--motion-fast` |

**变体：Editing（管理员编辑态）**
- 边框 `--card-border-editing`（`--border-strong`），**不用虚线**（虚线在 125% 缩放下会糊）
- 左上角常驻 `GripVertical` 16 句柄（**不用 hover 才出现**——它是"这张卡能拖"的持续信号）
- 右上角常驻 `Pencil` 16 / `Trash` 16
- 命中区：三个 16px 图标的点击区均为 **24 × 24**（视觉 16，命中 24，别用同一个数）

---

## 5. 交互与动效

| 交互 | 反馈 | 时长 |
|---|---|---|
| 单击 | 打开目标；主窗口保持可操作（不关闭、不最小化） | — |
| 双击 | 与单击同效（**不得触发两次打开**） | — |
| 右键 | 上下文菜单（团队页 4 项 / 个人页 6 项 / 编辑态 7 项） | `--motion-fast` |
| 拖拽（编辑态） | 源卡 `opacity .85` + `--elev-drag`；目标位显示 2px `--accent` 插入线 | 跟随光标，无补间 |
| 键盘 `Enter` | 打开 | — |
| 打开成功 | **不加成功动画**。静默成功是对的，闪一下绿色反而像出错 | — |

**禁止**：hover 位移/缩放入场、逐张卡片 stagger 淡入、点击涟漪、任何 `cubic-bezier` 带负控制点的弹性。

---

## 6. reduced-motion / forced-colors

- `prefers-reduced-motion: reduce`：Loading 的 `LoaderCircle` 停转并换成静态 `Clock` 24；hover / active 的过渡降为 0.01ms
- `forced-colors: active`：卡片边框强制 `CanvasText`；tint 全部失效（系统接管）；**类型仍可靠 12px 角标图标 + 副标签类型文字前缀区分**（AC-03）

---

## 7. 实现红线

1. **卡片高度锁死 132**。改成 136 会让 4 行变成 592 > 580，默认一屏 24 张"零滚动"就没了。
2. **禁止渲染期对 target 做 stat 预检查**（K-06）。失效判定只在点击时做，200 个入口的预检查会击穿首屏预算。
3. **Windows 图标上限 32×32**（K-08）。不要找高清提取方案；<24px 不放大，直接回退 Lucide。
4. **软件类型不染 tint**。真实应用图标自带颜色，叠 tint 会变成一墙彩色噪点。
5. **16px 图标的命中区是 24×24**。视觉尺寸与命中尺寸是两个数。
6. **双击不得打开两次**。要在一个事件循环内去重。
7. **`icon.kind=asset` 的图标走 `/assets/{hash}`**，不可变长缓存；不要把 hash 算错导致每次全量重下。
