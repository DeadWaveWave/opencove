# OpenCove CLI

CLI 是 Control Surface client；业务状态由 Worker/application owner 管理。CLI 不直接修改业务数据库。

## Commands

| Group | Commands |
| --- | --- |
| `project` | `list` |
| `space` | `list`, `get` |
| `node` | `list`, `get`, `create note/task/website/agent/terminal`, `update note/task/website`, `delete` |
| `canvas` | `focus node`, `focus space` |
| `api` | `ops`, `schema <operation-id>`, `call <operation-id>` |
| Runtime | `ping`, `status`, `worker start/status/stop`, `runtime inspect/verify/prepare` |
| `endpoint` | `list`, `register`, `ping`, `remove` |
| `mount` | `list`, `create`, `resolve`, `remove` |
| `fs` | `read`, `write`, `stat`, `ls`; 可选 `--mount <id>` |
| `worktree` | `list`, `create`, `archive` |
| `agent` | `list`, `get`, `prompt`, `wait`, `read` |
| Agent guide | `skill` (bundled, offline) |
| `session` | `run-agent`, `get`, `final`, `kill` |
| `pty` | `spawn-in-mount`, `attach` |
| `plugin` | `guide`, `list`, `details`, `install`, `install-git`, `source`, `check`, `update`, `apply`, `rollback`, `discover`, `reload`, `enable`, `disable`, `uninstall`, `run`, `skill`, `open`, `windows` |

旧拼写不提供 aliases。Mount 的项目选项只有 `--project`。
长文本支持 `--content-file`、`--prompt-file`、`--params-file`；文件路径 `-` 读取 stdin。
同一参数的 inline 和 file 形式互斥。`fs write` 保留 UTF-8 文本的空白、换行和空字符串。
`plugin install-git --build-output <path>` 指定构建产物目录。

```sh
opencove fs write --mount mount-123 --uri file:///notes.txt --content-file ./notes.txt
opencove session run-agent --space space-123 --prompt-file ./task.txt
opencove plugin run sample status --params-file ./params.json
```

## Output and exit codes

成功 stdout 是 operation value JSON，不包含 `{ok,value}` 或 transport envelope。
`--pretty` 格式化 JSON；`--fields a,b` 只用于查询；`-o table` 仅支持声明了 columns 的命令。
失败 stdout 为空，非 TTY stderr 为 `{"error":{"code":"...","message":"...","hint":"...","details":...}}`。
TTY stderr 使用可读错误；`-o json` 强制 JSON 错误。
Plugin distribution 返回 `failed`/`conflict` 时 exit 1，candidate 结果位于 `error.details`。

| Exit | Meaning |
| --- | --- |
| 0 | 成功（`worker status` 也可能返回 `status: stopped`） |
| 1 | operation、runtime 或远端进程失败 |
| 2 | 参数错误 |
| 3 | 无可用连接或 endpoint 不可达 |
| 4 | 认证或授权失败 |
| 5 | 协议不兼容 |
| 6 | profile/space 歧义 |
| 124 | 请求、agent wait 或 PTY 握手超时 |
| 130 | 中断（agent wait 关闭流）或 PTY detach |

`pty attach` 是流式例外：stdout 只有原始终端输出，远端退出 0 → CLI 0，其他退出 → CLI 1，Ctrl-C detach → 130。
`worker start` 前台运行，结束后返回状态 JSON。Windows 通过父进程 IPC 请求 Worker 自身完成 drain 和 lock release；超过共享停止预算才强制终止。
`runtime prepare` 从 stdin 接收托管部署 JSON，成功返回 `{"status":"prepared"}`。
默认机器模式将子进程诊断保存在最终 `error.details.diagnostics`（最多 16,384 个 UTF-16 code units，截断时 `diagnosticsTruncated: true`），stderr 仍是单个 JSON 文档。TTY 可显示诊断；`-o json` 禁用隐式诊断输出。
`worker start`、`runtime verify/prepare` 可显式使用 `--stream-progress`：stderr 实时输出原始进度/诊断，失败时追加错误 JSON，因此该模式的 stderr 是流而非单个 JSON 文档。托管 SSH bootstrap 显式使用此模式。

