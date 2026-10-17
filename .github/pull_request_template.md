## 这个 PR 做了什么

<!-- 一两句话说明改动与目的 -->

## 关联 Issue

<!-- 形如 Closes #12；没有就写"无" -->

## 自查清单（提交前必须全绿）

- [ ] `npm run verify:all` 通过
- [ ] `npm run verify:qa` 通过（含末尾的 `verify:qa-http`）
- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过

## 勾选适用的纪律（详见 CONTRIBUTING.md 与 AGENTS.md）

- [ ] 判定类逻辑放进了 `src/shared/**`（而不是只活在主进程里 —— 那样 smoke 跑不到）
- [ ] 渲染层没有 import electron；UI 改动走设计令牌（没有硬编码色值）
- [ ] 新增 IPC 已同步 `docs/api/openapi.yaml`（如有 HTTP 契约）并通过 `verify:qa-channels`
- [ ] 依赖版本**写死**（无 `^`/`~`），且 `docs/ARCHITECTURE.md` §1.1 锚定值 = 实际安装版本
- [ ] 用户可见的变化已写进 `CHANGELOG.md`（用户视角，不用工程术语）
- [ ] 读 Windows 控制台输出的地方走了 `src/main/winConsole.ts`（K-12 代码页解码）
- [ ] 失败路径如实反映原因（没有把失败画成成功）

## 验证方式

<!-- 你怎么验的：单元/门禁/真机哪几步；有截图或日志片段更佳 -->
