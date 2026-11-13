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
`agent.wait_unsupported` after creation; the node remains. If no first turn is observed before the
deadline, the CLI exits 124 with the known node/session IDs. Lifecycle telemetry may be unavailable; the agent may still be running or may already have
finished. Inspect the existing session without recreating the node or resending the prompt.
The CLI never follows a replacement session.

Stderr prints `Created agent node <nodeId> (session <sessionId>).` before identification, then
`Waiting for turn <turnId> of node <nodeId>...` with an exact-wait command introduced by
“If interrupted, continue with:”. These progress lines preserve recovery IDs; the final JSON and
exit status report the result.

The result keeps the ordinary create fields (`node.id`, `node.sessionId`, placement and lineage)
and adds `turnId`, `outcome`, `endedAt` and, with `--read`, `reply`. A missing exact reply returns
`reply: null` with `replyUnavailableReason`. Check outcome and reply: exit 0 means the turn ended,
including `failed`, `aborted` or `unknown`; it does not certify task success. `--fields` can select
`id,turnId,outcome,reply.message`, preserving revision, project, space and frame/focus metadata.
`-q` prints only the node ID after the wait completes.

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

未观测到首个回合不代表智能体尚未开始：生命周期遥测可能不可用，智能体可能仍在运行或已经完成。
请用已返回的 sessionId 检查现有会话，不要重新创建节点或重发提示。

创建后的 stderr 进度行先保留 node/session ID，再给出中断时继续等待的命令；请以最终 JSON 和退出码判断结果。

## Launch several agents from a file

First inspect `opencove whoami --tree`. Then prepare `assignments.json`:

```json
[
  { "prompt": "Review the tests", "title": "Tests" },
  { "prompt": "Review the documentation", "title": "Docs" }
]
```

```sh
opencove node create agent --space space-123 --prompts-file ./assignments.json --wait --read --timeout 2m
```

`--prompts-file -` reads stdin. The UTF-8 file must contain 1–10 objects, at most 1 MiB total,
with a nonblank `prompt` and optional string `title`; unknown keys are rejected. All entries and
flags are validated before launching. Every entry uses the same provider launch-prompt policy as
the Worker; session grants also receive the Worker's grant text checks before the first create.
If provider selection uses private Settings (omitted, empty or a legacy provider), batch preflight
checks every possible selectable provider conservatively. Choose `--provider` explicitly for
provider-specific literal text. `--wait` is required. Do not combine it with `--prompt`,
`--prompt-file`, `--title`, `--task`, `--frame`, `-q`, `--fields`, `--focus` or `--limit`.
Target selection, provider, model and Full Access options apply to every entry.

Each create is sent once, sequentially in input order. Its observer starts immediately after the
response, so agents and waits run concurrently. Each entry has its own identification/wait timeout;
there is no overall batch timeout. A failed create does not stop later entries from being attempted.
A lost create response leaves the launch outcome unknown: inspect before taking further action.

JSON and piped output is an array in input order. Each entry has zero-based `index`, input `title`
(or null), `ok`, `exitCode`, and either `result` (the unchanged single-create value) or `error`
(the complete ordinary single-command error envelope, including its `error` key). TTY output shows
one summary per entry, followed by replies and recovery hints. Exit is the first nonzero entry's
exit in input order; always inspect every result. Ctrl-C overrides with 130, stops further dispatch
and observers, and includes unlaunched entries even when interrupted during connection discovery
or target resolution. It never stops agents, rolls back or retries a
creation. Known IDs and exact-turn recovery hints remain available.

An entry that fails a read-only preflight before its create attempt can be `retryable: true`,
exactly as in single-agent creation. After a create attempt, it remains false. Never rerun the
whole batch to recover one entry: other entries may already have launched. Fix the connection
and retry only work known not to have been launched.
中文：只有创建尝试前的只读预检查失败才可能允许重试。不要为恢复单项而重新运行整批命令，
其中其它项可能已启动；修复连接后，只重试明确尚未启动的工作。

中文：委派前先运行 `whoami --tree`。批量文件接受 1–10 个含 `prompt` 和可选 `title` 的对象，
UTF-8 JSON 总量不超过 1 MiB；`-` 从 stdin 读取。必须加 `--wait`，可加 `--read`；全部校验通过后
才开始创建。创建逐项派发，每项只请求一次，等待并发进行，超时独立计算。单项失败不影响后续派发。
输出按输入顺序保留每项的原结果或完整错误；退出码取首个非零项，中断优先返回 130。中断不停止
已创建的智能体，也不回滚或重试；按已返回的 ID 和提示继续查询，不能重新创建或重发提示。

### Windows PowerShell 5.1

Use an explicit UTF-8 file to preserve non-ASCII prompts:

```powershell
@(
  @{ prompt = '检查测试边界'; title = '测试审阅' }
  @{ prompt = 'Review the documentation'; title = 'Docs' }
) | ConvertTo-Json | Set-Content -Encoding UTF8 .\delegations.json
opencove node create agent --space space-123 --prompts-file .\delegations.json --wait --read
```

Windows PowerShell 5.1 writes UTF-8 with a BOM. File and stdin input accept one leading BOM;
the 1 MiB limit includes its bytes. This file pipeline avoids the external-program pipeline's
code-page conversion. Do not use `>` to write the JSON file in Windows PowerShell 5.1; it defaults
to UTF-16LE.

中文：Windows PowerShell 5.1 请通过 `ConvertTo-Json | Set-Content -Encoding UTF8` 写文件，
再使用 `--prompts-file .\delegations.json`。文件和 stdin 均接受一个开头 BOM；大小限制计入 BOM，
Unicode 提示保持原文。不要使用默认输出 UTF-16LE 的 `>` 重定向。

批量创建在第一项派发前使用 Worker 同一套提示策略检查全部输入。provider 来自私有默认设置时，
采用保守检查；需要 provider 专属字面提示时请显式指定 `--provider`。连接发现或目标解析期间
中断也会保留所有已解析的未启动条目。旧 Worker 的 tree 视图在 TTY 上先显示已知配额摘要，
再提示更新；JSON 错误仍保留原计数。

### Preflight failures and terminal text

After input validation, a connection, identity or target-resolution failure returns an ordered
error entry for every input, including those never launched. Each keeps the single-command error
envelope, exit code, recovery hints and retryable flag. Prompt and flag validation failures, and `@self`
used outside an OpenCove terminal, remain global usage errors (exit 2) before launch. Do not rerun the whole batch when any entry has already launched
or its launch outcome is unknown.

TTY summaries, replies and tree rows display terminal and Unicode bidirectional formatting
controls as visible escapes. JSON retains original titles and reply text. Normal right-to-left
letters and emoji joining characters remain readable.

中文：输入校验通过后，连接、身份或目标查找失败也会按输入顺序保留全部未启动条目的原错误。
提示或参数校验失败仍以全局用法错误退出。TTY 将终端及双向格式控制字符显示为转义文本，
JSON 保留标题和回复原文；正常 RTL 字母和 emoji 连接字符不变。