## Connection and context

连接 URL/token：命令行 `--endpoint`/`--token` 优先于 `OPENCOVE_CONTROL_URL`/`OPENCOVE_CONTROL_TOKEN`。
没有 URL 时，`--user-data` 优先于 `OPENCOVE_USER_DATA_DIR`；显式 profile 不回退到其他目录。
未指定 profile 时搜索平台应用数据目录中的 `opencove-dev` 和 `opencove`。
普通命令检查 `control-surface.json` 和 `worker-control-surface.json`，忽略无效/已退出 PID；多个有效连接记录返回歧义错误。
`worker status/stop` 使用本地生命周期模块，仅检查 worker 记录；不接受 `--endpoint`。
Space locator 不推断 cwd：使用 `--space`、`--space-name` 或 `--worker` 与 `--branch`/`--path`，必要时用 `--project` 收窄。

## Help and introspection

`opencove --help` 显示分组及全局选项；`opencove <group> --help` 列子命令；命令级 `--help` 显示参数、示例与全局选项提示，不连接 Worker。
`api ops` 在 OpenCove session 外离线列出 operation；session 内会读取 `whoami` 的 scope；`api schema` 只为有 schema 的 operation 提供输入 JSON Schema。
`api call <operation-id> --input-file request.json` 使用同一验证与连接路径。

开发构建：`pnpm build:cli`；入口为 `node out/cli/opencove.mjs`。

CLI 测试先运行 `pnpm build:cli`，再运行 `pnpm exec vitest run tests/unit/app/cli*.spec.ts`。
测试的 global setup 在系统临时目录重新构建并逐字节校验工作树中的 CLI 产物；产物缺失或过期时拒绝继续，不覆盖工作树，临时构建在成功或失败后都会清理。

## Context state versus session lifecycle

For agent neighbors, `context.nodes[].state` is the Worker run state from
`agent.list`: idle, working, waiting, exited or unknown. Missing run observations
are unknown; lifecycle is never used as readiness evidence. `sessionStatus` keeps
the agent's raw session lifecycle (for example running or exited). Both fields are
projectable, including `--fields nodes.id,nodes.state,nodes.sessionStatus`.
Terminals keep lifecycle in state, tasks keep task status, and other nodes use null.
The live agent.list operation excludes exited sessions; use agent get for a known
exited node's snapshot. Context reports unknown when that run is absent from list.

`node list` keeps its raw contract: `status` is session lifecycle for agents and
terminals, `data.status` is task workflow status. Its table's STATE column shows
one of those raw values. A running session can have an idle agent; use agent
list/get or context's agent state to distinguish working, waiting and idle.

## Agent orchestration and bundled skill

`opencove skill` prints the version-matched SKILL.md bundled in the CLI, without a
Worker connection or source checkout. `-o json` returns `{version, content}`. The
guide covers identity, selectors, the notes/tasks blackboard, prompt recovery,
waiting, reading, etiquette and exit codes. Start there when coordinating agents.

```sh
opencove agent list --space @self -o table
opencove agent get --node "Reviewer" --pretty
opencove agent read --node "Reviewer" --screen
opencove agent prompt --node "Reviewer" --text-file ./assignment.txt
opencove agent wait --node "Reviewer" --until idle --timeout 2m
opencove agent read --node "Reviewer" --turn turn-123
```

Save the `turnId` returned by prompt and replace `turn-123` above. The normal loop
is prompt → wait `--until idle` → read `--turn <turnId>`.

All commands have offline `--help`, examples and declared projectable fields.
Node/Space selectors reuse exact IDs, exact names, unique prefixes and `@self`.
Inside OpenCove, `agent list` defaults to the caller's Space; explicit `--project`
selects project scope. `--state working|waiting|idle|exited|unknown` filters the
Worker's `agent.list`. That operation lists live sessions only, excluding exited
sessions; get/wait can address a known exited node. An unbound/deleted node's title
is null. Final-message reads use the Worker's `agent.finalMessage` query.

