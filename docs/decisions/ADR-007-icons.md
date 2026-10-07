# ADR-007: 图标策略：本地提取 + 自定义协议服务

## Status

Accepted（2026-09-29）｜ 决策人：高见远 ｜ 影响：首屏性能、跨机一致性、视觉完整性

## Background

卡片墙的观感几乎全押在图标上：三类入口（软件/文件夹/网页）都需要图标，而它们的来源完全不同。同时 PRD 要求"有缓存时团队卡片可见 p95 < 1.5 秒"，且 Windows 上 `app.getFileIcon` 有已知的分辨率上限。

关键洞察：**管理员机器上提取的本地 exe 图标，对没装该软件的员工毫无意义**（还可能张冠李戴），并且会白白放大同步体积。

## Decision

### 1. 三类来源，各不相同步

| 来源 | 手段 | 是否跨网同步 |
|---|---|---|
| 软件 / 快捷方式 / 文件夹 | `await app.getFileIcon(path, {size:'large'})` → `NativeImage.toPNG()` | **否**，每台机器按自己本机目标提取 |
| 网页 favicon | 管理员侧抓取 → 写入 hash 寻址的 asset | **是**，随服务下发 |
| 兜底 | 首字 + 色相哈希背景，本地纯函数生成 | 本地 |

不同步本地图标不是省事而是正确。这是本 ADR 最重要的一条。

### 2. favicon 抓取顺序（仅管理员侧）

1. `GET <scheme>://<host>/favicon.ico`，200 且非占位即采纳；
2. 否则抓首页 HTML，用 `node-html-parser 9.0.4` 取 `<link rel="icon|shortcut icon|apple-touch-icon">` 的 `href`，按 base URL 解析；
3. 失败 → 单体图兜底（保证永不出现破图或空白卡片）。

抓取带 3 秒超时、≤ 1 MB 大小上限、异步队列，**不得阻塞 UI**。

### 3. 已知限制（写进验收标准而非藏在心里）

Electron 44 官方 `app.getFileIcon` 的 `size` 语义：

| size | 各平台实际尺寸 |
|---|---|
| `small` | 16x16 |
| `normal` | 32x32 |
| `large` | Linux 48x48、**Windows 32x32**、macOS 不支持 |

即 **Windows 上拿不到高于 32x32 的系统图标**。这是 `SHGetFileInfo` 体系 image list 的现实上限，不是本项目能绕过的：第三方包 `extract-file-icon`（0.3.2，发布于 7 年前）、`icon-extractor-win`（1.0.0，发布于 4 年前，14.4 MB）同样受限且已基本停止维护，换取不了任何实际收益。

**缓解**：卡片图标按 **32 逻辑像素**渲染 —— 正好是 Windows `large` 的原生尺寸，100% 缩放下无损；150% 缩放允许轻微上采样。如试点反馈明显糊，升级路径是一个调用 `IShellItemImageFactory` 的极小原生插件，**MVP 明确不做**（会把 ADR-001/005 辛苦规避掉的原生模块风险重新引回来）。

### 4. 性能设计：不得把图标经 IPC 传 base64

200 张卡片 × 数十 KB 的 base64 走 IPC 会直接冲垮首屏（社区已有同类问题的典型表现）。改为自定义协议 + 浏览器原生懒加载：

- `protocol.registerSchemesAsPrivileged([{scheme:'tl-icon', privileges:{standard:true, secure:true}}])`，**必须在 `app.ready` 之前**调用且只能调用一次；
- 主进程 `protocol.handle('tl-icon', handler)`：命中磁盘缓存直接回 PNG；未命中则进入**并发上限 4** 的提取队列，提取完落盘再返回；
- 渲染层 `<img src="tl-icon://cache/<cacheKey>" loading="lazy" />`，视口外卡片不触发任何提取；
- 缓存键 `sha1("v1|" + 归一化后的 resolvedTarget)`，落在 `%APPDATA%\TeamLaunch\assets\<hash前2位>\<hash>.png`；`iconCacheVersion` 自增可整体失效，设置页提供"重建图标缓存"。

### 5. 图标库：lucide-react 1.48.0（唯一来源）

- 类型图标（软件/文件夹/网页）与状态图标（离线、失效、待发送、编辑模式）一律来自 lucide-react。
- 尺寸规范 16px（行内）/ 20px（按钮内）/ 24px（独立图标），封装为 `Icon.tsx` 的三个 token，业务组件禁止直接写 `size`。
- 每张卡片必须**图标 + 文字双通道**标注类型（PRD AC-03：关闭颜色辨识后仍可区分）。
- 全项目禁止 emoji 图标、禁止第二个图标库、禁止图标字体。

## Consequences

**正面**
- 首屏不再等待图标：视口内异步加载，卡片骨架 1.5 秒内可见。
- 同步体积最小化 —— 只传 favicon 与管理员上传资源，不传本地 exe 图标。
- 永远不会出现破图：单体图兜底覆盖所有提取失败场景。
- 每台机器显示的是自己本机真实存在的目标图标，语义正确。

**负面与代价**
- Windows 高 DPI 下本地图标分辨率受限（已在验收标准中登记为已知限制）。
- 首次显示某卡片时有一次提取 IO；缓存暖起来之前的首次打开可能有几十毫秒延迟。
- 目标 exe 更新自身图标后缓存会陈旧（按路径哈希，不按内容哈希）——可接受，且提供手动重建缓存。
- 引入 protocol 处理带来一处必须在 `app.ready` 之前执行的时序约束，测试需覆盖。

## Related ADRs

- ADR-005（本机存储）—— assets 目录布局与原子写
- ADR-003（同步协议）—— favicon 作为 asset 走 `/api/v1/assets/{hash}`
- ADR-002（服务发现）—— 资源同样只能从已确认端点获取
