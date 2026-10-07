# 组件规格 · PageTabs

> 唯一视觉契约 `docs/UIUX.md` §3.3 ｜ 两个 Tab：团队入口 / 我的入口
> 语义：`role="tablist"` + `role="tab"` + `aria-selected` + `aria-controls`（**不是导航链接，不做路由跳转**）

---

## 1. 尺寸

```
        ┌──────────────────┬──────────────────┐
        │ [b-c 16] 团队入口 │ [u-r 16] 我的入口 │  ← b-c=building-complex, u-r=user-round
        └──────────────────┴──────────────────┘
           ↑ 选中项：bg --tab-bg-selected + 底部 2px --tab-indicator
  轨道：bg --tab-track-bg，圆角 8，h 32，p 2
  单项：h 28，p-x 12，圆角 6，gap 6，文字 13
```

| 项 | 值 | Token |
|---|---|---|
| 轨道 | h 32，圆角 8，内 p 2，bg `--tab-track-bg` | `--control-h-md` `--radius-md` |
| 单项 | h 28，p-x 12，圆角 6，gap 6 | `--radius-sm` `--space-3` |
| 图标 | 16 × 16 | `--icon-16` |
| 文字 | 13 / 510（选中）/ 13 / 400（未选中） | `--text-sm` |
| 选中指示器 | 底部 2px，宽 = 项宽 − 16，居中 | `--tab-indicator` |
| 最小单项宽 | 88px（704px 窗口下仍完整显示文字） | — |

**只有 2 个 Tab，不做滚动、不做"更多"折叠。**

---

## 2. 两个状态

| 状态 | 背景 | 文字 | 文字色 | 指示器 | 字重 |
|---|---|---|---|---|---|
| **Selected** | `--tab-bg-selected`（浅色 `#FFFFFF`，深色 `#2A2F36`） | 13px | `--tab-fg-selected`（`--fg`） | 2px `--tab-indicator` 可见 | **510** |
| **Unselected** | 透明 | 13px | `--tab-fg`（`--fg-2`） | 隐藏（`opacity 0`） | **400** |

**第三态（Hover，仅未选中项）**：bg `--bg-surface-hover`，文字色不变。选中项**不响应 hover**（它已经是终态，再变一次会造成"我到底在哪个 Tab"的犹豫）。

**Focus-visible**：`--ring-focus` 包裹整个单项（不是只包文字），键盘可达时整块高亮。

**Disabled**：本项目不用——两个 Tab 永远可用。员工没有编辑权限也不影响切到"我的入口"。

---

## 3. 切换动效

```
指示器（2px 条）：transform: translateX() + width，160ms，--ease-standard
面板内容：不做淡入淡出，直接替换（淡入会让"切 Tab"感觉慢）
```

| 属性 | 值 |
|---|---|
| 指示器时长 | `--motion-base` **160ms** |
| 缓动 | `--ease-standard` `cubic-bezier(0.2, 0, 0, 1)` |
| 位移动画属性 | **只动 `transform` 与 `width`**，不动 `left`（`left` 触发布局重排） |
| 内容切换 | 0ms 直接替换；**保留各自 Tab 的滚动位置与搜索词** |
| 骨架屏 | 首次进入某 Tab 且数据未就绪时显示 Skeleton，**不显示"加载中"文字** |

**指示器实现要点**：指示器是轨道内的**单个绝对定位元素**（不是每个 Tab 一条），切换时改 `translateX` 与 `width`。两条各自显隐会出现"两条同时存在一帧"的闪烁。

```
轨道 position: relative
指示器 position: absolute; bottom: 0; height: 2px;
  transform: translateX(var(--tab-x)); width: var(--tab-w);
  transition: transform 160ms var(--ease-standard), width 160ms var(--ease-standard);
```

**`prefers-reduced-motion: reduce`**：指示器**不做位移**，直接在新位置出现（时长降为 0.01ms）。不是"移得慢一点"。

---

## 4. 键盘与无障碍

| 按键 | 行为 |
|---|---|
| `←` / `→` | 在 Tab 间移动并**立即切换**（自动激活模式，`aria-selected` 随之变化） |
| `Home` / `End` | 跳到第一 / 最后一个 Tab |
| `Ctrl+1` / `Ctrl+2` | 全局快捷键，直接切到第 1 / 第 2 个 Tab |
| `Tab` | 整个 tablist 占 **1 个 tab stop**，内部用方向键移动 |
| `Enter` / `Space` | 无额外行为（自动激活模式下已切换） |

- `role="tablist"` + `aria-label="工作区"`
- 每项 `role="tab"` + `aria-selected` + `aria-controls="<面板 id>"` + `id`
- 未选中项 `tabindex="-1"`，选中项 `tabindex="0"`（roving tabindex）
- 面板 `role="tabpanel"` + `aria-labelledby="<tab id>"` + `tabindex="0"`

---

## 5. 用到的图标

| Tab | Lucide | 尺寸 | 导出名 |
|---|---|---|---|
| 团队入口 | `building-complex` | 16 | `BuildingComplex` |
| 我的入口 | `user-round` | 16 | `UserRound` |

---

## 6. 切换时必须保留 / 必须重置

| 保留 | 重置 |
|---|---|
| 当前 Tab 的滚动位置 | 搜索词（**必须清空**，见下） |
| 卡片网格的键盘焦点项 | 结果列表选中项 |
| 编辑态草稿（管理员切 Tab 不丢草稿） | 迷你面板状态（与 Tab 无关） |

**为什么要清空搜索词**：搜索作用域是单 Tab（见 `../pages/04-window-search.md`）。保留搜索词会出现"7 个结果突然变成 2 个"，用户会以为搜索坏了。

---

## 7. 实现红线

1. **指示器是单个元素改 `transform`，不是两条各自显隐**。两条会出现一帧双条。
2. **只动 `transform` / `width`，不动 `left`**。`left` 触发布局重排，在切换瞬间掉帧。
3. **内容切换不要淡入淡出**。切 Tab 是高频操作，160ms 的淡入会累积成明显的迟滞感。
4. **reduced-motion 下指示器不位移**，直接在新位置出现。
5. **切 Tab 清空搜索词**，保留滚动位置。两者都不能反。
6. **tablist 只占 1 个 tab stop**。每个 Tab 都进 tab 序列会让"从搜索框到卡片"多按两次 Tab。
7. **两个 Tab 永远可用**，不因员工无编辑权限而禁用"团队入口"。
