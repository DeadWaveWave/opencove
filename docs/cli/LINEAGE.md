# Creation lineage and parent selectors

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

## Quota summaries and structured recovery

`whoami.lineageQuota` and `context.self.lineageQuota` use the admission census and
include `remainingLiveInTree`, clamped at zero. The user root is excluded; starting
and idle-but-running descendants still occupy slots. Default interactive (TTY) output adds
`Agents: 4 of 6 running in your tree; depth 1 of 3`. Use `-o json` or `--fields`
for machine-readable output; pipes and `--pretty` also keep the standard JSON renderer. Older Workers may omit the quota or remaining field.

Quota refusals retain their existing code, exit status and hint. `details.nodes`
adds `sessionStartedAt` (ISO timestamp, or null when unknown/starting) and the
observed `sessionId`. Compare known timestamps to choose the oldest occupant;
unknown timestamps do not prove age. `details.actions` contains
`{kind: 'stop_agent', nodeId, command}` with shell-quoted agent targets.
Terminal actions are omitted: the hint requires looking up the current
`node.sessionId` with `node get`, then killing that freshly resolved session.
Never use the refusal's census session ID for recovery after a rebind. Recheck
bindings before acting; killing a terminal stops the whole shell.
These suggestions do not expand grant scope or authorize stopping another task.

## Inspect the whole quota tree

Run `opencove whoami --tree` before delegating. JSON/pipes return the normal identity plus
`tree.occupants`. Occupant membership and counts come from the admission census; ordinary
`whoami`, `context` and quota refusal details keep their existing output.
Each occupant keeps nodeId, title, kind, depth, spawnedBy, sessionId, sessionStartedAt and census
state (`starting` or `running`). `workState` adds state, quality, blockedReason and turnId from one
`agent.list` query, joined only when both node and session match. Missing/stale observations remain
`unknown` and never remove an occupant. Quota membership and agent work state describe different facts.

TTY output shows remaining slots and indents by creator, with work state and a stop command.
`actions` reuses refusal actions; terminals have no stored kill action. Look up their current
session ID, then kill that session. Idle agents still occupy slots; check before stopping.
The view is a snapshot, not a slot reservation, and never stops anything automatically.

Older Workers missing census rows exit 5 with an update hint and retain available identity/counts
in `error.details.identity`; they never report an empty tree. Without a canvas session identity
(bearer/cookie or standalone session grant), `--tree` returns ordinary identity without a tree.
Ordinary `whoami` and `context` output stay byte-identical. Census rows and their `spawnedBy`
field appear only with `whoami --tree`; refusal rows retain their existing shape.

中文：委派前运行 `whoami --tree`，查看整个配额树、剩余名额、工作状态和停止命令。名额与占用行
来自 admission 同一 census；缺失或过期的工作状态显示 `unknown`，不会丢弃占用者。空闲智能体
仍占名额，请检查后再停止。终端必须先查询当前 session ID。旧 Worker 缺少占用行时退出码为 5，
提示更新并在错误中保留已知计数；没有画布会话身份时保持普通身份输出，不添加空树。
