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

## Pi Conversation Identity

Pi 的 invocation lifetime 与 conversation lifetime 不同：`/new`、resume、fork 会在同一进程内
更换会话。经过 launch token、PID、单调 sequence/conversation revision 验证的 native snapshot
才有权推进绑定；Claude/Codex 的 immutable identity 与 explicit-resume fence 不变。

已分配的 ID/路径不是可恢复证据。只有确认落盘的当前 transcript 才建立 verified resume path；
文件缺失、传输失败、extension shutdown 和 PTY exit 均不得清空它。明确切换至尚未落盘的新会话，
或进入 ephemeral mode，会撤销旧绑定，避免冷恢复悄悄续旧会话。旧 JSONL watcher 和旧 replay
不得覆盖当前 native binding；完整快照和 invocation completion 使用各自的排序屏障。

Pi sequence、PID、conversation revision、运行状态和 watcher 都是 runtime-only。SQLite 仍只保存
现有 Agent/Terminal binding，不增加另一份运行态恢复源；旧数据缺少 native 字段时继续按现有
verified-binding 规则恢复。

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

Worker 在发布 connection file 前扫描 persisted workspace runtime nodes。启动扫描成功后即可
创建独立的新终端和 Agent；旧节点的恢复等待或失败不影响创建准入。`TerminalRuntimeAvailability`
分别管理基础启动准入与 `recoverySnapshot`，Renderer 不以恢复完成数量推断创建权限。
同一 workspace 的并发恢复操作加入同一批次，每个内部 spawn scope 仅在自己的操作存续期间有效。
全部操作结束后恢复状态进入 `ready` 并递增 recovery epoch；批次中有未处理的失败则恢复状态进入
`unavailable`。这些状态只描述旧节点的恢复结果，不改变已就绪 Worker 的基础创建能力。
启动扫描未完成或失败时普通 spawn 仍返回 `terminal.runtime_not_ready`；扫描失败后的显式恢复
只可重新开放该 workspace 的准入，不能开放无 workspace 的创建或其他 workspace。
shutdown 关闭所有准入，旧批次的迟到完成不能重新打开它。

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
10. 基础启动准入成功后，普通 terminal/agent spawn 不得依赖旧节点恢复完成。扫描失败后的
    恢复例外仅属于当前 workspace 的有效 scope；shutdown 和迟到结果不得重新开放准入。
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

远端 runtime 的安装、维护准入、数据快照和切换记录由独立的 deployment controller 管理，
见 [Managed SSH runtime](../runtime/MANAGED_SSH_RUNTIME.md)。一个 profile 同时只有一个活动写入
owner；candidate 在 active 提交前关闭业务准入。有存活终端/Agent 时延期，不以 UI 在线人数
判断空闲。旧客户端不得自动降级已经提交的新 runtime 或数据 schema。

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

## Local Worker persistence ownership

- I1：一个 userData 最多只有一个 Worker 持有 persistence 写入权。Worker 在任何
  userData 状态写入前获取 `opencove-worker-owner.lock.db` 的 SQLite EXCLUSIVE 锁；
  连接保持打开直到 persistence 关闭，进程死亡由内核释放锁。
- I2：只有 owner 释放自己的锁。永久锁数据库不得删除；`opencove-worker.lock`
  仅是 discovery/upgrade metadata，包含 PID 和每次启动的 `instanceId`。
  release 仅在两者仍匹配时删除 metadata，且在删除完成后才关闭内核锁。
- I3：Desktop 不杀死、遗弃或替换不归自己持有的 Worker。外部 owner 不可达或不兼容时
  返回 `worker.external_owner_unreachable`，不以健康检查失败推断死亡。

| State | Class | Owner | Write entry | Restart source |
| --- | --- | --- | --- | --- |
| Worker exclusive lease | runtime state | holding process / SQLite kernel lock | acquire / connection close | reacquire kernel lock |
| PID + instanceId | discovery metadata | lease holder | startup / matching release | not authoritative |
| connection file | discovery metadata | Worker | publish / shutdown; Desktop only cleans confirmed dead PID under lease | re-probe live owner |

Desktop repair（包括没有传入 PID 的恢复分支）持有同一 lease 后重新读取 metadata，
仅确认 connection PID 死亡才删除 connection，从不删除锁文件。Desktop 在未持有子进程
handle 时不根据 `startedBy=desktop` 宣称生命周期所有权。

