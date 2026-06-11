# DeepSeek-GUI Agent Guide

本文件面向在本仓库内协作的 AI agent，目标是减少重复摸索，直接按当前项目事实执行。

## 项目架构简介

- 这是一个 `Electron + React + TypeScript` 桌面应用，顶层构建入口见 `package.json`、`electron.vite.config.ts`、`electron-builder.config.cjs`。
- 当前唯一活跃运行时是仓库内置的 `kun/` 子项目；GUI 通过本地 `HTTP + SSE` 边界与 Kun 通信，而不是直接在渲染层跑 agent loop。
- 代码分层以 `src/` 为主：
  - `src/main`：Electron 主进程，负责窗口、进程托管、运行时宿主、系统服务和 IPC 落点。
  - `src/preload`：预加载桥，向渲染层暴露受控能力。
  - `src/renderer/src`：React 前端工作台与业务 UI。
  - `src/shared`：跨层共享类型与工具。
  - `kun/`：独立 TypeScript 运行时包，负责 `kun serve`、线程、工具、缓存与 agent loop。
- 可以把数据流理解为：`Renderer -> preload -> main -> Kun runtime`。涉及运行时行为、会话、SSE、审批、工具调用的问题，先按这条链路定位。

## 代码规范

- 默认使用 TypeScript ESM；修改前先看相邻文件写法，保持现有风格，不要引入与上下文不一致的抽象。
- 渲染层遵循 React Hooks 规则，相关约束由 `eslint.config.js` 中的 `react-hooks` 规则兜底。
- 新逻辑优先放在对应层级：
  - UI 交互放 `src/renderer/src`
  - Electron 宿主/系统集成放 `src/main`
  - 桥接能力放 `src/preload`
  - 运行时能力放 `kun/`
- 变更时优先复用现有脚本、配置和目录结构，不要平行再造一套运行时、构建链或状态管理路径。

## 开发与验证

- 安装依赖：`npm ci`
- 本地开发：`npm run dev`
- 单元测试：`npm run test`
- 类型检查：`npm run typecheck`
- 构建检查：`npm run build`
- 代码检查：`npm run lint`
- 涉及 `kun/` 的改动会先执行 `npm run build:kun`，因为顶层 `build` 和 `dev` 都依赖它。
- 提交前至少运行与改动最相关的检查；如果改动影响 UI、IPC 或运行时链路，通常至少跑 `npm run test`、`npm run typecheck`、`npm run build`。

## 打包方式

- 通用桌面打包入口：`npm run dist`
- macOS 打包：
  - `npm run dist:mac`
  - `npm run dist:mac:arm64`
  - `npm run dist:mac:x64`
  - 已签名 macOS 包：`npm run dist:mac:signed`
- Windows 打包：`npm run dist:win`
- Linux 打包：`npm run dist:linux`
- 发布脚本：
  - `npm run release:mac`
  - `npm run release:win`
  - `npm run release:all`
- 打包配置集中在 `electron-builder.config.cjs`；发布辅助脚本位于 `scripts/`。
- 当前仓库发布校验依赖 GitHub Actions 和构建脚本，改动打包逻辑时先核对 `package.json` 脚本与 `.github/workflows/release.yml` 是否同步。

## Commit 规范

- 使用 Angular Commit 规范，保持和仓库现有历史一致，常见格式：
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `perf(scope): ...`
  - 无明确 scope 时可用 `fix: ...`
- commit 标题要直接描述结果，不写空话。

## 分支与 PR 方式

- 从 Codex worktree 开始时先执行 `git status --short --branch`；如果是 detached HEAD，先创建工作分支再提交。
- 提交前先确认 GitHub 仓库 slug，不要只凭 remote 名称猜；优先使用 `gh repo view` 或 `gh api repos/<owner>/<repo>`。
- 推送使用当前 fork：`git push -u origin <branch>`
- PR 目标分支必须显式设为 `develop`，不要依赖仓库默认分支自动推断。
- 创建 PR 时优先使用仓库现有模板结构，正文至少覆盖：
  - `Summary`
  - `Why`
  - `Changes`
  - `Tests` 或 `Validation`
- CLI 方式可直接使用：

```bash
gh pr create --base develop --head <branch> --title "<title>" --body-file <file>
```

- 创建完成后再用 `gh pr view --json baseRefName,headRefName,url` 复核，确保 base 确实是 `develop`。
- 除非用户明确要求，否则不要直接合并；默认把变更提交到分支并发起 PR。
