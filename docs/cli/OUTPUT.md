# CLI output

## Errors and safe retries / 错误与安全重试

Every JSON error is written to stderr as `{error: {code, message, hint?, retryable,
candidates?, details?}}`; stdout stays empty. Exit codes are unchanged. On a TTY,
errors and candidate rows are readable text; `-o json` forces JSON. TTY candidate fields escape control characters (including
line breaks); JSON preserves their original values.

所有 JSON 错误写入 stderr，stdout 保持为空，退出码不变。`retryable` 始终为布尔值：
只有原样重试可能成功且不会重复副作用时才为 `true`。TTY 显示可读错误及候选项，
`-o json` 强制使用 JSON。TTY 候选字段中的控制字符及换行会转义显示；JSON 保留原值。

Retryability defaults to false. The closed allowlist in
`src/app/cli/core/errorPresentation.ts` requires an exact code **and** structured
reason. A bare code, an absent/unknown reason, and all unlisted combinations are
false, including errors from older Workers without an audited reason.

| Code                   | Required details.reason | Why the unchanged command can succeed later                                             |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `context.unreachable`  | `connection_refused`    | A read connection was refused (structured ECONNREFUSED); the Worker can start listening |
| `worker.unavailable`   | `connection_refused`    | A resolved endpoint's read-only ping was refused; its Worker can start listening        |
| `transport.timeout`    | `read_timeout`          | A query exceeded its request budget; the next read can complete within that budget      |
| `agent.wait_timeout`   | `wait_timeout`          | A read-only observation budget expired; the target can meet the condition later         |
| All other combinations | Any, missing or unknown | Not established as safely retryable                                                     |

重试默认关闭；只有 code 和结构化 `details.reason` 同时命中上表才可能为 true。
没有 reason、未知 reason 或其他组合均为 false，旧 Worker 未提供已确认的 reason 时也不例外。
连接拒绝只根据底层结构化 ECONNREFUSED 判断，不解析错误文案；普通连接异常、DNS 名称错误、
无效响应、runtime 未就绪等均不会仅凭 code 获得重试资格。

An unregistered Worker selector returns `worker.unavailable` with
`reason: "worker_not_found"`; a missing endpoint ID returns it with
`reason: "endpoint_not_found"`. A registered endpoint without a resolved connection
returns `reason: "endpoint_connection_unavailable"`. All three are non-retryable;
use `opencove endpoint list` to inspect registered targets. Generic remote failures
without verified refusal use `reason: "connection_failed"` and also remain false.

未注册 Worker、缺失 endpoint、已注册但没有可用连接，分别通过 worker_not_found、
endpoint_not_found、endpoint_connection_unavailable 区分，均不可原样重试；请用
`opencove endpoint list` 检查已注册目标。未经确认的其他连接失败标为 connection_failed，
同样保持 false。CLI 不根据消息文本推断任何一种情况。

A mutation dispatch makes the whole command non-retryable, including generic
`api call` mutations. Unknown delivery outcomes, attempted paste or attempted
submission also force `false`. An audited connection refusal on a read can be retried; missing profile
records alone do not establish a transient failure. A timeout after dispatch does not establish that a write failed.
Never resend a prompt to recover a delivery result or reply.

一旦开始派发修改操作，整条命令的 `retryable` 就为 `false`，通用 `api call` 也遵守
此规则。投递结果未知、可能粘贴或提交过输入时同样为 `false`。修改操作超时并不代表
没有生效。不要为恢复投递结果或回复而重发 prompt。验证、拒绝、未找到、歧义和授权
错误默认不可重试。当前没有已确认可安全重试的 persistence conflict code，因此未添加推测性条目。

Ambiguity errors and not-found suggestions expose `error.candidates`. Each node
candidate includes `id`, `kind` and `title`; Space/profile candidates retain their
locator fields and add a stable `id` and `kind`. Existing `details.candidates` is
retained for compatibility and deprecated: new consumers should read
`error.candidates`. Profile ambiguity retains its legacy details array.

