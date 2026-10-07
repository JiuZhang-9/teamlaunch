# 页面设计提示词 · 失效反馈对话框（V-08）

> 触发：卡片右键菜单「反馈给管理员」/ 打开失败 Toast 的「反馈给管理员」/ `08` 快捷键无（不设快捷键）
> 写操作：`POST /api/v1/feedback`（仅 deviceId 限流）｜投递三态 `PENDING` / `SENT` / `DROPPED`（Spec §7）
> 铁律：**排队中的反馈绝不能显示成已发送**；`SENT` 只能在服务端确认后置位（AC-13 / AC-13a）

---

## 1. 布局结构（具体尺寸）

```
   ┌────────────────────────────────────────────────┐ 480
   │ p 24                                            │
   │ 反馈给管理员                            [X 16]  │ h=26 17/590
   │                                                 │
   │ ┌ 入口信息 ──────────────────────────────────┐ │
   │ │ [icon24] 2026 年度归档           [文件夹]  │ │ h=44
   │ │          D:\共享\2026 归档                 │ │ 12 mono muted
   │ └───────────────────────────────────────────┘ │
   │                                                 │
   │ 哪里不对？                                 12/510│ h=18
   │ ○ 打开后没有反应                                 │ h=40
   │ ○ 提示找不到文件或路径                           │ h=40
   │ ○ 网页打不开或地址变了                           │ h=40
   │ ○ 我没有这个软件的权限                           │ h=40
   │ ○ 其他（请填写说明）                             │ h=40
   │                                                 │
   │ 补充说明（可选）                          12/510 │ h=18
   │ ┌───────────────────────────────────────────┐ │
   │ │                                            │ │ h=64
   │ └───────────────────────────────────────────┘ │
   │                                    还可以输入 200 字│ h=16 11 meta
   │                                                 │
   │ ┌ FeedbackStatus（条件出现）────────────────┐ │
   │ │ [icon16] 反馈已保存，稍后自动发送           │ │ h=32
   │ └───────────────────────────────────────────┘ │
   │                                                 │
   │                          [取消] [提交反馈]       │ h=40 gap 8
   └────────────────────────────────────────────────┘
```

| 元素 | 尺寸 | Token |
|---|---|---|
| 对话框 | w 480，最大 h 560，圆角 16 | `--dialog-w` `--radius-xl` |
| 内边距 | 24 | `--space-6` |
| 入口信息块 | 圆角 8，1px `--border-subtle`，p 12，h 44（双行则 60） | `--radius-md` |
| 原因单选行 | h 40，文字 13，单选圈 16 | `--text-sm` `--icon-16` |
| 单选行间距 | 0（整块用 1px 分隔线，左缩进 24） | `--border-subtle` |
| 说明输入 | h 64，圆角 8，13px，可换行 | `--radius-md` |
| 字数计数 | 11 / 400，`--meta`，右对齐 | `--text-2xs` |
| FeedbackStatus 条 | h 32，圆角 8，p-x 12，图标 16 + 文案 12 | `--radius-md` |
| 页脚按钮 | h 40，gap 8 | `--control-h-lg` |

**FeedbackStatus 条的三态配色**（见 `../components/` 同名说明）：
- `PENDING`：`--feedback-pending-bg` / `--feedback-pending-fg`，图标 `clock` 16
- `SENT`：`--feedback-sent-bg` / `--feedback-sent-fg`，图标 `circle-check` 16
- `DROPPED`：`--feedback-dropped-bg` / `--feedback-dropped-fg`，图标 `triangle-alert` 16

三态**各有图标 + 各自文案 + 各自配色**，关闭颜色辨识后仍可区分（AC-03 同款非颜色通道要求）。

---

## 2. 组件组合（Spec §7 组件名）

```
FeedbackDialog
├─ DialogHeader   Text「反馈给管理员」 + Button(ghost)[X 16]
├─ 入口信息块      [Icon 24][名称 14/510 + 副标签 12 mono][Spacer][TypeTag]
├─ Text           「哪里不对？」
├─ RadioGroup ×5
│  ├─ MenuItem 打开后没有反应
│  ├─ MenuItem 提示找不到文件或路径
│  ├─ MenuItem 网页打不开或地址变了
│  ├─ MenuItem 我没有这个软件的权限
│  └─ MenuItem 其他（请填写说明）
├─ Textarea       补充说明（可选，≤200 字）
├─ Text           字数计数
├─ FeedbackStatus（条件出现，三态）
└─ DialogFooter
   ├─ Button(ghost)    取消
   └─ Button(primary)  [Send 20] 提交反馈
```

---

## 3. 需要实现的全部状态

