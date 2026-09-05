# Recovery Model

本文档定义 OpenCove 当前恢复语义：哪些状态是 durable truth，哪些只是 runtime observation 或 UI projection，以及启动、关闭、恢复时谁有写权。

## State Classes

用户意图：

- 新开 Agent 或 Terminal。
- 恢复某个 session。
- 关闭窗口或节点。
- 为 task 绑定 Agent。

Durable fact：

- Workspace、Space、Node、Viewport layout。
- Space tree、Space archive records 和 Space execution boundary。
- Task 字段和 task-agent 关系。
- Agent/Terminal 可恢复 metadata。
- Agent/Terminal node-owned Worker binding（`endpointId + mountId`）。
- Terminal recovery generation、runtime binding、presentation checkpoint 与 bounded raw tail。
- Settings，包括 Home Worker Web access intent。
- Endpoint/mount registry。

Runtime observation：

- PTY alive/exited。
- watcher 观察到的外部 session 文件变化。
- CLI 当前 probe 到的 model 或 provider availability。
- remote endpoint 当前是否可达。
- Managed SSH operation identity、forward revision 与安装/连接阶段（不持久化）。
- 当前 Web listener/auth generation 与连接数量。

UI projection：

- running / standby / failed badge。
- selection、hover、focus。
- 临时恢复提示、loading shell、recovering overlay。

## Current Recovery Path

Desktop 正常启动要求 Home Worker endpoint 可用。冷启动 runtime 恢复通过 worker `session.prepareOrRevive` contract：

```text
SQLite durable state
  -> renderer hydration requests prepare/revive
  -> Worker reads terminal_recovery_records as the durable hydration baseline
  -> Worker resolves/revives a runtime or validates a durable remote route
  -> renderer mounts nodes from worker result
  -> terminal clients attach through presentation snapshot + stream
```

Worker 在发布 connection file 前扫描 persisted workspace runtime nodes。命中的 workspace 保持
`initializing`，普通 spawn 返回 `terminal.runtime_not_ready`；只有 `session.prepareOrRevive`
拥有当前恢复批次的内部 spawn scope。同一 workspace 的并发恢复操作加入同一批次，
每个 scope 仅在自己的操作存续期间有效。全部操作结束后进入 `ready` 并递增 epoch；
批次中有未处理的失败则进入 `unavailable`。shutdown/旧批次的迟到完成不能重新打开准入。

Renderer 按节点请求恢复，最多同时发出四个请求，并立即应用每个已完成结果；一个节点的
超时不能丢弃其他节点的结果。Worker 对同一 workspace/node 的并发准备请求共享正在执行
的操作，避免重复 spawn。界面卸载后停止提交结果和启动排队请求。

占位节点的空 `sessionId` 只表示尚未验证、不能输入。Renderer 用临时
`runtimeSessionBinding` 的 `preparing` 阶段保留上次 durable binding，持久化和同步不能把
等待验证解释为解绑。Worker preparation 结果进入 `publishing` 阶段：绑定及其 runtime
projection 在对应共享快照确认前保持一致，旧快照不能覆盖它。同步刷新串行执行；本地写入
成功也触发一次确认读取，确认后才允许后续共享 runtime 切换。传输失败仍保留 preparing 绑定。
迟到结果不能覆盖用户已经切换到的新 runtime。

Renderer 不拥有恢复判定。它消费 worker result，展示 placeholder/recovering UI，并在 session attach 后渲染 worker-owned output。

## Invariants

1. 恢复判定依赖 durable fact，不依赖 watcher 偶然观察。
2. Watcher 只能上报 observation，不能直接清空 resumable truth。
3. 关闭、fallback、late async completion 不得重写别的 owner 的 durable fact。
4. Agent/Terminal runtime attach 失败不得把业务节点降级成另一种节点。
5. Renderer cache 可用于 UX placeholder，但不能成为恢复正确性来源。
6. 只有当前 `generation + binding + checkpointRevision` 能推进 Terminal durable state；旧 runtime 的 late write 必须被拒绝。
7. Worker 退出必须先冻结 client command ingress，排空完整的 per-session command queue；在 runtime
   output 仍可进入 owner 时完成第一次 flush，再排空/停止 presentation reset 并建立
   runtime-event cutoff，最后做第二次 flush，才能关闭 transport/runtime/persistence。