| Command | Output contract | Projection / table |
| --- | --- | --- |
| `agent list` | `{epoch, seq, agents: [snapshot + title]}` | Snapshot fields + title; table columns: nodeId, title, provider, state, blockedReason, turn.startedAt, quality |
| `agent get --node <selector>` | Snapshot + title; non-agent nodes or absent run state fail with agent.not_found (exit 1) | Snapshot fields + title; JSON only |
| `agent wait --node <selector> ... --until <condition>` | `{until, mode, agents: [snapshot]}`; turn-end adds endedTurn and endedTurnOutcome | Snapshot fields + endedTurn/endedTurnOutcome; JSON only |
| `agent read --node <selector> [--last] [--turn <turnId>]` | Plain message text; JSON includes `source: hook\|transcript` and `truncated`; exact `--turn` never falls back | Hook: nodeId, sessionId, turnId, promptId, outcome, message, truncated, source; transcript: sessionId, provider, startedAt, cwd, resumeSessionId, message, truncated, source; no table |
| `agent read --node <selector> --screen [--lines <n>]` | Rendered screen text at snapshot cols/rows: cursor spacing and wide cells preserved; trailing spaces/blank rows trimmed, last n rows (default 40); JSON is `{nodeId, sessionId, lines: [...]}` | nodeId, sessionId, lines; no table |
| `skill` | Plain SKILL.md; `-o json` returns `{version, content}` | version, content; no table |

Snapshot fields are `nodeId`, `sessionId`, `provider`, `state`, `blockedReason`,
`turn` (id, startedAt, start), `lastTransitionAt`, `source`, `quality`, `turnOutcome`.
Times are epoch milliseconds. List/get add `title`; wait's `endedTurn` has the same
shape as `turn`. Projection is item-relative and preserves list envelopes.

Wait defaults to `--all` and a 20s overall timeout. The minimum budget is 250ms;
smaller budgets fail with usage exit 2 before any connection or selector lookup. Repeat `--node` to select several
agents; `--any` stops on the first match. For idle/waiting/exited, an already true
baseline counts; unknown or degraded evidence never satisfies idle. `--all` checks
current states together; turn-end remembers each new completion. A turn boundary
can be completed, failed, aborted or unknown: check `endedTurnOutcome` before
claiming success. The latest snapshot's `turnOutcome` remains unchanged.

The Worker owns run state. The CLI only holds cursor-fenced projections: since
`agent.get` has no watermark, it brackets fresh get reads with matching `agent.list`
epoch/seq watermarks, retrying a changing baseline within the overall deadline.
It subscribes to `/events?stream=agent` from that cursor with one nodeId-filtered
stream per node. It resumes each accepted cursor after disconnect and ignores
old/duplicate events. On `resync_required` or epoch change, all streams close and
all nodes re-baseline; turn-end evidence resets because lost history cannot prove
a completion. No persistence, provider inference or prompt retry is added.

After `agent prompt`, use `agent wait --node <selector> --until idle`: already-idle
counts, so a fast completion before wait begins is not missed. `turn-end` remains
available for observing a future turn boundary after the baseline; historical
outcomes never satisfy it. Use it only when observation starts during a running
turn, rather than as the normal post-prompt wait. Timeout exits
124, leaves stdout empty and includes all last known snapshots in stderr's
`error.details.lastKnown` (TTY also prints lastKnown). Ctrl-C exits 130 and closes
streams; neither condition stops the agent. Missing run state is a clear error
with a start/resume hint.

Final-message read tries `agent.finalMessage {nodeId}` first: newest observed ended
turn, including empty/whitespace-only content. `--turn <turnId>` selects the exact
OpenCove ID returned by prompt, never a prefix, another turn or a transcript.
Only a read without `--turn` may fall back to `session.finalMessage {nodeId}`, and
only for `agent.final_message_unavailable` with reason `no_ended_turn` or
`provider_sent_no_message`. All other errors remain errors, including unsupported
operations on an older Worker. Restart/restored conversations can use that
unqualified transcript fallback; they cannot recover exact hook history.

