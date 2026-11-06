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
- 远程 Project 的 `projects/<projectId>` 本地占位目录只保存项目元数据，不是执行目录。
  Project 默认目录下的 Agent 和 Terminal 启动必须解析默认 mount；已有显式 mount 或
  Space/worktree 目录仍优先使用，无法解析默认 mount 时不得退回占位目录启动。

Space:

- 保存空间边界、节点归属和 `targetMountId`。
- `parentSpaceId` 只表示画布视觉组织关系，不表示执行目录或 Git worktree owner。
- Space Explorer、task/agent launch、terminal spawn 都从 Space 解析执行上下文。
- 当旧 Space 缺失 `targetMountId`、或绑定的 mount 已失效，但 `directoryPath` 仍能映射到现有 mount 时，启动路径会先修复 Space 的 mount 绑定，再继续执行。
- Space 创建、child Space、Space Worktree 和归档生命周期规则见 `docs/canvas/SPACE_LIFECYCLE_SPEC.md`。

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
| space mount resolution | shared space application helper | renderer launchers, `session.launchAgent`, `session.spawnTerminal`, `node.*` |
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
3. 只携带 `spaceId` 的通用 launch/spawn intent，在命中 mount 时也必须先解析 mount，再委派到 `*InMount` 路径执行。
4. Remote mount 操作必须路由到目标 Worker，不得由 Desktop 猜测远端路径。
5. Durable workspace state 与 runtime observation 分开建模。
6. Space 的视觉 containment 不得被当成 worktree deletion 或 execution scope 的隐式 authority。
7. 一条 Space ancestor chain 上最多只有一个 Space Worktree boundary；sibling child Spaces 可以分别成为 Worktree。
8. 新增外部能力必须先有 Control Surface contract，再接 CLI/IPC/Web UI。

## Testing Structure

- Unit：按 context/owner 验证纯逻辑和不变量。
- Contract：验证 IPC、Control Surface、CLI DTO、错误语义和输入校验。
- Integration：验证 hydration、persistence、mount routing、worker prepare/revive。
- E2E：验证用户可感知主链路，例如 Space Explorer、mounts、Web UI、terminal recovery。

## Headless workspace bootstrap

`project.add` is an `admin` schema command accepting `{ path, name? }`. `path` must be an
absolute local directory. Missing, inaccessible or non-directory paths return
`common.invalid_input` before approval or mount creation. The root is approved, a local mount
is allocated, and the project plus `Space 1` are persisted. An empty profile uses format version
1 and `DEFAULT_AGENT_SETTINGS`. The result is `{ projectId, spaceId, mountId }`.

Duplicate normalized paths reuse the existing project, preserve its name/content and activate
it, matching the legacy directory-add action. Missing mounts/spaces are supplied. The Wizard
historically permits duplicate paths and starts with no spaces; bootstrap deliberately supplies
a default space so headless node creation has a usable target. Project and empty-space record
construction is shared with the Wizard and canvas through `workspace/domain/workspaceBootstrap`.

`space.create` is an `interact` schema command accepting `{ projectId, name, directoryPath? }`
and returning `{ projectId, spaceId, mountId }`. It creates a top-level space bound to the first
mount by `sortOrder`, defaulting its directory to that mount's root. Local directories must exist
and remain inside the selected root after canonical-path resolution; traversal and symlink escapes
are rejected before persistence. Internal symlinks are stored using their canonical relative
destination under the mount's root spelling. Bootstrap space creation rejects remote mounts,
including their default root: startup approval currently interprets Space directories as local
approval roots. Remote support requires endpoint-aware approval hydration and canonical-path
validation before this restriction can be lifted.
It uses the canvas window
size and collision-placement rules, centered initially at world origin (there is no pointer in
a headless client). Unlike child creation, it has no parent containment or node-transfer step.

Both commands share a runtime mutation owner and use revision-checked persistence writes.
Conflicts are surfaced rather than silently overwriting another writer. A published mount is
retained on write failure: renderer writers outside this queue may already have adopted it.
This can leave an unreferenced mount requiring explicit removal, but cannot delete another
writer's successful binding as compensation. Root
approval is durable and is not revoked on failure, since approval can be shared by other projects.
Topology and app-state storage are separate transactions; process crashes between them are not
made atomic by these commands. HTTP command dispatch publishes the existing `app_state.updated`
event when the revision changes, including bootstrap commands. No new event protocol or CLI
command is introduced. Common validation errors are shared protocol errors; registry metadata
also declares persistence errors. This documentation adds no executable architecture-rule impact.