8. 新建 shell 是新的 runtime epoch；旧 history 可以保留，但不能把新 prompt 写进旧 alternate screen 并伪装成 TUI continuation。
9. Remote route 暂时不可观测不是 runtime 已被替换的证据；只有完整观察或明确 replacement 才能 retire
   durable binding。
10. Persisted runtime reconciliation 完成前，普通 terminal/agent spawn 不得创建新 PTY；只有当前
    `session.prepareOrRevive` 恢复批次内仍在执行的内部 scope 可以启动恢复所需 runtime。
11. Node-owned Worker binding 优先于 Space mount 推导；只有旧数据缺少 binding 时才允许使用
    Space fallback。无法解析 remote binding 时必须 fail closed 为 `fallback_terminal` +
    `remote_worker_unavailable`，不得把 remote cwd 交给 Home Worker。
12. Web listener/auth generation 不是 terminal restart source；Web access apply、rollback、drain 或
    revocation 都不得运行 Worker terminal shutdown/recovery sequence。

## Ownership Table

| State | Class | Owner | Write entry | Restart source |
| --- | --- | --- | --- | --- |
| workspace list / active workspace | durable fact | workspace persistence/usecase | workspace mutation | SQLite |
| spaces / node layout / viewport | durable fact | workspace context | workspace mutation | SQLite |
| `parentSpaceId` | durable fact | workspace context | space tree mutation | SQLite |
| `targetMountId` | durable fact | workspace/space model | space/mount binding mutation | SQLite + topology |
| Agent/Terminal Worker binding | durable fact | workspace node model | launch/prepare result | SQLite `nodes.worker_binding_json` + topology |
| space archive records | durable fact | workspace context | archive usecase | SQLite |
| Managed SSH operation | runtime state | topology application operation owner | accepted prepare/repair + fenced phase/settlement | none; new prepare probes remote truth |
| Endpoint overview/progress | UI projection | renderer endpoint overview projection owner | accepted overview + serialized queries | query Worker again |
| endpoint/mount registry | durable fact | topology store | endpoint/mount commands | topology files |
| Home Worker Web access intent | durable fact | serialized Home Worker config store | live Worker owner; Main only while Worker absent | `home-worker.json` |
| Web listener/auth generation | runtime state | Worker Web access runtime | serialized apply/revoke | durable Web access intent |
| task fields | durable fact | task/workspace model | task mutation | SQLite |
| task-agent relation | durable fact | task/agent usecase | launch/bind/close mutation | SQLite |
| agent session metadata | durable fact | agent/session owner | launch/resume/prepare | SQLite |
| terminal session metadata | durable fact | terminal/session owner | spawn/prepare/kill | SQLite/runtime registry |
| terminal recovery generation/binding | durable fact | Worker terminal recovery owner | binding reconcile | `terminal_recovery_records` |
| terminal presentation checkpoint/raw tail | durable fact | Worker terminal recovery owner | PTY output checkpoint + shutdown flush | `terminal_recovery_records` |
| legacy terminal scrollback mirror | compatibility projection | Worker terminal recovery repository | atomic checkpoint mirror | `node_scrollback` |
| terminal presentation snapshot | runtime state | Worker stream hub | PTY output reduction | Worker runtime |
| PTY alive/exited | runtime observation | Worker runtime | PTY callbacks | none |
| provider availability | runtime observation | agent executable resolver | host diagnostics query/probe | recompute |
| node badge | UI projection | renderer | derived only | derived |

## Boundary Rules

Launch:

- Must persist durable intent before relying on external CLI/session files.
- Agent and Terminal launch create runtime through session/PTY owners, not by directly editing node data.

Prepare/revive:

- Reads durable metadata.
- Resolves a node-owned Worker binding before consulting its owning Space. Binding-absent legacy
  nodes retain the Space-derived compatibility path.
