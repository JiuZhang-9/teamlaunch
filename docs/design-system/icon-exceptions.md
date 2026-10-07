# 图标例外登记（Icon Exceptions Register）

> 主库：**Lucide**（`lucide-react`，架构锁定的精确版本 **1.48.0**）
> 登记文件用途：记录①Lucide 导出名核对结果，②任何 Tabler Icons 例外。
> 规则来源：`docs/UIUX.md` §6.1.1 · `docs/ARCHITECTURE.md` §1.3（四条硬闸）

---

## 一、四条硬闸（不可绕过）

| # | 闸门 | 规则 |
|---|---|---|
| 1 | 逐条登记 | 每个 Tabler 图标必须在本文件登记：图标名 / Lucide 缺失理由 / 视觉对齐核验人 / 使用位置。未登记的禁止进代码 |
| 2 | 总量上限 **5** | 超出时必须改用 Lucide 近似图标，不得继续加例外 |
| 3 | 不接受第三来源 | 禁止图标字体、自绘 SVG、emoji、第三方品牌 logo 集等任何其他来源 |
| 4 | CI 白名单 | `dependencies` 中只允许 `lucide-react`；例外发生时须同步更新本文件，否则 CI 失败 |

---

## 二、当前例外数量

**0 / 5**

§6.2 清单中的 57 个图标**全部由 Lucide 覆盖**，未启用 Tabler 例外通道。

---

## 三、Lucide 1.48.0 导出名核对记录

### 3.0 权威核对（对真实 npm 包，2026-09-29 完成）

| 项 | 内容 |
|---|---|
| 核对日期 | 2026-09-29 |
| 核对人 | 颜好看（UI/UX） |
| 核对对象 | UIUX.md §6.2 图标清单 **57 项**（去重后 **55 个唯一名称**，`pencil` 与 `refresh-cw` 各出现 2 次） |
| 核对方法 | 拉取 npm 真实包 `lucide-react@1.48.0`，三通道交叉比对：① `dist/lucide-react.d.ts` 的 `declare const X: LucideIcon;`（1854 个）② `dist/esm/lucide-react.mjs` 的 export 集合（6347 个）③ 运行时 `require()`（需 react 已装，CI 内生效） |
| 核验脚本 | `docs/design-system/verify-lucide-exports.mjs`（可入 CI） |
| **结论** | **55 / 55 全部存在，0 项缺失 → 需要 Tabler 例外的数量 = 0** |

实测输出：

```
target : lucide-react@1.48.0
icons  : 55 个待核验（UIUX.md §6.2 去重后）
d.ts   : 1854 个 declare const
esm    : 6347 个 export
------------------------------------------------------------
ALL OK (55)
RESULT: PASS
```

> 通道 ①② 已双向确认；通道 ③ 在装好 react 的项目里自动生效，缺 react 时会降级为 warn 而不是误报 PASS。

### 3.0.1 旧名在 1.48.0 中**已被彻底移除**（不是别名残留）

对 `declare const` 集合逐个探测，结果：

| 旧名 | 1.48.0 中是否存在 | 现行规范名 |
|---|---|---|
| `Building2` | **否**（已移除） | `BuildingComplex` |
| `Trash2` | **否**（已移除） | `Trash` |
| `History` | **否**（已移除） | `RotateCcwClock` |
| `AlertTriangle` | **否**（已移除） | `TriangleAlert` |

**这意味着写旧名会直接编译失败**，不会静默降级。任何从旧教程 / 旧项目拷来的 `Building2`、`Trash2`、`History`、`AlertTriangle` 必须替换。

### 3.1 发现并重命名的 3 项（已同步修正 UIUX.md §6.2）

| 清单序号 | 用途 | 旧名（已废弃） | **现行规范名** | 处置 |
|---|---|---|---|---|
| 1 | 团队入口 Tab | `building-2` | **`building-complex`** | 已在 UIUX.md 修正 |
| 9 | 删除 | `trash-2` | **`trash`** | 已在 UIUX.md 修正 |
| 53 | 最近使用（P1） | `history` | **`rotate-ccw-clock`** | 已在 UIUX.md 修正 |

> 这三个旧名在部分版本里可能仍作为 deprecated 别名存在，但**本项目一律使用现行规范名**，禁止依赖别名，避免版本升级时整包报错。

### 3.2 易错名备忘（本次核对确认安全，勿再改回旧名）

`ellipsis-vertical`（旧 `more-vertical`）· `triangle-alert`（旧 `alert-triangle`）· `circle-check`（旧 `check-circle-2`）· `loader-circle`（旧 `loader-2`）· `monitor-cog` · `square-pen` · `scan-search` · `message-square-warning` · `arrow-down-up` · `circle-x` · `monitor-play` · `lock-open` · `key-round` · `shield-check` · `folder-open` · `undo-2` · `grip-vertical` · `app-window` · `user-round` · `cloud-off` · `cloud-upload` · `external-link` · `file-down` · `file-up` · `rotate-ccw` · `crosshair` · `folder-plus` · `layout-grid` · `list` · `send` · `clock` · `x` · `check` · `circle-plus` · `circle-minus` · `search` · `settings` · `refresh-cw` · `plus` · `pencil` · `trash` · `copy` · `link` · `folder` · `globe` · `building-complex` · `sun` · `moon` · `pin` · `chevron-*` · `info` · `keyboard` · `history`→已弃用

