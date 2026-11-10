# Create an agent and wait for its first reply

For an authorized one-shot delegation, create the agent and receive its initial reply in one call:

```sh
opencove node create agent --space space-123 --prompt-file ./assignment.txt --wait --read --timeout 2m
```

Placement, provider selection and grants follow ordinary `node create agent`. Without `--wait`,
creation is unchanged. `--wait` requires a nonblank `--prompt` or `--prompt-file` (`-` reads stdin);
`--read` requires `--wait`. Invalid combinations exit 2 before connecting.

The CLI identifies the first observed turn or retained end on the created session, then waits for
that exact turn. Claude Code and Codex support this flow. Other providers return
`agent.wait_unsupported` after creation; the node remains. A missing first turn times out with a
message and the known node/session IDs. The CLI never follows a replacement session.

The result keeps the ordinary create fields (`node.id`, `node.sessionId`, placement and lineage)
and adds `turnId`, `outcome`, `endedAt` and, with `--read`, `reply`. A missing exact reply returns
`reply: null` with `replyUnavailableReason`. Check outcome and reply: exit 0 means the turn ended,
including `failed`, `aborted` or `unknown`; it does not certify task success. `--fields` can select
`id,turnId,outcome,reply.message`. `-q` prints only the node ID after the wait completes.

`--timeout` is one budget for identification and exact waiting (default 20s; minimum 250ms;
maximum 2147483647ms). Creation retains its separate 20s request budget. Optional reading uses the
ordinary request timeout. Exit 10 means the agent needs the user, with `blockedSummary` when
available; 11 means the target exited; 124 means timeout; 130 means interruption.

After creation, errors keep known `nodeId`, `sessionId` and `turnId`, with `retryable: false`.
**Never repeat creation or resend the initial prompt to recover.** Use the hint's exact commands:

```sh
opencove agent wait --node node-123 --turn turn-123 --timeout 2m
opencove agent read --node node-123 --turn turn-123 -o json
```

If no turn ID was identified, inspect `agent get --node node-123` and `agent read --node node-123
--screen`, checking session IDs before continuing. A permission dialog requires the user in OpenCove.
For coordinators who keep working, omit `--wait`, save the create IDs, then get → exact wait → exact
read. For follow-up messages use `agent prompt --wait --read`; see `opencove skill coordinate`.

中文：经授权的一次性委派，优先用 `node create agent --prompt … --wait --read`。返回值保留创建结果，
并附上首个回合的 `turnId`、`outcome`、`endedAt` 和精确回复。`--wait` 需要非空初始提示，`--read` 需要
`--wait`；参数不合法会在连接前以退出码 2 拒绝。超时预算覆盖回合识别和等待，创建保留独立预算。
回合结束返回 0，仍须检查结果与回复；等待用户返回 10，目标退出返回 11，超时返回 124，中断返回 130。
创建后的错误保留已知 ID，节点仍然存在，不可重新创建或重发提示；按提示继续等待或读取同一回合。
需要同时处理其他工作的协调者，仍可采用创建后查询、等待、读取的分步流程。
