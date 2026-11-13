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