歧义及带建议的未找到错误将候选项放在 `error.candidates`；节点包含 `id`、`kind` 和
`title`。旧的 `details.candidates` 继续保留，但新调用方应改用顶层候选数组。
Profile 歧义继续保留原有的 details 数组，避免破坏旧调用方。

## Compact lists / 紧凑列表

`node list` and `agent list` show at most 50 rows by default. Their rows can include
node content summaries, run-state and turn metadata; 120 nodes can fill many
screens. `project list` and `space list` remain unlimited: they are navigation
catalogs, and Space lists already omit node objects by default. Other lists keep
their existing explicit `--limit` behavior. This includes endpoint/mount/worktree
navigation, filesystem entries, plugin lists/source repositories/windows, Worker
status rows and the offline `api ops` catalog; use its domain/search filters for a
compact view. Wait results and context are observations of selected targets, not
capped discovery lists.

`node list` 和 `agent list` 默认最多显示 50 项；它们包含节点摘要、运行状态或回合信息，
适合先查看紧凑列表。`project list` 与 `space list` 不设默认上限；它们用于导航，且
Space 列表默认不展开节点对象。其余列表保留原有的显式 `--limit` 行为。

- `--full` removes the default cap. An explicit `--limit <n>` takes precedence;
  `--limit 0` means all results.
- Truncated node/agent JSON envelopes add `truncated: true` and `total` (the count
  after scope/kind/state filters, before the display cap). Complete lists omit both.
  These replace the older `truncated: {nodes: n}` / `{agents: n}` totals for these
  two dedicated commands. Other commands keep their existing envelope shapes.
- Exactly one stderr notice states the omitted count and how to see everything.
  `--fields` and `-o table` use the same cap and notice; tables keep their text shape.
- Worker order is preserved. The cap introduces no sorting, proximity heuristic
  or pagination. Order is deterministic for the same returned snapshot, but may
  change as the canvas or run registry changes.
- Internal lists used by selectors, context and task links remain complete.
  Explicit node targets (get, read, wait) receive no default cap.

`--full` 取消默认上限，显式 `--limit` 优先，`--limit 0` 返回全部。截断时 JSON 增加
`truncated: true` 与过滤后的 `total`，并在 stderr 输出一条含省略数量及完整查询方法的
提示。投影和表格遵守同样的上限。保持 Worker 返回顺序；同一快照的顺序稳定，不做
距离排序。内部选择器、context 和任务关联查询始终读取完整列表，指定节点的操作不受默认上限影响。

```sh
opencove node list --fields id,title
opencove node list --full --fields id,title
opencove agent list --limit 100 -o table
```

## Terminal reads / 终端读取

`agent read --screen` works for both plain terminals and agent windows. It returns
only visible rows, defaulting to the last 40 non-padding rows. `--scrollback`
returns retained normal-buffer history plus the screen, defaulting to the last
200 rows; `--lines` accepts 1–5000 in this mode. Both use the same ANSI-free
rendering, preserve cursor spacing and wide characters, and trim trailing blank
rows before taking the tail. JSON has `{nodeId, sessionId, lines}`; plain text is
the default. An active alternate screen has no scrollback and returns its current
rows only. This is retained live terminal history, not a durable conversation log;
history cleared by the terminal or lost at session replacement is unavailable.

`agent read --screen` 可读取普通终端和智能体窗口的可见屏幕，默认取末尾 40 行。
`--scrollback` 读取保留的正常缓冲区历史及屏幕，默认取末尾 200 行，`--lines` 范围为
1–5000。两种模式均去除 ANSI、保留光标间距和宽字符，并在取末尾行之前移除末尾空行。
交替屏幕没有历史，仅返回当前屏幕。这里读取的是会话中保留的终端历史；它不承诺持久化
对话记录，也无法恢复终端已清除或会话替换后丢失的历史。

