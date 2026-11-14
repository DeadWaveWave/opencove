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

- `agent`、`terminal`：重命名，也可同时更新 frame；不接受任何 data 字段。

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
opencove node create agent [--root-canvas | space locator] [--title <text>] [--prompt <text>] [--provider <id>] [--model <id>] [--full-access true|false] [--task <nodeId>] [--frame <json>] [--focus] [--pretty]
opencove node create terminal [--root-canvas | space locator] [--title <text>] [--shell <path>] [--command <text>] [--profile <id>] [--frame <json>] [--focus] [--pretty]
opencove node update note --node <id> [--title <text>] [--text <text>] [--frame <json>] [--pretty]
opencove node update task --node <id> [--title <text>] [--requirement <text>] [--priority <low|medium|high|urgent>] [--status <todo|doing|ai_done|done>] [--tag <tag>] [--frame <json>] [--pretty]
opencove node update website --node <id> [--title <text>] [--url <url>] [--pinned <true|false>] [--session-mode <shared|incognito|profile>] [--profile <id>] [--frame <json>] [--pretty]
opencove node update agent --node <selector> [--title <text>] [--frame <json>] [--pretty]
opencove node update terminal --node <selector> [--title <text>] [--frame <json>] [--pretty]
opencove agent stop --node <selector>
opencove node delete --node <selector> [--space <selector>] [--pretty]
opencove canvas focus node --node <id> [--pretty]
opencove canvas focus space [space locator] [--pretty]
```

`--focus` 是 create 的 CLI 编排：

1. 调用 `node.create`。
2. 成功后调用 `canvas.focus`。
3. 返回 node result 和 focus delivery metadata。

Focus 失败不会回滚已创建的 node。显示 root canvas 上的新节点时，用创建命令的 `--focus`，或 `opencove canvas focus node --node <id>`。

## Near placement (V1)

Recommend `--near @self` for agents creating helper notes, terminals or agents:

```sh
opencove node create note --near @self --text "Progress"
opencove node create terminal --near @self --title "Checks"
opencove node create agent --near @self --prompt "Review the tests"
```

All supported create kinds accept `--near <node selector>` (ID, exact name, unique prefix,
`@self`, `@parent`). It is explicit opt-in: omitting it preserves existing behavior.
The reference supplies its current project and direct Space, or root if it has no Space.
An external caller can supply a reference ID without `--project`. An explicit project or
Space locator is a consistency constraint; the reference must belong directly to that Space.
`--root-canvas --near <selector>` overrides membership and searches beside the reference's
Space in the reference's project. A size-only `--frame '{"width":520,"height":420}'` requests
that size near the reference. Width-only, height-only and empty frames are also allowed; x/y
(including null coordinate keys) are refused before mutation. Sizes outside the kind's range
are adjusted to fit; inspect `appliedFrame` and `frameAdjusted`. Create/update help lists each
kind's minimum and maximum dimensions from the same shared constants used by runtime enforcement.

Near candidates first prefer no container/ancestor growth, then growth whose resulting container
and every grown ancestor avoid unrelated Space rectangles, then all other growth. Within each
tier, candidates keep the compact nearest-edge ordering: right column (top-aligned, then stacking
down), row below, left column, then further out. Parent/descendant containment is intentional
and is not treated as a Space collision. Other Space rectangles remain solver obstacles.
The same pure growth plan is used for ranking and the creation CAS; ranking and size clamping
are recomputed on every attempt. The CAS inserts membership and grows ancestors together.
If all candidates require intersecting Space envelopes, placement still uses its last tier;
this is a preference, not a global non-overlap guarantee. Existing nodes stay fixed. Missing Space
rectangles use bounds derived from members and child Spaces; only missing target/ancestor
rectangles are seeded during insertion. Empty unrelated Spaces with no rectangle are ignored.
Near is an anchor preference, not a distance guarantee; growing Space envelopes can overlap.

The CLI requires `features.nodeNearPlacementV1 === true`, including through `api call`.
Unsupported Workers fail with `cli.unsupported` (exit 5) and an upgrade hint, without creation.
The Worker revalidates the reference and target on each CAS attempt; missing references return
`node.not_found`. Target identity changes fail with existing cleanup and no relaunch.
References resolve only on the connected Worker; no origin fallback or automatic remote routing.
Reference selection does not change authenticated creator identity, grants or runtime restrictions.
Only the final frame and membership persist, with no continuing near relationship.

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

root 创建未指定 x/y 时，在 OpenCove 内优先放在你旁边：你在 Space 内时，从该 Space 的右侧开始寻找空位；你在所有 Space 外时，从你的节点右侧开始。定位以目标项目中调用者的当前归属和位置为准，避开已有节点及所有具有边界矩形的 Space。调用者节点属于其他项目，或在 OpenCove 外调用时，从画布原点开始寻找空位。若会话绑定的节点已删除或不属于当前 Worker，创建会返回 node.not_found；请从有效的 OpenCove 节点继续。

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

## Frame results

`node update --frame` grows the node's Space and ancestors with padding in the same update, without shrinking boundaries, moving other nodes or changing membership; explicit coordinates are preserved even when Space boundaries overlap.

中文：`node update --frame` 在同一次更新中扩展所属 Space 和各级祖先并保留留白，不缩小边界、不移动其它节点、不改变归属；即使 Space 边界重叠，也保留指定坐标。

With `--frame`, every supported kind reports `appliedFrame` and `frameAdjusted`
after create or update. Only explicitly requested components count as adjusted;
automatic placement does not. Adjustments print one stderr notice naming the kind,
including with `--focus`, while stdout remains JSON. Notes are clamped to width
220–360 and height 140–260 canvas units; a 400×300 request applies 360×260.
Task creation keeps these result fields even without `--frame`.

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
- 可选 `--task <nodeId>`（`data.taskNodeId`）将新 agent 链接到同一 Space 的现有任务；根画布上的 agent 只能链接根画布任务。省略时 `agent.taskId` 为 `null`，任务不变；传入时必须是非空字符串（`null`、空白或其他类型返回 `common.invalid_input`）。智能体终端也可使用，无新增权限。
- 启动前验证任务存在于目标 project（否则 `node.not_found`）、类型为 task、位于同一 Space、没有仍存在的已链接 agent（否则 `common.invalid_input`）。指向已删除 agent 的旧链接允许替换。
- Worker 的 `commitCreatedNode` 在启动成功后基于最新状态再次验证，将 agent 节点、`agent.taskId`、任务的 `linkedAgentNodeId`、`status: 'doing'`、`updatedAt` 和 `lastRunAt` 在同一次 CAS 提交中写入（有 lineage 时使用 `commitCreatedNodeState`）。启动或确定未提交的写入失败不改变任务，后者沿用现有 session 清理；写入结果不确定时沿用读回保护，不误杀可能已提交的 session。
- 与画布 Run 新建 agent 一致，创建链接不新增 `agentSessions` 历史，保留已有记录；关闭或切换 session 时才归档。`--prompt` 仍由调用方提供，链接不会替换 prompt。
- 可选 `data.agentFullAccess`（CLI `--full-access true|false`）必须是布尔值；显式值在两个方向覆盖 Settings，仅作用于该 agent，智能体终端也可传入。
- 显式值保存在 agent 节点，relaunch、resume 和 app-restart recovery 使用 `node.agent.agentFullAccess ?? settings.agentFullAccess`；省略时继续跟随当前 Settings，不修改 Settings，也无需迁移旧数据。
- `node.update` 不能更改该启动时选择；agent update 只接受名称和 frame。
- 启动失败时不持久化 agent node。
- 持久化失败时 best-effort kill 已启动 session。

Terminal:

- Create 会通过 `pty.spawn` 或 `pty.spawnInMount` 创建 runtime。
- `command` 通过用户指定 shell 或平台默认 shell 执行。
- Spawn 失败时不持久化 terminal node。

命名与停止：

- 创建 agent/terminal 时，非空 `title` 会固定名称；省略或仅空白则继续使用自动标题。
- 重命名要求非空 title，去除首尾空白后按字面保存和显示，调用者提供的 provider 前缀也保留；旧 UI 装饰和自动标题维持原展示规则；可同时更新 frame，也可只更新 frame 并保留名称和固定状态。
- 标题与 pin/literal 标志是同一命名意图；未固定的 Renderer 自动标题不能在待发布状态合并或 guarded rebase 中覆盖它，其他本地编辑继续合并。
- 固定名称由 Worker 持久化；会话标题同步和启动标题不能覆盖它，已有未固定节点保持自动标题行为。
- `agent stop` 支持 agent 节点和当前会话中有存活 agent 观测的 terminal，停止整个会话但保留节点，不发送终端输入。
- agent-only 远端停止暂不支持：请求在派发前拒绝，不会降级成无条件 session.kill。
- 已退出 agent 的保留观测只返回 not_running，不停止仍存活的 shell 或后续无关工作；Worker 在真正停止前再次检查准入。
- 返回 `{nodeId, sessionId, stopped: true}` 表示已请求停止，进程退出异步完成；已退出返回 `stopped: false, reason: "not_running"`，exit 0。
- 绑定变化返回 exit 2；无绑定返回 exit 1。普通 terminal 会提示使用 `session kill --session <id>`。

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

成功 stdout 直接包含节点结果 JSON（例如 `node`、`revision`），没有 transport envelope。失败为非零 exit code，JSON 错误位于 stderr。`--fields` 投影已声明的输出字段，包括支持投影的专用 mutation 命令；generic `api call` mutation 和流式命令不支持。长文本使用 `--text-file`、`--requirement-file` 或 `--prompt-file`，`-` 表示 stdin。


Node selectors also accept `--space <selector>` for names and prefixes. Exact IDs
retain precedence; ambiguous names are refused with space names and note previews.
Lists accept `--limit <n>` and report cut-list totals in `truncated`; see the
[CLI output and selector guide](README.md#selector-diagnostics-and-bounded-output).

`session.stopNode` 不带 `agentOnly` 时保留通用清理语义：自然退出的 agent 仍可有受其拥有的子进程，清理请求继续交给 termination owner；这与 CLI `agent stop` 的 exited no-op 是两种明确用途。

## Creation lineage and parent selectors

`@parent` selects the node that created your node through an OpenCove session grant.
The Worker resolves it from your authenticated identity. It can be a terminal or another node
kind; each command still checks whether the target supports that action. A root has no parent,
and a deleted parent cannot be addressed. A node literally named `@parent` must be selected by ID.
`@self` keeps its injected identity and `whoami` fallback; Space selection keeps its existing behavior.

Node get/list/create, agent get/list and context node summaries expose creation lineage:

- `spawnedBy`: the creator node ID, or `null` for a root or unavailable lineage.
- `lineageDepth`: A node started by the user has `lineageDepth` 1; each agent-created generation adds one (1 → 2 → 3). Unavailable lineage has `null` depth.
- `lineageStatus`: `recorded` for recorded creations, `root` without a recorded parent, or `unavailable` when lineage cannot be read. Missing fields mean an older Worker.

Lineage survives renames, moves, parent deletion, renderer saves and restart.

Use `node list --spawned-by @self` or `agent list --spawned-by @self` for direct children across
the project; an explicit `--space` or `--project` narrows results. Filtering precedes output limits.
`@parent` and `--spawned-by` require `features.nodeLineageV1`; older Workers fail with exit 5.

中文：`@parent` 由 Worker 根据已验证的会话身份解析，指向创建当前节点的父节点；父节点可以是终端。
用户启动的节点为 root，`lineageDepth` 为 1；Agent 每创建下一代，深度加 1（1 → 2 → 3）。父节点删除后返回 `parent_deleted`，
不会改变子节点的血缘记录。`--spawned-by @self` 只列出直接子节点，默认跨当前项目的所有 Space；
显式 Space／项目筛选仍有效。旧 Worker 不支持这些选择器或筛选时退出码为 5。

With `--spawned-by`, `--project` filters child results; the creator may belong to another project.
Full IDs, `@self` and `@parent` resolve the creator independently of that filter. Creator names
and prefixes use your session project, or an explicit Space’s project. Without session identity,
the selected project supplies the name lookup context. Use a full ID for a creator outside that context.
中文：`--project` 只筛选子节点，不要求创建者属于该项目。创建者名称／前缀默认在当前会话项目中查找；
显式 Space 提供其所属项目作为查找范围。没有会话身份时，使用选定项目查找名称。跨查找范围请用完整 ID。