持有 kernel lease 后，新格式（含 instanceId）metadata 可确认已过期，不受 PID 复用影响。
升级期间，legacy PID 必须经进程身份验证；明确不相关的进程不阻止接管。
取得真实 argv 时，以 realpath 和目录文件系统 identity 比较 userData；相对路径只使用被检查
进程的 cwd。只有展平的命令行时，可能的 Worker 返回 unknown，不以路径文本不等排除 owner。
无法检查进程身份（包括权限不足）时保守拒绝；不能将未知身份视为死亡。旧版进程不理解
内核 lease，因此旧版并发启动/清理仍有残余竞争；升级时应先停止旧版。metadata 的
compare-then-delete 不能与旧版写入实现原子互斥。Windows 文件锁行为需要 Windows CI
验证；网络文件系统不保证本地 SQLite VFS 的锁语义，userData 应放在本地文件系统。

回归：`tests/integration/worker/workerOwnerLock.spec.ts`、
`tests/unit/app/worker.singleInstanceLock.spec.ts`、
`tests/unit/app/localWorkerManager.connectionFile.spec.ts`。

## Agent runtime state

The executing Worker owns agent run-state decisions and turns. Durable `node.status` remains a UI
projection and does not restore runtime authority. See [Agent run state](../agent/RUN_STATE.md) for
incarnation fences, unknown/degraded semantics, turn completion and event recovery.

### Session grant lifetime

Session grant credentials belong to the Worker hosting the PTY, not to the Home transport.
The PTY host cleans up sessions on parent disconnect and shutdown; cold recovery creates a new
runtime epoch. Consequently local grants must not be restored merely from terminal presentation
checkpoints. A Home restart that reconnects to a surviving remote Worker must preserve that remote
Worker's grant ownership; a hosting Worker restart starts with no grants.

The grant registry is memory-only, owned by the hosting Worker's local PTY wrapper. It tracks
successful runtime registrations and revokes on exit, kill and shutdown. A failed/pending spawn
reservation cannot authenticate, and late completion cannot reactivate a disposed owner. No grant
persistence schema is introduced. Cold revival creates a new credential for the persisted node ID;
reattaching a live remote session preserves the hosting Worker's existing credential. A grant must
never be revived from a renderer cache.

## Managed Claude resume binding storage

