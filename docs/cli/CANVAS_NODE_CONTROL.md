# CLI Canvas Node Control

OpenCove CLI 可以通过 Control Surface 管理画布节点。CLI 是 client，不是 owner；所有读写都通过 `node.*` 和 `canvas.focus` contracts，禁止直接读写 DB、renderer store 或 runtime handle。

## Supported Node Kinds

当前 CLI 管理以下 node kind：

- `note`
- `task`
- `website`
- `agent`
- `terminal`

`node.update` 支持：

- `note`
- `task`
- `website`

Agent 和 Terminal 的运行时行为不通过通用 `node.update` 表达；它们通过 session / PTY contracts 管理。

## Commands

Query:

```bash
opencove node list [space locator] [--kind <kind>] [--pretty]
opencove node get --node <id> [--pretty]
```

Command:

```bash
opencove node create note [space locator] [--title <text>] [--text <text>] [--frame <json>] [--focus] [--pretty]
opencove node create task [space locator] --requirement <text> [--title <text>] [--priority <low|medium|high|urgent>] [--tag <tag>] [--frame <json>] [--focus] [--pretty]
opencove node create website [space locator] --url <url> [--title <text>] [--pinned] [--session-mode <shared|incognito|profile>] [--profile <id>] [--frame <json>] [--focus] [--pretty]
opencove node create agent [space locator] [--prompt <text>] [--provider <id>] [--model <id>] [--frame <json>] [--focus] [--pretty]
opencove node create terminal [space locator] [--shell <path>] [--command <text>] [--profile <id>] [--frame <json>] [--focus] [--pretty]
opencove node update note --node <id> [--title <text>] [--text <text>] [--frame <json>] [--pretty]
opencove node update task --node <id> [--title <text>] [--requirement <text>] [--priority <low|medium|high|urgent>] [--status <todo|doing|ai_done|done>] [--tag <tag>] [--frame <json>] [--pretty]
opencove node update website --node <id> [--title <text>] [--url <url>] [--pinned <true|false>] [--session-mode <shared|incognito|profile>] [--profile <id>] [--frame <json>] [--pretty]
opencove node delete --node <id> [--pretty]
opencove canvas focus node --node <id> [--pretty]
opencove canvas focus space [space locator] [--pretty]
```

`--focus` 是 create 的 CLI 编排：

1. 调用 `node.create`。
2. 成功后调用 `canvas.focus`。
3. 返回 node result 和 focus delivery metadata。

Focus 失败不会回滚已创建的 node。

## Space Locator

CLI 将 locator flags 转成 DTO，真正解析在 workspace application logic 内完成。

支持的 locator：

```bash
--space <spaceId>
--space-name <name>
--project <projectId>
--worker <endpointId-or-display-name> --branch <branch>
--worker <endpointId-or-display-name> --path <absolute-path>
```

规则：

- 一次请求只能使用一种 locator mode。
- `--project` 可用于收窄 `--space-name`、`--worker --branch` 或 `--worker --path`。
- 匹配必须唯一；无匹配返回 `space.not_found`，多匹配返回 ambiguity error。
- CLI 不自行推断 cwd、branch、mount 或 worktree 归属。

## Control Surface Contracts

Operation ids:

- `node.list`
- `node.get`
- `node.create`
- `node.update`
- `node.delete`
- `canvas.focus`

DTO 定义：

- `src/shared/contracts/dto/nodeControl.ts`

Handlers：

- `src/app/main/controlSurface/handlers/nodeControlHandlers.ts`

Usecases：

- `src/contexts/workspace/application/nodeControl/*`

## Node Semantics

Note:

- Create 默认 text 为空。
- Update 可修改 title、text 和 frame。

Task:

- Create 要求 `requirement`。
- Priority 默认 `medium`。
- Tags 可重复传入。
- Update 可修改 title、requirement、priority、status、tags 和 frame。

Website:

- Create 要求 `url`。
- `sessionMode` 默认 `shared`。
- Runtime activation 不等同于 durable node creation；Control Surface 不返回 WebsiteWindow handle。

Agent:

- Create 会先通过 session launch path 启动 runtime。
- 启动失败时不持久化 agent node。
- 持久化失败时 best-effort kill 已启动 session。

Terminal:

- Create 会通过 `pty.spawn` 或 `pty.spawnInMount` 创建 runtime。
- `command` 通过用户指定 shell 或平台默认 shell 执行。
- Spawn 失败时不持久化 terminal node。

Delete:

- 删除 durable node，并从 Space membership 移除 node id。
- Agent/Terminal runtime cleanup best-effort。
- Website runtime close best-effort。

Focus:

- `canvas.focus` 发布 sync event。
- 当前没有活跃 canvas client 时返回 `delivered: false`，不写 durable viewport。

## Invariants

1. Query 不修改状态，也不移动视口。
2. 一个 node 最多属于一个 Space。
3. Mutation 后 `space.nodeIds` 必须引用存在的 node。
4. Node kind 必须匹配 kind-specific payload。
5. Space locator 歧义必须失败。
6. Focus 不覆盖 durable viewport。
7. Agent/Terminal runtime 交互不通过 `node.update` 表达。

## Verification Anchors

- `tests/unit/app/cliNodeControl.spec.ts`
- `tests/unit/contexts/nodeControl.spec.ts`
- `src/app/cli/commands/nodeControl.mjs`
- `src/app/main/controlSurface/handlers/nodeControlHandlers.ts`