Hook JSON contains `{nodeId, sessionId, turnId, promptId?, outcome, message,
truncated, source: 'hook'}`. Transcript JSON preserves the session fields and adds
`source: 'transcript', truncated: false`. Neither reading nor content proves a
successful outcome. Hook retention is private, in memory, last 8 ended turns per
incarnation, with a 512 KiB aggregate message budget; incarnation replacement or
restart clears history. Currently only correlated local Claude hooks supply it.
Unavailable `details.reason` values are `no_ended_turn`, `provider_sent_no_message`,
`turn_not_ended` (active) and `turn_not_found` (unknown/evicted). Exact reads preserve
these reasons with exit 1; they never silently return an older message.

Plain text remains the default even when piped. A cut hook prefix stays the result
and prints exactly one stderr notice with commands to look for the rest via
`session final --session <sessionId>` (provider transcript) or `agent read --screen`.
Those inspection paths may be incomplete and are not exact-turn substitutes.

Screen mode uses existing `session.get {nodeId}` then
`session.presentationSnapshot {sessionId}`, never terminal input. A small virtual
screen replays cursor movement, CR/LF/BS/TAB and line/display erase at the snapshot
geometry, with two cells for wide CJK/emoji. It selects the declared normal or
alternate buffer; SGR, OSC/hyperlinks and unrelated modes are ignored. Output
contains only the rendered viewport rows, with trailing spaces and blank rows
removed, then the requested last n rows. `--lines` requires
`--screen` and a positive whole number; `--screen` conflicts with `--last` and `--turn`.
`--last` can accompany `--turn` and does not loosen exact selection. `--fields`
selects structured JSON, as does `-o json`.
`session.transcript_not_ready` queries agent.get: only working agents are advised
to wait for idle. An idle agent with a completed turn is told that its provider has
not written a readable transcript (for example transcript saving disabled), with
`agent read --screen` as the inspection path and no wait recommendation. Other
states get screen/provider-setting guidance. Not-found asks you to check the node
and start/resume its session.
Transcript fallback and `session final --session <id>` reject null, empty or
whitespace-only final messages with `session.transcript_not_ready`, exit 1 and the
same state-aware recovery. The server normalizes blank replies to null and supplies
no separate empty-reply marker, so a genuine empty reply cannot be distinguished.
Nonblank replies keep the existing text/JSON output forms.
Reading can cache a discovered transcript identity under the existing server
contract. Prompt admission and uncertainty rules are unchanged: never resend
after stalled/interrupted or transport-unknown delivery. See
[Prompt delivery](../agent/PROMPT_DELIVERY.md).

