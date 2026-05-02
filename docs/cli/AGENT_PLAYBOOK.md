# CLI Agent Playbook

本文档面向 Agent / 自动化脚本，定义如何在本地安全、稳定地使用 OpenCove CLI 做读取、CRUD、focus 与 smoke 测试。

目标不是解释 CLI 的架构原则；架构约束见 `docs/cli/README.md`。本文档只关注一件事：**让 Agent 能正确连上当前有效的 control surface，并用一套可重复的步骤完成验证与清理。**

如果你只需要一份可直接复制给 Agent 的短提示词，使用 `docs/cli/AGENT_PROMPT.md`。

## 1. 适用场景

适合把这份文档直接给 Agent 的场景：

- 验证 `project / space / node / canvas focus / worktree / mount` 相关 CLI 命令。
- 在本地 dev 环境做定向 smoke。
- 排查 “CLI 为什么没连上正确的 OpenCove 实例”。
- 让 Agent 创建临时 Note / Task / Website / Terminal 节点，再做更新、读取、删除验证。

不适合直接照本文档无脑执行的场景：

- 远程 worker 生产环境排障。
- 需要真实启动外部 Agent provider 的重副作用验证。
- 需要验证 renderer 是否真的收到了 `focus` 事件并产生 UI 行为。

## 2. 核心规则

### 2.1 先确认连的是谁

Agent 在执行任何 CLI 命令前，必须先确认目标 `userData` 与 control surface。

默认建议：

```bash
OPENCOVE_USER_DATA_DIR="$HOME/Library/Application Support/opencove-dev"
```

显式设置 `OPENCOVE_USER_DATA_DIR` 后，CLI **只会**在这个目录里查连接文件，不会回退到别的 profile。

### 2.2 普通命令和 `worker status` 的解析规则不同

- 普通 CLI 命令会在目标 `userData` 里解析当前有效 control surface：
  - `control-surface.json`
  - `worker-control-surface.json`
- `opencove worker status` 只检查 `worker-control-surface.json`

这很重要，因为在 **home worker local mode** 下：

- Desktop 主进程可能没有自己的 `control-surface.json`
- 真实可用的是独立 worker 的 `worker-control-surface.json`

### 2.3 dev 下 worker 相关问题先做这两步

```bash
pnpm build
pnpm dev
```

原因：

- worker 运行的是 `out/main/worker.js`
- `pnpm dev` 的 HMR 不会自动更新它

如果 CLI/worker 协议改过、但 `out/` 还是旧的，就会出现“代码明明改了但行为不对”的假象。

### 2.4 Remote worker 默认不要猜

如果当前是 remote worker 模式，优先显式传：

```bash
pnpm opencove ... --endpoint <host:port> --token <token>
```

不要假设本地 `userData` 一定能推断出正确远端。

## 3. Agent 执行顺序

推荐 Agent 严格按下面顺序执行。

### Step 1: 建立连接前提

```bash
export OPENCOVE_USER_DATA_DIR="$HOME/Library/Application Support/opencove-dev"
```

如果是首次验证 worker：

```bash
pnpm build
pnpm dev
```

如果只想临时起一个独立 worker 做 smoke：

```bash
pnpm opencove worker start --user-data "$HOME/Library/Application Support/opencove-dev"
```

### Step 2: 最小可用性检查

先跑：

```bash
pnpm opencove worker status
pnpm opencove ping --pretty
pnpm opencove project list --pretty
pnpm opencove space list --pretty
pnpm opencove node list --pretty
```

判定规则：

- `worker status` 成功：说明 worker control surface 活着。
- `ping` 成功：说明 CLI 已连上一个有效 control surface。
- `project/space/node list` 成功：说明普通业务命令也已经连上正确 control surface。

如果 `worker status` 成功，但 `node list` 失败，通常说明：

- CLI 还在连错 control surface。
- 目标 `userData` 下的有效连接文件不存在。
- remote worker 场景需要改用 `--endpoint --token`。

### Step 3: 读取真实上下文

Agent 做副作用操作前，先读：

```bash
pnpm opencove project list --pretty
pnpm opencove space list --project <projectId> --pretty
pnpm opencove space get --space <spaceId> --pretty
pnpm opencove worktree list --project <projectId> --pretty
pnpm opencove node list --pretty
```

目的：

- 拿到真实 `projectId`
- 拿到一个真实可用的 `spaceId`
- 拿到 `spaceName`
- 拿到 `space.targetMountId`；如需要路径，再用 `mount resolve --mount <targetMountId>` 获取 mount root
- 拿到 local endpoint 下的 `branch`

这些值后面会用于 space locator 验证。

如果 Space 有 `targetMountId`，建议补充：

```bash
pnpm opencove mount resolve --mount <targetMountId> --pretty
pnpm opencove fs ls-in-mount --mount <targetMountId> --uri <rootUri> --pretty
```

## 4. Space Locator 验证方式

当前 CLI 支持以下 locator：

- `--space <spaceId>`
- `--space-name <name> [--project <projectId>]`
- `--worker <id-or-name> --branch <branch> [--project <projectId>]`
- `--worker <id-or-name> --path <absolute-path> [--project <projectId>]`

推荐 Agent 至少验证这三种：

```bash
pnpm opencove node list --space-name <spaceName> --pretty
pnpm opencove node list --worker local --branch <branch> --project <projectId> --pretty
pnpm opencove node list --worker local --path <absoluteMountRootPath> --pretty
```

