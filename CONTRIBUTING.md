# 贡献指南（CONTRIBUTING.md）

感谢关注 TeamLaunch。当前项目处于"单人维护 + 小范围试点"阶段，接受 Issue 与
PR，请先读这份指南了解本项目的工程纪律。

## 开发环境

- Windows 10/11、Node >= 22.18.0
- `npm install`（postinstall 会自动应用 electron-builder 兼容补丁）
- 开发与自检见 [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)

## 提交前必须全绿

```bash
npm run verify:all       # 设计系统 / schema / openapi / 依赖锚定 / server / 同步 / 接线
npm run verify:qa        # QA 专项门禁
npm run typecheck && npm run lint
```

门禁的意义是"编译通过 ≠ 界面能渲染 ≠ 契约没漂移"，请勿跳过或注释断言。

## 工程纪律（本项目特有的硬规矩）

1. **每轮发版必升版**：改 `package.json` 版本号、在 `CHANGELOG.md` 写用户视角条目、
   打同名 git tag。教训见 CHANGELOG 1.0.5 条目。
2. **判定类逻辑放 `src/shared/**`**：纯函数才能进 smoke；只活在主进程的逻辑
   等于从未被执行过。
3. **渲染层不得 import electron**（eslint 拦截）；主进程新增 IPC 必须同步
   `docs/api/openapi.yaml` / schema 与 `verify:qa-channels` 断言。
4. **UI 改动走设计令牌**：硬编码色值会被 `verify:p0` / `verify:tokens` 抓；
   新增界面遵守 `docs/design-system/` 的既有手法。
5. **失败要诚实**：错误文案与状态指示必须如实反映原因，禁止把失败画成成功。

## Commit 约定

中文、类型前缀，一行主题 + 必要时的正文：

```
fix: 托盘退出无反应——palette close 不再无条件 preventDefault
docs: 回填 CHANGELOG（1.0.0~1.0.13）
chore: 固化 electron-builder rename 兜底补丁为 postinstall 脚本
```

类型：`feat` / `fix` / `docs` / `chore` / `refactor` / `test`。

## 发版流程（维护者）

1. `package.json` 升版本号
2. `CHANGELOG.md` 加条目（新增/修复/变更，面向使用者）
3. `npm run dist:win`，产物在 `dist/installer/`
4. git commit + `git tag -a vX.Y.Z` + GitHub Release 挂安装包