`--screen` and `--scrollback` conflict with each other and with `--last`/`--turn`.
`--lines` requires one of the screen modes. Reading never sends input.

两种屏幕模式互斥，且都不能与 `--last` 或 `--turn` 同时使用。`--lines` 必须搭配一种屏幕
模式。读取操作不会发送任何输入。

```sh
opencove agent read --node "Shell" --screen --lines 20
opencove agent read --node "Reviewer" --scrollback --lines 500 -o json
```

## Creation identifiers / 创建结果标识

`node create <kind> -q` (or `--quiet`) prints only the new node ID and a newline.
`worktree create -q` prints the worktree path: Git worktrees have no separate ID.
Quiet output conflicts with `--fields` and `-o`, including `-o json`, before any
connection or mutation. Errors retain stderr and nonzero exit codes. Notices
remain on stderr. There is currently no `space create` command.

`node create <kind> -q`（或 `--quiet`）仅输出新节点 ID 和换行，适合命令替换。
`worktree create -q` 输出 worktree 路径，因为 Git worktree 没有独立 ID。Quiet 模式与
`--fields`、`-o` 互斥；错误仍写入 stderr 并返回非零退出码。提示仍写入 stderr。
当前没有 `space create` 命令。

A standalone `session run-agent --space <selector>` keeps its session-bound
interact grant, project/Space identity, connection and CLI shims. It creates no
canvas node: OPENCOVE_NODE_ID is absent; whoami reports nodeId: null and context
reports self.nodeId: null and self.node: null. Use explicit --node targets for
node operations and --space for node list/create. Node @self and implicit
node-based placement fail with these options in the recovery hint. Space/project
@self remain available when the session has that scope. Exit, kill and Worker
shutdown revoke the grant; a rejected token never falls back to a profile's admin
credential. Only user authority can start a standalone session. Its grant retains non-runtime
abilities, including notes, but cannot create agent or terminal runtimes. Ask the user to start
an agent on the canvas for runtime delegation.

独立的 `session run-agent --space <selector>` 保留绑定当前 session 的 interact 授权、
project/Space 身份、连接变量及 CLI shims，但不创建画布节点，也不注入 OPENCOVE_NODE_ID。
whoami 的 nodeId 为 null，context 的 self.nodeId 和 self.node 也为 null。节点操作请显式
指定 --node，node list/create 请指定 --space。节点 @self 和依赖节点的默认放置会失败，
并给出这些选项；session 仍可使用已有作用域的 Space/project @self。session 退出、kill 或
Worker 关闭后授权即撤销；token 被拒绝时不会回退到 profile 的 admin 凭据。需要画布节点
绑定和运行时委派时，请让用户在画布上启动 Agent；独立 session 的授权不能创建 Agent 或终端运行时。


Grant runtime creation uses `node create agent|terminal`, with `boundedAgentSpawningV1`
negotiated from authenticated `system.whoami` and `system.capabilities`. Missing support exits 5
before mutation; user bearer launches and non-runtime commands do not require it. The Worker also
enforces policy `s1d-v4` for older clients. Raw grant spawning exits 4 with node-create guidance.
Depth greater than 3 returns `agent.spawn_depth_limit`; six occupied descendants return
`agent.spawn_concurrency_limit`. Both exit 1 with `retryable:false`. Agent and terminal runtimes
share the tree budget across projects and Spaces. Finishing a turn does not release a slot;
a session must exit or be stopped. Human launches, task Run and recovery are exempt.

## Task and note mutations

`task claim` and `task release` return `{revision, node, changed}`. `--fields`
projects task detail fields under `node` and accepts `revision,changed` as envelope
fields. `note append` returns `{revision, nodeId, appendedBytes, totalBytes}`;
`appendedBytes` includes the two-newline separator when the note was nonempty.
All three support `--pretty`, emit newline-terminated JSON and leave stdout empty
on failure. See [task workflows](TASK_WORKFLOWS.md) for limits and recovery rules.