Wait uses the condition-wait pattern documented by
[Kubernetes](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_wait/)
and UTF-8, multiline-data, comment and newline framing from the
[HTML SSE standard](https://html.spec.whatwg.org/multipage/server-sent-events.html),
adapted to OpenCove's explicit epoch/seq query cursors and bearer authentication.
Fake-stream unit tests exercise these invariants without opening local listeners.

## 1.1 安装拓扑

`runtime inspect` 只读取构建描述，`runtime verify` 在独立进程内验证执行环境；它们不会启动
Worker 或创建用户 profile。`runtime prepare` 把经过校验的托管部署请求交给独立 runtime
controller。controller 拥有安装/激活元数据，通过 Worker 的维护协议管理生命周期，并由
persistence 基础设施生成一致快照；普通业务 CLI 仍只能通过 Control Surface 访问业务状态。
详细所有权和恢复规则见 [Managed SSH runtime](../runtime/MANAGED_SSH_RUNTIME.md)。

OpenCove 目前支持两条正式的 CLI 安装链路：

- **Desktop 内置安装**：用户在 Desktop 的 **Settings → Worker → CLI** 中点击 **Install CLI**，由已安装的 app 写入 `opencove` launcher（Windows 为 `opencove.cmd`）。
- **Standalone server 安装**：用户从包含 standalone installer 与 runtime bundle 的 GitHub Release 下载资产，并通过 release 专属 `opencove-install-v<tag>.sh` / `opencove-install-v<tag>.ps1` 写入同语义的 `opencove` launcher。stable release 额外提供 `opencove-install.sh` / `opencove-install.ps1` 作为 latest stable 别名。

当前约束：

- Desktop 安装与 standalone 安装最终都生成 runtime-backed launcher。
- Desktop launcher 使用已安装的 Electron runtime；standalone launcher 只使用 bundle 内的纯
  Node runtime，不得加载或回退到 Electron。
- standalone bundle 内的 `better-sqlite3` 与 `node-pty` 必须按所附 Node runtime 的 module
  ABI 单独构建，并在归档前由该 Node runtime 真实加载验证。
- 打包态 launcher 必须指向发布 runtime 内的 CLI entrypoint，不能依赖 repo checkout 路径。
- launcher 会记录安装 owner；两条安装链可以互相覆盖安装，但卸载时只移除自己拥有的 launcher。
- standalone release 覆盖 macOS / Linux / Windows；Windows 资产格式为 `opencove-server-windows-<arch>.zip`。
- standalone launcher 必须从 bundle 内 `package.json` 读取版本并通过 `--app-version` 传给 Worker；缺失或非法版本必须拒绝启动，不能产生身份不明的 Remote Worker。
- 公开 installer 必须从同一 release 路径读取 `SHA256SUMS.txt` 并在解压前校验 bundle；缺失 checksum、缺少本机 SHA256 工具或 hash 不一致都必须 fail closed。
- stable release 同时发布 tag-pinned installer/uninstaller 和 `latest` 通用别名；nightly 只发布 tag-pinned 版本。Managed SSH 必须按 Desktop 当前版本使用 tag-pinned installer，不能把 `latest` 当作版本一致性保证。

若 latest stable 已包含 standalone installer assets，则可使用以下通用安装命令
（macOS / Linux）：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh | sh
```

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.ps1 | Invoke-Expression"
```

如果 `releases/latest/download/opencove-install.sh` 返回 `404`，说明 latest stable
尚未发布 standalone installer；此时应改用 Desktop 安装，或等待包含这些资产的
release。

安装 nightly 或任意指定 tag 的 release 时，应改用该 release 页面中的带版本脚本：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.ps1 | Invoke-Expression"
```

当 latest stable 已包含 uninstall assets 时，可使用以下命令卸载 standalone
runtime：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.ps1 | Invoke-Expression"
```

指定 nightly 或任意指定 tag 时，应使用对应的版本化 uninstall 脚本：

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-uninstall-v<version>.ps1 | Invoke-Expression"
```

无 Desktop 的 server 场景可直接启动 worker + Web UI：

```bash
opencove worker start --hostname 0.0.0.0 --web-ui-password 'change-me'
```

当 Web UI 暴露到 localhost 之外时，必须设置密码或等价安全门禁。

相关文档：[Agent playbook](AGENT_PLAYBOOK.md)、[Canvas node control](CANVAS_NODE_CONTROL.md)、[Managed SSH runtime](../runtime/MANAGED_SSH_RUNTIME.md)。

## Canvas 终端身份

Hosting Worker 在 canvas PTY spawn 时注入 `OPENCOVE_ENV=1`、`OPENCOVE_NODE_ID`、
`OPENCOVE_SPACE_ID`、`OPENCOVE_PROJECT_ID`、`OPENCOVE_CONTROL_URL`、session-scoped
`OPENCOVE_CONTROL_TOKEN` 和 `OPENCOVE_CLI`；PTY host 分配实际 session ID 后注入
`OPENCOVE_SESSION_ID`。不属于 Space 的节点使用空 `OPENCOVE_SPACE_ID`。Worker 全权限
bearer 不进入该环境，调用者提供的身份/控制环境变量会被覆盖。

现有 shim directory 提供 `opencove`（POSIX sh）和 `opencove.cmd`，并被放在 PATH 首部。
Launcher 使用本 Worker 的 runtime executable；CLI 从环境读取 endpoint/token，显式 CLI
flags 优先。`OPENCOVE_CLI` 指向构建产物 `out/cli/opencove.mjs`。

`node.create` 和 UI 创建流程在 spawn 前预留 node ID；Worker 校验已有节点的所属记录，
恢复使用 Worker 保存的身份。远端由实际 hosting Worker 签发 grant。凭证在 spawn 注册完成后
激活，失败、退出、kill、hosting Worker shutdown 时失效。`system.whoami` 返回 caller identity、
scopeTier、instanceId 和 appVersion，不返回 token/hash。

Windows 直接以 `wsl.exe` 启动 canvas PTY 暂时明确拒绝 scoped identity：Windows shim 路径与
loopback URL 不能保证在 WSL 中可用。应在 WSL 内运行 hosting Worker，并通过 mount 使用它。


## Selector diagnostics and bounded output

Use `--space <selector>` with any `--node` selector to resolve a node name or
unique ID prefix within that space. Explicit `--space` also validates full IDs
and `@self`; a node outside that space fails with `node.not_found`, naming the
actual and selected spaces. Drop `--space` to address full IDs across spaces. An
explicitly selected project continues to constrain IDs. Names remain case-sensitive,
and ambiguity always fails without choosing a target. For example:

```sh
opencove node get --node "Progress" --space "Main" --fields id,data.text
opencove node update note --node "Progress" --space "Main" --text "Ready for review"
opencove node delete --node "Progress" --space "Main"
```

Ambiguous node candidates include `spaceId` and `spaceName`. Note candidates also
include a single-line `preview`, limited to 60 characters including an ellipsis
when cut. Full note content is read only for the displayed ambiguity candidates.
Missing selectors report the project and optional space searched, suggest up to
three names within case-insensitive edit distance 2, and identify known IDs of a
different kind. Suggestions never resolve selectors automatically.

`--limit <n>` accepts a non-negative safe integer and caps each top-level output
list after filtering and field projection. It does not limit selector lookup or
change the operation sent to the Worker. Omit it or use `--limit 0` for complete
output. A cut object-shaped list preserves its envelope and adds totals, for example:

```json
{"activeProjectId":"p","projects":[{"id":"p"}],"truncated":{"projects":4}}
```

Bare-array outputs such as `api ops` always remain arrays, including when cut. A
cut array writes one stderr notice, for example `Showing 20 of 145 operations;
use --limit 0 for all.` Object-shaped lists keep top-level `truncated` totals.
Tables cap rows, use uppercase headers, and report truncation with one stderr
notice, for example `Showing 1 of 5 nodes; use --limit 0 for all.` JSON object
lists keep their top-level totals.
Nested node data (for example tags) is not truncated. Server-side filesystem read bounds remain separate and do not
provide a total beyond the entries returned by the Worker.

`space list` keeps IDs, directoryPath, nodeIds and nodeCount but omits full node
objects by default. Request them explicitly with `--fields nodes`, or select
nested fields with `--fields id,name,nodes.id`. These compact queries remain useful
for finding a space and checking its membership:

```sh
opencove space list --project "@self" --limit 10 --fields id,name,directoryPath,nodeCount
opencove node list --space "Main" --limit 10 --fields id,kind,title
```

`context.space.directoryPath` uses the same spelling as `space get` and `space list`.
Node content paths are `data.text` for notes; `data.requirement`, `data.status`,
`data.priority`, `data.tags` for tasks; `data.url` for websites; and top-level
`status` / `sessionId` for agents and terminals. `node list` returns summaries;
read full note text with `node get`. If a declared projectable field is absent on
a returned node kind, the CLI writes one notice to stderr and leaves stdout as
projected JSON. Empty note text is a present value and does not trigger a notice.

File URI inputs require an absolute `file://` URI, including with `--mount`.
Errors give an example built from the input when possible; relative examples use
`/path/to/project` as a placeholder, never the CLI cwd. Find the target's real root:

```sh
opencove mount list --project "@self" --fields mountId,rootUri
opencove fs read --uri file:///workspace/README.md
```

Unknown `api schema` / `api call` IDs suggest nearby IDs and a domain catalog query.
Catalog rows expose `cliCommand` (when a dedicated command exists) and `scope`
(`read`, `interact`, `admin`). Inside OpenCove they also expose `allowed`, computed
from the authenticated `whoami` scope. This describes the scope boundary; other
operation preconditions and resource permissions still apply on the Worker.
Outside OpenCove, `allowed` is omitted and no connection is needed. Domain summaries
use `commandOperations` for the number of command-kind operations.

```sh
opencove api ops --domains --fields domain,operations,commandOperations
opencove api ops --prefix node --fields id,cliCommand,scope,allowed --limit 10
```