Managed Claude 的 Worker-owned tuple 存在 `managed_claude_resume_bindings`，`nodes.agent_json`
只保存受最终 writer 保护的投影。绑定、节点与 revision 原子提交，真实删除留下 retirement，
普通快照不能回退 tuple 或改变其 kind/provider/route。内部 lifecycle API 已接入开发开关保护的启动路径；
现有无 ledger row 的节点保持原恢复行为。此存储层不判定 transcript qualification，也不恢复
runtime authority。详见 [Persistence](PERSISTENCE.md#managed-claude-resume-ledger存储契约尚未启用生产接入)。

### Managed launch admission

`ManagedClaudeLaunchOwner` 在 Worker 内按 Agent node ID 管理进程内 attempt；token 不持久化，
也不接受客户端 token。普通恢复选择 ledger 的 committed tuple，显式替换必须携带匹配的
expectation。首次 adoption 与 replacement 都在同步 activation 前复查 kind/provider/route/目录。
所有 owned fallback 先确认保持 tuple 的 null-runtime settlement；shell 不获得 managed 写权。
Fallback receipt 保留本次 attempt 已确认 settlement 的 exact commit revision，即使后续读到了更新的
app revision。预存 settlement、row-only 写入和 `alreadyApplied` 只提供 observation，不能声称新的 app commit。
删除只在最外层 app-state commit 后 fence attempt 并检查精确 runtime 的 references。
unknown outcome 保留 runtime 与 reconciliation obligation，未到 clean transaction boundary 时
不能确认成功、重启或补偿。Worker 重启不重建旧 token。

新 adoption 默认关闭，仅 `OPENCOVE_EXPERIMENTAL_MANAGED_CLAUDE_BINDINGS=1` 用于开发验收；
`managedClaudeResumeBindingV1` capability 保持 false。已有 row 的保护不受开关影响。
同步投影、缓存修正与正式启用仍由后续同步接入完成。


`node.managedClaudeBinding` 在 node 尚未持久化时也返回 definitive ledger observation，
明确区分 absence、row-only ownership 和 retirement；`node.get` 的 not-found 不代表 unowned。
已由 ready store 确认 owned 的启动在 reserve 时登记等待，identity read 尚未完成也不能重连旧 runtime。
Unowned 启动先保留 candidate attempt，确认 local managed execution 后才启用等待、token fence 和
managed error 语义；跨目录 unowned switch 沿用 legacy 路径且不 adoption，owned replacement 仍拒绝目录变更。
Remote execution 保留 legacy guards/retry，已有 owned row 仍拒绝 remote replacement。
旧 Worker 不支持 ownership query 时，只有 runtime registry 明确缺少该 operation 才沿用 legacy；
operation 已注册但读取失败时仍拒绝操作，不能把 persistence failure 当作无主。
Owned fallback shell 的 node runtime 与 null ledger runtime 不同；确认新 managed runtime activation
后，owner 才对捕获的旧 shell ID 执行 reference-checked cleanup，unknown outcome 不触发此清理。
即时完成、后台 timer 与下一请求触发的 reconciliation 共用一次 finalization，始终使用原 attempt 的清理上下文。
无论 activation 被确认、删除或替换，finalization 都结算 candidate 与被替换的 node runtime；
unknown outcome 同时保护二者。清理 owner 保留读取 references 或 kill 失败的 exact ID，后续请求及删除事件重试；
只有确认引用或完成 kill 才解除清理责任，已引用 runtime 的责任交回 durable binding/node owner。
Renderer 的 placement cleanup 按 managed receipt 选择 Worker 路径，并先协商 operation support；
legacy launch 保留直接 PTY cleanup，不因 provider 或预分配 node ID 改变责任。
Cleanup obligation 按 runtime ID 带独立代际；reference proof 和已完成的 kill 只能解除其观察到的代际，
不能删除 await 期间新增的清理责任。Recovery 每次等待完成都重新检查 node 当前的 pending launch，
然后读取 durable observation；已 retired 的 node 不从较早的 workspace snapshot 重连。

Durable ownership 与 effect admission 分开管理。路径审批、identity read 或 admission 的最终验证失败，
不能结算原有健康 runtime。验证通过后的 owned replacement 先提交并确认保留 tuple 的
null-runtime handoff，再对旧 runtime 执行 reference-checked kill；kill 失败仍由 cleanup owner
持有 exact ID，失败 settlement 不抹除重试责任。后续 readiness 或 deletion event 重试未完成的清理。
spawn 返回 ID 后立即交给同一 cleanup owner，早于 onStarted、watcher 与 metadata registration；
这些步骤失败、attempt 被替换或删除，也不会丢失新进程的清理责任。unknown write 同时保留
candidate 与 predecessor，只有 definitive reconciliation 才能释放保护。
Cleanup owner 保留成功 exact-ID kill 的终止证据；后续 claim 仍复查 references，读取失败仍保留责任，
但不重复 kill 已成功终止的同一 ID。该证据仅在当前 Worker owner 生命周期内有效；新 PTY 使用新 UUID，
不能把 stream hub 缺少 active session 当作成功 kill 的证明。

Managed launch scope 从 handler 执行前到 wrapper finally 收尾持有 created candidate custody，
不依赖 activation obligation 是否已经建立。其他 node 的 admission、recovery 或 deletion 不得清理
该 candidate；readiness/deletion 只处理对应 node 的已知 IDs。scope 结束时统一释放 hold，并对
created/predecessor IDs 做 reference-checked cleanup；首次 adoption 无 ledger row 也必须清理失败 candidate。
失败 read/kill 与旧 work 留下的新 claim 使用按 exact ID 的 single-flight timer 重试；unknown
activation 以有上限的延迟持续 reconciliation，不再因尝试次数耗尽而等待外部请求。dispose 取消
该 owner 的 timer；timer、scope completion 和新 claim 仍保留各自 identity/generation guards。

Managed launch result 的 ownership 判定包含新取得的 receipt；`nodeSeen=true` 的既有节点继续
保留 SQLite 中的 Worker route，不能用本次解析出的 explicit local/mount route 替换 null inheritance。
`nodeSeen=false` 的首次保存仍可建立 route。Renderer lifecycle 与成功 prepare 投影都遵循这一规则，
其下一次 snapshot 通过同一 final writer；kind/provider/route identity 与 execution directory 必须 round-trip。

成功 fallback shell 也属于 Worker 创建的 runtime。在 renderer 保存其 ID 前，node-scoped custody
保留唯一 cleanup claim；已提交 snapshot 的 reference proof 才交回 durable node owner，删除或确认替换
则释放捕获的精确 ID 并执行 reference-checked cleanup。读取失败保留 custody 并定时重试。
新 fallback 的 predecessor claims 同样保持 hold，直到新 shell 持久化；仅 spawn 成功不构成 durable 替换。
Fallback admission 验证 resolver 的实际 directory/mount/endpoint，已有 effect admission 也须重验，
不能用 stored context 替代请求执行上下文。PTY target 再解析后通过同一内部 hook 检查，owned 不允许 remote。
成功交接在 finish await 之后以同步 fence 确认；此后没有可能拒绝交接的 async 工作。若此前失败，
helper 只放弃本 attempt 新 shell 的 hold，并 reference-check cleanup，保留前驱 hold 与未来清理义务。
Fallback 的 PTY profile/activity preparation 之后，以进程内 `terminalSpawnLifecycle` hook 在
实际 spawn 前检查原 attempt，spawn 返回 ID 后立即登记 custody，再提交 activity/metadata。
该 hook 不接受 wire payload，legacy PTY 不注入；取消后的 finally 仍结算已创建 runtime。