- An unresolved remote endpoint/mount reports `fallback_terminal` with
  `remote_worker_unavailable`; recovery does not create a local PTY.
- Attempts worker-owned runtime restore.
- Reports structured failure without mutating durable truth unless the owning usecase explicitly records status.

Watcher/metadata:

- May verify or enrich binding through an owner usecase.
- Must not directly edit renderer store or clear session binding.

Close/delete:

- Node deletion removes durable node and space membership.
- Runtime cleanup is best-effort and must not block durable removal forever.
- Forget/archive semantics must be explicit.
- Space archive must calculate a target subtree first, then remove only those Spaces and nodes from durable state.
- Worktree / branch cleanup during archive is an explicit per-worktree user choice and must not be inferred from visual containment.

## Managed SSH Recovery

关闭 Settings/Picker 或丢失单次 HTTP 响应不取消 Worker-owned preparation。更新、删除和 shutdown
先同步 fence operation generation，再 abort 本地 SSH child；旧 reporter、probe、exit 或 completion
不能发布进度、恢复隧道或复活已删除记录。更新/删除期间的准入保护一直覆盖到 topology mutation
完成，不只覆盖 child 退出前的一段时间。

Local abort 不承诺终止远端 shell/installer。Worker 重启后 operation/revision 不恢复；下一次显式
prepare 从 durable endpoint/access 重新 probe，以幂等 bootstrap 收敛已经成功或仍在执行的远端
安装。Renderer 只能重试观察，不能用 transport timeout 推断安装失败或自动重跑安装。

## Terminal Recovery

Terminal visual recovery has one durable owner: the Worker terminal recovery pipeline. SQLite schema
v11 stores one `terminal_recovery_records` row per terminal node:

- `generation` fences replaced sessions and routes.
- `binding_json` + `runtime_epoch` bind the row to one local or remote runtime epoch.
- `checkpoint_revision` + `applied_seq` order serialized presentation checkpoints；remote checkpoint
  还把对应的 downstream replay cursor 写入同一个 envelope。
- `presentation_json` stores the current canonical screen plus bounded `archivedEpochs` static
  previews and `historyTruncated`; old alternate screens are archived as normal-buffer previews.
- `raw_tail` + `raw_truncated` are bounded, epoch-local compatibility/fallback bytes; `checksum`
  covers the archive envelope, current checkpoint and raw tail.

The repository commits archive envelope, checkpoint and raw tail in one immediate transaction. It
mirrors a composed `archived static previews + current serialized checkpoint` stream into
`node_scrollback` for legacy readers; app-state/renderer scrollback publishing must not overwrite a
Worker-owned mirror. A generation, binding or checkpoint CAS failure is fail-closed; the stale
writer cannot replace the newer record.

Live visual recovery uses:

```text
terminal_recovery_records -> prepare/revive durable baseline
live runtime -> session.presentationSnapshot
  -> renderer epoch-aware hydrate
  -> attach(afterSeq)
```

The Worker presentation session owns the live serialized screen, applied sequence, runtime epoch and
presentation revision. Output and any actual geometry presentation change mark the recovery owner
dirty; checkpoints are trailing-debounced. The presentation port synchronously fences the accepted
output boundary after any presentation-transition wait, then invokes the mutation-boundary callback
before capture yields. That callback pairs raw fallback with the same screen/cursor boundary. A
scheduled checkpoint commits one bounded batch and re-debounces later dirtiness; explicit
flush/retire drains to its cutoff, so continuous output neither mixes revisions nor creates a tight
SQLite write loop.

Fresh bindings checkpoint immediately. A surviving remote route rebinds with
`checkpointOnBind=false` so an empty new Home presentation cannot overwrite the durable preview
before replay arrives. Session replacement/removal/exit goes through one retire operation: stop
accepting output, drain or join the per-session in-flight commit, then forget the state. A degraded
retire keeps ingress closed, schedules one delayed single-flight retry and blocks generation
replacement until the final checkpoint is durable.

Shutdown ordering is:

