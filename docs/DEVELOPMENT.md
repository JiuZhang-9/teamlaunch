# 开发指南（DEVELOPMENT.md）

> 面向想跑起来改代码的贡献者。产品介绍与安装见根目录
> [`README.md`](../README.md)，需求与架构见 `docs/PRD.md`、`docs/ARCHITECTURE.md`。

## 1. 浏览器预览（渲染层）

渲染层不 import electron，可以在纯浏览器里完整运行。没有 Electron preload 时
`window.tl` 会自动回落到内存 mock（`src/renderer/bridge/mockApi.ts`），
功能与界面状态一致，只有 Electron 专有能力（窗口控制、原生文件对话框、
本机图标提取、开始菜单扫描、全局热键）会如实提示"预览模式未接入 X"。

预览地址固定为 **http://127.0.0.1:5180**。

### 最省事：双击 `start-preview.bat`

项目根目录的 `start-preview.bat` 是最稳的启动方式，会开一个独立窗口常驻，
关掉窗口即停止。推荐所有人优先用这个。

### 命令行

```bash
npm run dev:detached     # 等价：npx vite --port 5180 --strictPort
npm run dev              # 同上（vite.config.ts 已锁 strictPort）
```

---

## 2. 启动预览的三个坑（都真实发生过）

### 坑 1：`nohup ... &` 起的服务会被回收

```bash
# 会起来，也会打印 ready，第一次 curl 也返回 200 ——
# 但工具调用结束后进程被回收，下一次请求就是 502。
nohup npm run dev > vite-dev.log 2>&1 &
```

要长驻，请用后台任务方式启动，或者用上面那个 bat。
判定方法：换一个工具调用再 `curl`，而不是在同一个命令里连着验。

### 坑 2：不要接管道

```bash
npm run dev | head -40   # head 读满 40 行后关闭管道，Vite 写日志时收到 SIGPIPE 被杀
```

表现是活了一段时间后突然消失，日志里没有任何崩溃信息，很容易误判成代码问题。

### 坑 3：起之前先确认端口

`vite.config.ts` 已设 `strictPort: true`：端口被占用时**直接报错退出**，
而不是静默漂到 5181。

之所以要这么设：漂移会造成"汇报的地址是 5180、实际服务在 5181"——
两个实例都是活的、都返回 200，但被汇报的那个未必服务当前代码，极难发现。

```bash
netstat -ano | grep ":5180" | grep LISTENING   # 起之前先看有没有残留
```

### 坑 4：验收请用本机启动，不要把预览链接当验收入口

预览实例随时会被回收（坑 1），**回收后链接就是 502**。
如果把它写进验收单、交付单或给用户的说明里，对方点开是一片 502，
体验比"没有链接"更差——他会以为产品坏了，而不是某个临时实例没了。

所以：
- **验收**：在自己机器上按第 1 节起服务，或双击 `start-preview.bat`。
- **汇报**：可以给地址，但必须附上"链接可能失效，重启方式见第 1 节"。
- 不要假定上一轮留下的实例还活着——**每次要演示前先 curl 一次**。

---

## 3. 验证改动是否真的在服务中生效

**磁盘上的代码和正在服务的代码是两回事。** 改完请穿透到服务内部确认，
不要只测首页 200：

```bash
curl -s http://127.0.0.1:5180/src/renderer/App.tsx | grep -o "transformOrigin"
```

---

## 4. 自检

单项：

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint . --max-warnings=0
npm run verify:render    # 10 视图渲染 + 同步 8 态 + 反馈 4 态语义
npm run verify:p0        # 设计系统 P0 反模式扫描
npm run verify:tokens    # 设计 Token 校验
```

全量：

```bash
npm run verify:all       # 含 server / schema / openapi / deps / wiring
npm run verify:qa        # QA 专项门禁
```

> `verify:render` 是渲染层的硬门禁：它用 Vite 的 SSR 装载器把组件树真正渲染一遍，
> 覆盖 10 个视图 + 同步 8 态 + 离线 4 因 + 反馈 4 态语义。
> **编译通过不等于界面能渲染**，这条门禁就是挡"编译过但白屏"的。

---

## 5. 打包

```bash
npm run dist:win         # 构建 + electron-builder NSIS 安装包（dist/installer/）
```

- 安装包未做代码签名（决策见 `docs/decisions/OPEN-DECISIONS.md` D-01）。
- 本项目 postinstall 会自动给 `app-builder-lib` 打一个 rename→cp 兜底补丁
  （`scripts/patch-builder.cjs`）：某些盘符上 electron-builder 解压 Electron 缓存时
  `fs.rename` 稳定报 EPERM，详见脚本头注释。重装依赖无需手工重打。

---

## 6. 目录约定

| 目录 | 归属 | 说明 |
|---|---|---|
| `src/renderer/**` | 渲染层 | **不得 import electron**（有 eslint 规则拦） |
| `src/main/**`、`src/preload/**` | 主进程 / 预加载 | Electron 侧 |
| `src/server/**` | 同步服务 | 内嵌 HTTP 服务 |
| `src/shared/**` | 共用 | 纯逻辑与 schema，渲染层与 Node 侧都能 import |

`src/shared/**` 放纯函数的意义：只在主进程侧实现的逻辑拉不进 smoke
（依赖 electron），等于"只过了类型检查和代码审阅、从未被执行过"。
判定类逻辑优先放这里，让 smoke 真能跑到它。