### 3.3 落地前的最后一步（由前端执行，不可跳过）

§3.0 的权威核对已用真实包完成，但**本项目 `npm install` 之后仍必须跑一次**，防止 lockfile 解析到别的版本：

```bash
node docs/design-system/verify-lucide-exports.mjs
```

期望输出 `ALL OK (55)` / `RESULT: PASS`，退出码 0。

> 旧版内联脚本有个坑已被修正：`lucide-react` 的导出名是 **PascalCase**（`BuildingComplex`），
> 用 kebab-case（`building-complex`）去 `n in L` 会**全部误报 MISSING**。脚本已改为内部转 PascalCase 再比对。

若出现 `MISSING`，**不得**用"换成另一个库的同名图标"或"自己画一个 SVG"解决——先来本文件登记讨论再定。

### 3.4 55 个图标 × 使用页面对照（改图标前先看这里）

| 图标 | 页面 / 组件 |
|---|---|
| `building-complex` `user-round` | PageTabs（01/02/03/04/05） |
| `search` `x` | SearchInput（01–04）、各对话框关闭（06–10） |
| `refresh-cw` | 刷新按钮（01）、`ONLINE_UPDATE_PENDING`（SyncIndicator）、诊断页刷新（10） |
| `settings` | 工具栏设置（01/02/05） |
| `ellipsis-vertical` | 更多菜单（02/05） |
| `plus` `pencil` `trash` `grip-vertical` | 编辑态（02/05）、变更摘要（06） |
| `circle-check` `circle-x` | 反馈三态（08）、校验结果（06）、要点（09）、诊断状态（10） |
| `circle-plus` `circle-minus` | 发布变更摘要（06） |
| `chevron-down` `chevron-up` `chevron-right` | 迷你面板（03）、折叠展开（06/10） |
| `app-window` `folder` `globe` `folder-open` | 入口类型（01–04/08）、打开文件位置 |
| `copy` `external-link` `link` | 复制与链接动作（01/02/07/10） |
| `monitor-play` | 软件类型的图形替身（引导/说明图） |
| `cloud-off` `cloud` `loader-circle` | SyncIndicator 八态中的 5 个态（01/05） |
| `cloud-upload` | 发布按钮（05/06） |
| `triangle-alert` | 失效角标（01/02/04/08）、容量预警（05）、`SYNC_DATA_REJECTED`（SyncIndicator）、诊断（10） |
| `info` | 中性提示 |
| `message-square-warning` | 反馈入口（01/04/08） |
| `send` `clock` | 反馈提交与 `PENDING`（08）；`clock` 也是 reduced-motion 下 `loader-circle` 的替代 |
| `shield-check` `key-round` `lock-open` | 管理员解锁与口令（05/07/09） |
| `monitor` `monitor-cog` | 设备标识（07/10）、主题跟随系统（07） |
| `file-down` `file-up` | 导出 / 导入（02） |
| `sun` `moon` | 主题浅色 / 深色（07） |
| `layout-grid` `list` | 空状态插画、视图切换（01/02） |
| `arrow-down-up` `rotate-ccw` `crosshair` `undo-2` | 排序、重试、定位、撤销（02/05/06/08） |
| `pin` `rotate-ccw-clock` | 置顶 / 最近使用（P1，03） |
| `folder-plus` `scan-search` | 空状态动作、扫描程序（02/05） |
| `keyboard` | 热键录制（07） |

---

## 四、例外登记表（模板）

| # | 图标名（Tabler） | Lucide 缺失理由 | 视觉对齐核验人 | 使用位置 | 登记日期 |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

新增例外时：填满一行 → 在 PR 里 @ 设计师做视觉对齐核验 → 确认 Tabler 例外总数仍 ≤5 → 合并时 CI 自动校验依赖白名单。

---

## 五、变更记录

| 日期 | 变更 | 原因 | 影响范围 |
|---|---|---|---|
| 2026-09-29 | 建文件；完成 57 图标导出名核对，修正 3 个重命名项 | 架构师裁定四条硬闸 + Lucide 跨版本重命名风险 | UIUX.md §6.2 第 1/9/53 项 |
| 2026-09-29 | 升级为对真实 npm 包 `lucide-react@1.48.0` 的三通道核验，结论 55/55 通过、例外 0 | 官网名称校验不等于包实际导出；架构师指定版本为 1.48.0 | 本文件 §3.0 / §3.0.1 |
| 2026-09-29 | 新增 `verify-lucide-exports.mjs` 可入 CI；修正旧内联脚本 kebab→PascalCase 误报缺陷；补充 `AlertTriangle` 已移除 | 旧脚本用 kebab 名查 PascalCase 导出会全量误报 | 本文件 §3.3 / §3.0.1 |
| 2026-09-29 | 新增 55 图标 × 页面对照表 | 改图标前需要知道影响哪些页面 | 本文件 §3.4 |
| 2026-09-29 | `triangle-alert` 增加 `SYNC_DATA_REJECTED` 用途（同步 8 态之一）；`circle-x` 增加 `SYNC_FAILED_UNKNOWN` | 架构 v1.4 新增第 8 态，图标需与状态表对齐 | 本文件 §3.4 / `components/sync-indicator.md` §6 |