```text
freeze client ingress
  -> drain complete per-session command queues
  -> start flush while runtime output is still observed (do not await the dirty drain yet)
  -> drain/stop presentation-reset lifecycles and re-drain session queues
  -> detach runtime listeners (runtime-event cutoff)
  -> await the in-flight flush -> flush post-cutoff dirtiness again
  -> close stream/runtime -> close persistence
```

Cold shell replacement increments the generation/runtime epoch. Reserve atomically archives the old
checkpoint and clears current-epoch checkpoint/raw state. Hydration composes every retained static
preview with the latest presentation and explicitly crosses epoch boundaries. An archived alternate
screen is converted to an inert normal-buffer preview, followed by alternate-buffer exit, xterm
DECSTR and explicit mode resets before the next epoch. The archive budget is strict across complete
persisted ANSI epoch envelopes: it evicts whole oldest envelopes, and omits a single oversized
envelope instead of slicing through an escape sequence.

Remote recovery separates transport locality from durable runtime identity:

- `homeWorkerInstanceId` only records the current Home transport location. A Home restart may refresh
  it on the same generation and runtime epoch.
- Durable remote epoch equality is fenced by `endpointId + remoteSessionId +
  targetWorkerInstanceId`; a target-instance mismatch cannot silently attach to a different Worker.
- A transient route lookup failure adds the active node to the preserve set. It does not retire the
  binding or open a replacement generation.

For a surviving remote PTY, the durable checkpoint stores the current-only serialized presentation
and its `downstreamReplayCursor` together under the same checkpoint CAS/SQLite transaction. The
archived display prefix is injected only into the renderer-facing presentation snapshot; it is
excluded from recovery snapshots and raw tail, so later checkpoints cannot archive the same prefix
again. A legacy checkpoint without a valid downstream cursor is not merged with replay: recovery
clears the uncorrelated baseline/raw fallback and rebuilds from the Remote Hub's available history.

Remote replay overflow is a per-session single-flight resync. The Home keeps its public downstream
cursor unchanged, buffers data/exit events while fetching and applying the authoritative Remote Hub
presentation snapshot, then replaces only the current presentation and establishes a new local replay
fence. After reset commit, it publishes the snapshot cursor, sorts buffered events, drops sequences
covered by the snapshot/current cursor, and emits the remaining data and first exit once. If reset
fails, it discards the buffer and reconnects from the unchanged public cursor so replay or another
snapshot resync can close the gap. Home clients behind the replacement baseline, including
cursorless attaches after a reset, receive overflow instead of an unsafe delta.

If recovery finds that a remote session already exited, it requires an authoritative presentation
snapshot, commits that final frame on the existing generation, and does not reattach it as live. Only
after that same-generation checkpoint is durable may normal reconciliation reserve a replacement
generation and archive the final frame. If the authoritative snapshot is unavailable, recovery throws
and `prepareOrRevive` does not fall through to destructive replacement. A still-running remote session
may use a valid durable downstream cursor as a replay fallback; an exited session cannot reconstruct
its final screen that way.

Renderer cache, hot workspace-switch screen cache and placeholder data are local UX aids only. Agent
session recovery remains provider/CLI-owned; terminal recovery storage must not manufacture provider
conversation history.

## Verification Anchors

- `tests/integration/recovery/useHydrateAppState.workerPrepare.spec.tsx`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionPrepareOrRevive.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionPrepareOrRevive.parallel.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.terminalRecovery.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.remoteTerminalRecovery.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.nodeWorkerBindingRecovery.spec.ts`
- `tests/contract/controlSurface/remotePtyOverflowRecovery.loopback.spec.ts`
- `tests/contract/platform/terminalRecovery.multiEpoch.spec.ts`
- `tests/unit/terminalRecovery/`
- Terminal presentation contract and multi-client control surface tests.

The SQLite recovery contracts load `better-sqlite3` with Electron's native ABI. Run
`pnpm test:terminal-recovery:native`; ordinary Node Vitest intentionally skips those suites, and CI
runs the native gate separately.