判定重点：

- 返回的 `spaceId` 是否一致
- 返回的节点集合是否与目标 space 基本一致

## 5. CRUD 与 Focus Smoke 模板

建议 Agent 使用“创建临时节点 -> 更新 -> 获取 -> 删除”的顺序。

### 5.1 Note

```bash
pnpm opencove node create note --space <spaceId> --title "cli-smoke-note" --text "hello" --focus
pnpm opencove node update note --node <noteId> --title "cli-smoke-note-updated" --text "hello updated"
pnpm opencove node get --node <noteId> --pretty
pnpm opencove node delete --node <noteId>
```

### 5.2 Task

```bash
pnpm opencove node create task --space <spaceId> --title "cli-smoke-task" --requirement "smoke requirement" --priority high --tag smoke
pnpm opencove node update task --node <taskId> --status done --priority low --tag done
pnpm opencove node get --node <taskId> --pretty
pnpm opencove node delete --node <taskId>
```

### 5.3 Website

```bash
pnpm opencove node create website --space <spaceId> --title "cli-smoke-site" --url "https://example.com" --pinned
pnpm opencove node update website --node <websiteId> --url "https://example.org" --pinned false
pnpm opencove node get --node <websiteId> --pretty
pnpm opencove node delete --node <websiteId>
```

### 5.4 Terminal

```bash
pnpm opencove node create terminal --space <spaceId> --title "cli-smoke-terminal" --command "pwd"
pnpm opencove node get --node <terminalId> --pretty
pnpm opencove node delete --node <terminalId>
```

说明：

- `terminal delete` 会尝试清理 runtime session。
- 验证时应检查返回里的 `runtimeCleanup`.

### 5.5 Agent

本轮建议：

- **默认只做 `node get` / `node list` 验证已有 agent 节点**
- 不默认做 live `node create agent`

原因：

- 它会真实触发 provider / model / session 启动
- 资源成本和副作用明显更高
- 很容易把“CLI control surface 验证”变成“外部 agent 运行验证”

如果必须做 `agent create`，应先明确：

- provider
- model
- 执行目录
- 是否允许启动真实外部会话

### 5.6 Focus

```bash
pnpm opencove canvas focus node --node <nodeId> --pretty
pnpm opencove canvas focus space --space <spaceId> --pretty
```

重点说明：

- 如果没有挂着 Desktop client / renderer 来接 sync 事件，返回里的 `delivered` 可能是 `false`
- 这不等于命令失败
- CLI/worker smoke 只需要验证命令成功、目标解析正确

## 6. Agent 执行中的安全约束

Agent 在做 CLI 验证时应遵守：

- 优先创建**临时命名**节点，例如 `cli-smoke-*`
- 记录所有新建节点 ID
- 在流程末尾按逆序删除
- 不修改不属于验证目标的现有节点
- 不默认创建真实 agent session
- 不默认连接未知 remote worker

推荐最小清理表：

- `createdNoteIds`
- `createdTaskIds`
- `createdWebsiteIds`
- `createdTerminalIds`

## 7. 常见问题

### 7.1 `incompatible protocol (cli=2, worker=1)`

说明 CLI 和 worker 协议版本不一致。

优先排查：

1. 是否连到了已安装版 OpenCove，而不是当前 dev profile
2. 是否忘了 `pnpm build`
3. 是否 worker 还在跑旧的 `out/main/worker.js`

### 7.2 `control surface is not running (no valid connection info found)`

说明 CLI 在当前目标 `userData` 里找不到活着的 control surface。

优先排查：

1. `OPENCOVE_USER_DATA_DIR` 是否指向了正确 profile
2. `control-surface.json` / `worker-control-surface.json` 是否存在
3. 对应 `pid` 是否仍然存活
4. 如果是 remote worker，是否应该改用 `--endpoint --token`

### 7.3 `worker status` 成功，但普通命令失败

通常说明：

- worker 在跑
- 但普通命令没有解析到同一个有效 control surface

先确认 CLI 版本已经包含“普通命令同时解析 desktop + worker 连接文件”的修复。

### 7.4 `focus.delivered === false`

如果当前没有 renderer client 接收 sync 事件，这是正常的。

CLI smoke 中不应把它当成失败。

## 8. 推荐给 Agent 的最小任务模板

可以直接把下面这段丢给 Agent：

```md
请按 `docs/cli/AGENT_PLAYBOOK.md` 执行一次本地 CLI smoke。

要求：
1. 使用 `OPENCOVE_USER_DATA_DIR="$HOME/Library/Application Support/opencove-dev"`
2. 先验证 `worker status / ping / project list / space list / node list`
3. 至少验证三种 space locator：
   - `--space-name`
   - `--worker local --branch`
   - `--worker local --path`
4. 用临时节点完成 note/task/website/terminal 的 create/update/get/delete
5. 验证 `canvas focus node` 和 `canvas focus space`
6. 记录创建出的节点 ID，并在结束时清理
7. 最终汇报：
   - 跑过哪些命令
   - 哪些成功
   - 哪些失败
   - 失败是否是环境问题、连接问题还是业务问题
```

## 9. 相关文档

- `docs/cli/README.md`
- `docs/architecture/CONTROL_SURFACE.md`
- `docs/cli/CANVAS_NODE_CONTROL.md`
- `docs/development/DEBUGGING.md`