| # | 状态 | 触发 | 呈现 | AC |
|---|---|---|---|---|
| S1 | Idle | 刚打开 | 未选原因；提交按钮 **disabled**（`aria-disabled="true"`，仍可聚焦） | — |
| S2 | 已选原因 | 选中任一项 | 提交按钮 enabled | — |
| S3 | 校验提示 | 选「其他」但说明为空并点了提交 | 说明框 `--input-border-error` + 行内 12px danger「选了「其他」时请简单写一句说明」；**不清空已选项** | — |
| S4 | 提交中 | 点击提交 | 按钮 Loading（图标换 `LoaderCircle` 20，**文案保持「提交反馈」**）；对话框不关闭 | AC-13 |
| S5 | `PENDING` | 离线 / 服务端未可达 | FeedbackStatus 条 `clock` 16 + 「反馈已保存，稍后自动发送」；**对话框可关闭**，卡片上留下一个小角标直到发出 | AC-13 |
| S6 | `SENT` | 服务端确认（200） | FeedbackStatus 条 `circle-check` 16 + 「反馈已发送给管理员」；2s 后自动关闭对话框 | AC-13 |
| S7 | `DROPPED` | 超过保留期限 / 队列满 | FeedbackStatus 条 `triangle-alert` 16 + 原因文案 + Button(secondary)「重新提交」；**常驻可见、不自动消失** | AC-13a |
| S8 | 提交失败（网络） | 请求发不出去 | 同 `PENDING` 语义但文案仍是「反馈已保存，稍后自动发送」——**不得显示"提交失败"**，因为数据确实进了待发送队列 | AC-13 |
| S9 | 限流 | `ERR_RATE_LIMITED` | FeedbackStatus 条 warn「这台设备短时间内反馈太多，请稍后再试」 | — |
| S10 | 卡片角标 | 有 `PENDING` 反馈 | 对应卡片右上角 `message-square-warning` 12 角标；发出后消失 | AC-13 |

**S5 / S8 的关键判定**：只要本机已落盘到 `outbox/feedback.jsonl`，就是 `PENDING`，不是失败。UI 不得把"没发出去"渲染成红色错误。

---

## 4. 真实中文文案

**标题**：`反馈给管理员`

**入口信息**：`2026 年度归档` + `文件夹` + `D:\共享\2026 归档`

**分组标题**：`哪里不对？`

**五个原因（固定顺序，不可增删）**
1. `打开后没有反应`
2. `提示找不到文件或路径`
3. `网页打不开或地址变了`
4. `我没有这个软件的权限`
5. `其他（请填写说明）`

**说明区**：`补充说明（可选）` / 计数 `还可以输入 200 字`

**FeedbackStatus 三态（禁止越级、禁止自造）**
- `PENDING`：`反馈已保存，稍后自动发送`
- `SENT`：**仅服务端确认后**：`反馈已发送给管理员`
- `DROPPED`：`这条反馈没能发送：超过保留期限（7 天）未送达。可以重新提交。` / `这条反馈没能发送：待发送队列已满。可以重新提交。`

**按钮**：`取消` / `提交反馈` / `重新提交`

**限流**：`这台设备短时间内反馈太多，请稍后再试`

**校验提示**：`选了「其他」时请简单写一句说明`

**禁用词**：同全局；反馈场景禁止 `提交成功`（除非真收到服务端确认）、`已通知管理员`（除非 SENT）、`报错` `异常` 这类技术词

---

## 5. 键盘操作路径

| 按键 | 行为 |
|---|---|
| 打开 | 焦点落在 **RadioGroup 第一项**（不是提交按钮） |
| `↑` / `↓` | 在原因项间移动并选中（RadioGroup 语义） |
| `Space` | 选中当前项 |
| `Tab` | RadioGroup（1 个 tab stop） → 说明框 → 取消 → 提交反馈 |
| `Enter`（焦点在说明框） | 换行（**不提交**） |
| `Ctrl+Enter` | 提交（任意焦点位置） |
| `Esc` | 关闭对话框；若有未提交的已选内容，保留在下次打开时（**不弹"确定放弃吗"**） |

- RadioGroup `role="radiogroup"`，每项 `role="radio"` + `aria-checked`
- FeedbackStatus 条 `aria-live="polite"`；`DROPPED` 用 `aria-live="assertive"`
- 卡片角标需有 `aria-label`：`有一条待发送的失效反馈`

---

## 6. 用到的图标（Lucide 1.48.0，全部已核验）

| 用途 | 名称 | 尺寸 |
|---|---|---|
| 关闭 | `x` | 16 |
| 入口类型 | `app-window` / `folder` / `globe` | 24 |
| 反馈入口（卡片角标 / 菜单项） | `message-square-warning` | 16（角标 12） |
| 提交 | `send` | 20 |
| 提交中 | `loader-circle` | 20 |
| `PENDING` | `clock` | 16 |
| `SENT` | `circle-check` | 16 |
| `DROPPED` | `triangle-alert` | 16 |
| 重新提交 | `rotate-ccw` | 16 |

导出名：`X` `AppWindow` `Folder` `Globe` `MessageSquareWarning` `Send` `LoaderCircle` `Clock` `CircleCheck` `TriangleAlert` `RotateCcw`

---

## 7. 实现红线（本页最容易做错）

1. **`PENDING` 绝不能显示成成功**。排队 ≠ 送达，`clock` 图标 + 「稍后自动发送」是唯一正确表达；用 `circle-check` 就是伪造状态，是最严重的一类 bug。
2. **`SENT` 只能在服务端返回确认后置位**。请求发出去就置 `SENT`，管理员根本没收到，闭环就断了（AC-13）。
3. **`DROPPED` 必须常驻可见 + 带原因 + 可重新提交**（AC-13a）。自动消失的"丢弃"提示等于把用户的反馈吞了。
4. **离线不是失败**。只要写进了 `outbox/feedback.jsonl` 就是 `PENDING`，不得渲染成红色错误、不得显示"提交失败"。
5. **打开对话框焦点落在第一项原因**，不要落在提交按钮（避免连按 Enter 提交空表单）。
6. **`Enter` 在文本框里是换行，不是提交**。提交统一用 `Ctrl+Enter` 或点按钮。
7. **反馈内容不得包含用户隐私**：说明框上方要写明"不要填写密码、个人信息"；上报体只含 deviceId + 入口 id + 原因枚举 + 可选说明。
