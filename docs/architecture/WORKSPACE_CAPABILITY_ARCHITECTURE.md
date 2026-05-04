# Workspace Capability Architecture

本文档描述当前 Project / Space / Endpoint / Mount / Session / Files 的能力链路。通用代码组织规则见 `ARCHITECTURE.md`。

## Main Chain

当前核心链路是：

```text
Project
  -> Space
  -> targetMountId
  -> MountTarget(endpoint + root)
  -> Session / Files / Worktree operations
```

`space.targetMountId` 是 mount-aware 能力的主要执行上下文。`space.directoryPath` 仍用于兼容、展示和部分 fallback，但新增逻辑不应只依赖它推断执行位置。

## Owners

Project / workspace:

- 保存 workspace state、nodes、spaces、viewport 和 settings。
- 通过 SQLite 持久化。

Space:

- 保存空间边界、节点归属和 `targetMountId`。
- Space Explorer、task/agent launch、terminal spawn 都从 Space 解析执行上下文。

Endpoint:

- 表示执行端点。
- `local` 是隐式本机 Worker。
- `remote_worker` 通过 topology store 注册。

Mount:

- 将 project 内的工作目录绑定到 endpoint。
- 保存 `rootPath/rootUri`、排序和显示名称。
- Mount root 是 filesystem、PTY 和 worktree 操作的 scope。

Session:

- Agent/Terminal runtime 由 Worker runtime 和 stream hub 管理。
- 可恢复 metadata 进入 durable store。
- Terminal presentation snapshot 属于 Worker，不属于 renderer。

Filesystem:

- 通过 `FileSystemPort` 和 Control Surface contracts 访问。
- 普通文件访问检查 approved roots。
- Mount-aware 文件访问检查 mount root，并按 endpoint 路由。

## Directory Structure

源码仍按四个顶层区域组织：

```text
src/
  app/
    main/
    preload/
    renderer/
  contexts/
  platform/
  shared/
```

约束：

- `contexts/*/domain`：业务事实、不变量和纯模型。
- `contexts/*/application`：usecases、ports 和跨 adapter 的编排。
- `contexts/*/infrastructure`：DB、FS、CLI、HTTP、PTY 等技术实现。
- `contexts/*/presentation`：IPC/renderer mapping 和 UI-facing adapter。
- `app/main`、`app/preload`、`app/renderer` 负责组合和边界，不承载领域 owner。

## Current Capability Map

| Capability | Current owner | Public contract |
| --- | --- | --- |
| endpoint registry | topology store | `endpoint.*` |
| mount registry | topology store | `mount.*`, `mountTarget.resolve` |
| filesystem | filesystem context + topology routing | `filesystem.*`, `filesystem.*InMount` |
| worktree | worktree context + mount routing | `gitWorktree.*`, `gitWorktree.*InMount` |
| terminal runtime | Worker PTY runtime | `pty.spawn`, `pty.spawnInMount`, `/pty` |
| terminal presentation | Worker stream hub | `session.presentationSnapshot` |
| agent launch | agent/session launch support | `session.launchAgent`, `session.launchAgentInMount` |
| canvas node CRUD | workspace node control usecases | `node.*` |
| canvas focus | sync/event transport | `canvas.focus` |

## Invariants

1. UI 输入只表达 intent；执行目录、mount、endpoint 的解析在 application/usecase 或 topology owner 内完成。
2. 一个 Space 的 mount-aware 文件/PTY/worktree 操作必须通过 `targetMountId` 解析 scope。
3. Remote mount 操作必须路由到目标 Worker，不得由 Desktop 猜测远端路径。
4. Durable workspace state 与 runtime observation 分开建模。
5. 新增外部能力必须先有 Control Surface contract，再接 CLI/IPC/Web UI。

## Testing Structure

- Unit：按 context/owner 验证纯逻辑和不变量。
- Contract：验证 IPC、Control Surface、CLI DTO、错误语义和输入校验。
- Integration：验证 hydration、persistence、mount routing、worker prepare/revive。
- E2E：验证用户可感知主链路，例如 Space Explorer、mounts、Web UI、terminal recovery。
