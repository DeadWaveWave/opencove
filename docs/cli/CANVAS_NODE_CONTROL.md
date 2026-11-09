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
opencove node list [--root-canvas | space locator] [--kind <kind>] [--pretty]
opencove node get --node <selector> [--space <selector>] [--pretty]
```

Command:

```bash
opencove node create note [--root-canvas | space locator] [--title <text>] [--text <text>] [--frame <json>] [--focus] [--pretty]
opencove node create task [--root-canvas | space locator] --requirement <text> [--title <text>] [--priority <low|medium|high|urgent>] [--tag <tag>] [--frame <json>] [--focus] [--pretty]
opencove node create website [--root-canvas | space locator] --url <url> [--title <text>] [--pinned] [--session-mode <shared|incognito|profile>] [--profile <id>] [--frame <json>] [--focus] [--pretty]
opencove node create agent [--root-canvas | space locator] [--prompt <text>] [--provider <id>] [--model <id>] [--frame <json>] [--focus] [--pretty]
opencove node create terminal [--root-canvas | space locator] [--shell <path>] [--command <text>] [--profile <id>] [--frame <json>] [--focus] [--pretty]
opencove node update note --node <id> [--title <text>] [--text <text>] [--frame <json>] [--pretty]
opencove node update task --node <id> [--title <text>] [--requirement <text>] [--priority <low|medium|high|urgent>] [--status <todo|doing|ai_done|done>] [--tag <tag>] [--frame <json>] [--pretty]
opencove node update website --node <id> [--title <text>] [--url <url>] [--pinned <true|false>] [--session-mode <shared|incognito|profile>] [--profile <id>] [--frame <json>] [--pretty]
opencove node delete --node <selector> [--space <selector>] [--pretty]
opencove canvas focus node --node <id> [--pretty]
opencove canvas focus space [space locator] [--pretty]
```

`--focus` 是 create 的 CLI 编排：

1. 调用 `node.create`。
2. 成功后调用 `canvas.focus`。
3. 返回 node result 和 focus delivery metadata。

Focus 失败不会回滚已创建的 node。显示 root canvas 上的新节点时，用创建命令的 `--focus`，或 `opencove canvas focus node --node <id>`。

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

## Root canvas and defaults

`--root-canvas` 把新节点放在项目画布上，不加入任何 Space。可用 `--project <selector>` 选择项目；在 OpenCove 内省略时使用调用者项目，外部调用必须显式指定项目。该选项不能与 `--space`、`--space-name`、`--worker`、`--branch` 或 `--path` 同用。

```sh
opencove node create note --root-canvas --project project-123 --text "Canvas note" --focus
opencove node list --root-canvas --project project-123
```

在 OpenCove 内，`node create` 未指定目标时读取调用者节点的当前归属：在 Space 内则创建到该 Space，在所有 Space 外则创建到 root canvas。启动后移动终端也采用新归属；读取调用者失败会报错，不会默认为 root。显式 `--project` 不会自动选择 root，创建时还需指定 Space 或 `--root-canvas`。

`node list` 在 Space 内默认列该 Space，在所有 Space 外默认列调用者项目的全部节点。`--root-canvas` 仅列选定项目中 `spaceId: null` 的节点；`--kind`、`--fields`、`--limit` 和 table 输出仍可组合使用。在 OpenCove 外未指定项目的 list 沿用当前活跃项目。

root 创建未指定 x/y 时，在 OpenCove 内优先放在你旁边：你在 Space 内时，从该 Space 的右侧开始寻找空位；你在所有 Space 外时，从你的节点右侧开始。定位以目标项目中调用者的当前归属和位置为准，避开已有节点及所有具有边界矩形的 Space。无法在该项目定位调用者时（包括远端身份在当前 Worker 不存在），或在 OpenCove 外调用时，从画布原点开始寻找空位。

这只是尽力靠近调用者的提示，不保证可见；需要显示新节点时使用 `--focus` 或 `opencove canvas focus node --node <id>`。仅指定 width/height 的 `--frame` 仍会自动定位；指定 x/y 时沿用既有坐标规则，完整 x/y 精确定位且不做避让。root 创建要求项目已有默认 mount 和可用 endpoint。

远端托管 agent 的连接方式和限制与其他画布命令一致；本次不新增远端路由或授权能力。结果结构不变，root 节点的 `spaceId` 为 `null`。

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
- Minimum task frame: width 220, height 260 canvas units; supplied dimensions are
  clamped by canonical sizing (maximum width 360, height 520). CLI results retain
  node.frame and add appliedFrame (the full applied frame) and frameAdjusted.
  Only explicitly supplied frame components count as adjusted; defaults do not.
  An adjustment prints one stderr notice, including with --focus; JSON stdout
  remains directly parseable. No CLI-side resizing or second mutation occurs.
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
- `src/app/cli/commands/nodes.ts`
- `src/app/main/controlSurface/handlers/nodeControlHandlers.ts`

## CLI output

成功 stdout 直接包含节点结果 JSON（例如 `node`、`revision`），没有 transport envelope。失败为非零 exit code，JSON 错误位于 stderr。查询支持 `--fields`；mutation 不支持字段投影。长文本使用 `--text-file`、`--requirement-file` 或 `--prompt-file`，`-` 表示 stdin。


Node selectors also accept `--space <selector>` for names and prefixes. Exact IDs
retain precedence; ambiguous names are refused with space names and note previews.
Lists accept `--limit <n>` and report cut-list totals in `truncated`; see the
[CLI output and selector guide](README.md#selector-diagnostics-and-bounded-output).
