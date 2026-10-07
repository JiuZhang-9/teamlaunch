# 页面设计提示词索引

> 唯一视觉契约：`docs/UIUX.md`（v1.1）
> 规格锚定：`docs/SPEC.md` §7 视图清单 / §8 设计 Token / §9 AC-01..AC-18
> Token 源：`design-tokens.css`（运行时）+ `design-tokens.json`（机器可读）
> 组件骨架：`../components/`（EntryCard / PageTabs / SyncIndicator / EditModeSignals）
> 校验：`python validate-tokens.py`（退出码 0 才允许进入开发）

| # | 文件 | 视图 | 触发方式 | 对应 Spec §7 |
|---|---|---|---|---|
| 01 | `01-team-entries.md` | 团队入口页 | 主窗口默认页（AC-01） | 团队入口页 |
| 02 | `02-personal-entries.md` | 我的入口页 | PageTabs 第二项 | 我的入口页 |
| 03 | `03-mini-palette.md` | 迷你唤起面板 | 全局热键 `Ctrl+Space` | 迷你唤起面板 |
| 04 | `04-window-search.md` | 窗口内搜索结果 | 工具栏搜索框输入 | 窗口内搜索 |
| 05 | `05-admin-edit.md` | 管理员编辑态 | 设置里解锁管理员模式 | 管理员编辑态 |
| 06 | `06-publish-dialog.md` | 发布对话框 | EditActionBar「发布 · N 项改动」 | 管理员编辑态 |
| 07 | `07-settings-panel.md` | 设置面板 | 工具栏设置按钮 / 托盘菜单 | 设置面板 |
| 08 | `08-feedback-dialog.md` | 失效反馈对话框 | 卡片右键菜单 / 打开失败提示 | 反馈对话框 |
| 09 | `09-privacy-gate.md` | 隐私说明门 | 首次启动（遥测确认前） | 隐私说明门 |
| 10 | `10-diagnostics.md` | 诊断页 | 错误提示「查看诊断」/ 更多菜单 | 诊断页 |

## 通用壳层（01 / 02 / 04 / 05 共用）

```
┌──────────────────────────────────────────────────────────────────────┐
│ TitleBar                                          h=40               │
├──────────────────────────────────────────────────────────────────────┤
│ Toolbar                                           h=56               │
├──────────────────────────────────────────────────────────────────────┤
│ Banner（条件出现：离线 / 更新已应用 / 容量预警）     h=40               │
├──────────────────────────────────────────────────────────────────────┤
│ Content                                           992 × 576          │
│   padding: 20px 24px 24px                                            │
├──────────────────────────────────────────────────────────────────────┤
│ EditActionBar（仅管理员编辑态）                     h=64               │
└──────────────────────────────────────────────────────────────────────┘
```

- 窗口默认 **1040 × 720**，最小 **704 × 480**
- 内容区可用宽度 `1040 − 24×2 = 992 = 6 × 152 + 5 × 16`（恰整除 6 列）
- 内容区可用高度 `720 − 40 − 56 − 20 − 24 = 580`，卡片行 `132 + 16 = 148` → 默认展示 3.9 行；**无 Banner 且无 EditActionBar 时**为 4 行 × 148 − 16 = 576
- 滚动条必须是**覆盖式**（`--scrollbar-size: 10px`，track 透明）。占位式滚动条会把 6 列挤成 5 列

## 每个文件的固定 7 节结构

1. 布局结构（具体 px 尺寸与间距）
2. 组件组合（严格使用 Spec §7 的组件名）
3. 需要实现的全部状态
4. 真实中文文案（禁止占位符）
5. 键盘操作路径
6. 用到的图标（Lucide 名称 + 尺寸）
7. 实现红线（最容易做错的地方）

## 关键组件规格（页面文件会引用）

| 文件 | 组件 |
|---|---|
| `../components/entry-card.md` | EntryCard：152×132 尺寸、图标槽与来源优先级、文字层级、**九态矩阵** |
| `../components/page-tabs.md` | PageTabs：Selected / Unselected 两态 + 160ms 指示器切换动效 |
| `../components/sync-indicator.md` | SyncIndicator：**8 态**映射（图标 / 颜色 / 文案 / `offlineReason` 两行，原因按真实频率降序） |
| `../components/edit-mode-signals.md` | 管理员编辑态**四重信号** |

## 三个可执行校验脚本（建议入 CI）

```bash
python docs/design-system/validate-tokens.py          # Token 结构完整性，输出 RESULT: PASS
python docs/design-system/scan-p0.py                  # P0 设计红线扫描，输出 RESULT: PASS
node   docs/design-system/verify-lucide-exports.mjs   # 图标导出名核验，输出 ALL OK (55)
```

三者退出码均为 `0 = 通过`。任一非 0 不得进入开发或合并。

## 扫描豁免约定

`scan-p0.py` 会跳过**含「扫描豁免」字样的行**。这个豁免**只能**用在"必须原文列出禁用词的清单行"上（例如"禁用词：云端 / 上云 / …"），正文里出现禁用词仍然算命中。滥用豁免等于关掉扫描。
