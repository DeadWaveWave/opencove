# Control Surface

Control Surface 是 OpenCove 对外能力入口。Desktop、CLI、Web UI 和 remote worker 都通过同一套 command / query / event contracts 调用业务能力。

## Contract Shape

- `Query`：只读查询，不写 durable truth，不启动长期运行的 runtime。
- `Command`：表达会产生副作用的用户或 client 意图。
- `Event`：推送状态变化、sync、PTY output 或控制事件。

所有请求和响应必须是可序列化 JSON。边界输入必须 runtime validate，错误必须返回稳定的 `AppErrorDescriptor`。

## Transport

当前实现包含：

- Desktop IPC：Renderer 通过 preload 白名单调用 Main。
- HTTP `/invoke`：Worker Control Surface 的 command / query 调用。
- HTTP `/events`：server-sent event stream。
- WebSocket `/pty`：PTY attach、input、resize、controller-bound Agent re-exec、role/control event。
- Worker Web access listener：同源 Full Web Canvas、debug shell、cookie auth 与上述 HTTP/WS routes。

Transport 只做鉴权、校验、mapping 和连接生命周期；业务 owner 仍在 context application/usecase、runtime manager 或 topology store。

### Protocol Header And Operation Introspection

Authenticated HTTP `/invoke` callers may send `x-opencove-protocol` equal to the decimal
`CONTROL_SURFACE_PROTOCOL_VERSION`. A present, unequal value returns the normal HTTP 200
error envelope with `common.protocol_incompatible` and params `{ client, server }` (the
received header string and server version number), before operation dispatch or persistence
access. Missing headers retain existing behavior. Desktop IPC is unaffected.

`system.capabilities.features.operationRegistry` is `true`. The read-scope schema query
`system.operations` accepts `{}` and returns `{ protocolVersion, operations }`, sorted by id.
Each entry contains `id`, `kind`, `scope`, `availability`, `contract` and `summary`. Only
operations actually registered in this runtime are listed, including conditional
Desktop-managed Worker, managed-runtime and debug registrations when present. Metadata is
not authorization; existing transport and handler authority checks remain in force.

The read-scope schema query `system.operation.describe` accepts `{ id: string }` and returns
that metadata plus `inputSchema` and `errors`. Schema inputs use
`z.toJSONSchema(op.input, { io: 'input', unrepresentable: 'throw' })`, computed lazily and
cached by id within the runtime. Legacy operations return `inputSchema: null` and `errors: []`;
schema errors are the registry's declared non-common codes, not an exhaustive transport-error
catalog. Unknown or unregistered ids return `common.invalid_input` with a diagnostic message.
The actual handler map owns availability; the schema cache is derived, non-durable state.

### Runtime And Listener Lifecycle

Desktop 管理的本机 Worker 把长期运行的 `ControlSurfaceRuntime` 与 HTTP listen socket 分开：

- private listener 在 Worker 生命周期内保持稳定，只绑定 loopback，并写入连接文件；
- Web listener 由独立的 Web access runtime 管理，可按 Settings 配置 prepare、activate、drain 或 rollback；
- private/Web listener 始终委派给同一套 handlers、`PtyStreamService`、Hub、presentation 与 recovery owners；
- listener stop/drain 只释放该 listener generation 的 transport 资源，不能 dispose Control Surface runtime 或 PTY。

Web enable、port、LAN 和 password 变化不构成 Worker restart boundary。候选 listener 先完成绑定与验证，再原子持久化并激活；失败保留旧 listener 和旧 durable config。完整契约见
`docs/runtime/WORKER_WEB_ACCESS_LIFECYCLE.md`。

本地 Worker 连接文件是 private listener 的运行时发现文件，不是 durable truth。连接文件必须写入
`appVersion`、`startedBy`、pid、host、port 和 token。Desktop 只允许复用
`startedBy: "desktop"` 且 `appVersion` 等于当前 Desktop 的 Worker；缺失或不一致表示
升级后旧 Worker 仍存活，必须重启并重写连接文件。CLI-started/remote Worker 仍以
`system.capabilities.protocolVersion` 和功能探测作为兼容边界，避免 Desktop 自动接管用户
显式管理的 Worker。

## Authentication

当前鉴权路径：

- private/programmatic 调用：`Authorization: Bearer <token>`。
- Browser loopback/tunnel：private listener 签发一次性 ticket，Web listener 的 `/auth/claim` 换 cookie session。
- LAN Web UI：Web listener 的 `/auth/login` 使用 Web UI password 换 cookie session。

Worker private listener 始终绑定 loopback；只有 Web listener 可以显式暴露到 LAN，并且必须启用密码或等价安全门禁。Web access 配置 command 只接受 private bearer authority。Disable、password change 或 LAN tightening 会撤销对应 Web listener/session/socket；不得撤销 private listener 上的 Desktop/CLI bearer client 或终端 session。

## Current Operation Groups

Core system:

- `system.capabilities`
- `system.operations`
- `system.operation.describe`
- `system.ping`
- `system.homeDirectory`

Desktop-managed local Worker administration（private bearer only）：

- `worker.config.get`
- `worker.config.set`
- `worker.webAccess.setSettings`
- `worker.webAccess.setSecurity`

Topology:

- `endpoint.list`
- `endpoint.sshConfigHosts`
- `endpoint.register`
- `endpoint.registerManagedSsh`
- `endpoint.updateManagedSsh`
- `endpoint.remove`
- `endpoint.overview.list`
- `endpoint.prepare`
- `endpoint.repair`
- `endpoint.ping`
- `endpoint.homeDirectory`
- `endpoint.readDirectory`
- `mount.list`
- `mount.create`
- `mount.remove`
- `mount.promote`
- `mountTarget.resolve`

Filesystem:

- `filesystem.*`
- `filesystem.*InMount`

Sessions and PTY:

- `session.list`
- `session.snapshot`
- `session.presentationSnapshot`
- `session.terminalAgentActivity.list`
- `session.prepareOrRevive`
- `session.spawnTerminal`
- `session.launchAgent`
- `session.launchAgentInMount`
- `session.kill`
- `pty.spawn`
- `pty.spawnInMount`
- `pty.listProfiles`

`session.prepareOrRevive` is also the sole owner of the internal terminal recovery admission scope.
Normal spawn operations require a successful Worker startup scan; they can create independent
sessions while persisted runtime nodes are still reconciling or have failed recovery. Incomplete or
failed startup and shutdown retain the stable `terminal.runtime_not_ready` error. After scan failure,
explicit reconciliation may reopen only its own workspace. The recovery scope is runtime-only and
is never accepted as client payload.

PTY resize results distinguish verified `accepted`, non-failing `accepted_unverified`, and
`runtime_failed`. Only verified applied geometry may advance canonical presentation state; an
unverified ConPTY resize never promotes requested rows/columns into an acknowledgement.

其中 `session.launchAgent` 和 `session.spawnTerminal` 是通用 intent：当 payload 通过 `spaceId` 命中一个 mount-aware Space 时，handler 会先解析该 Space 的 mount 上下文，再内部委派到 `session.launchAgentInMount` 或 `pty.spawnInMount`。

Canvas node control:

- `node.list`
- `node.get`
- `node.create`
- `node.update`
- `node.delete`
- `canvas.focus`

Project, workspace, sync, worktree and integrations are also exposed through dedicated handlers where implemented.

## Topology And Mounts

Worker endpoints and mounts are managed by the topology store:

- `worker-topology.json` stores remote endpoints and mounts.
- `worker-endpoint-secrets.json` stores endpoint tokens separately.
- The local endpoint is implicit and always identified as `local`.

Managed SSH remains a topology-level endpoint record. `endpoint.prepare` / `endpoint.repair`
quickly return an accepted overview in the existing HTTP 200 `/invoke` envelope, rather than
holding the request open through installation. `ManagedSshEndpointOperationOwner` owns one active
operation per endpoint: exact intent duplicates join; incompatible intents fail closed with
`endpoint.operation_in_progress`. The preparation port owns SSH I/O and tunnel resources, not
admission. Cold preparation runs direct SSH probe-first bootstrap before opening the local tunnel;
a matching healthy warm tunnel is reused. Connection resolution is read-only: it returns only a
matching prepared route and never starts or retries SSH resources. Cold, failed, or replaced routes
require explicit `endpoint.prepare` / `endpoint.repair`, including after Home Worker restart.
Browse flows resolve through `endpoint.homeDirectory` and `endpoint.readDirectory` on the target Worker.

An overview's optional `operation` is runtime-only: `operationId`, positive `revision`, `kind`,
`phase`, `startedAt`, and `updatedAt`. Missing operation is equivalent to null for older clients.
Only forward phases increase revision; timestamps are diagnostic, not ordering authority. Active
operations project `connecting`, `canBrowse=false`, empty technical details and `show_details`,
without capability probes. Settlement removes the operation and restores terminal health.
This monitor does not write topology/SQLite, increment durable sync revisions, or publish `/events`.

Each renderer has one `EndpointOverviewProjectionOwner` in topology renderer presentation, composed
by AppShell's `EndpointOverviewProvider`. It owns only renderer-local projection, not Worker operation
authority; the Control Surface port remains injected at the app boundary. Settings, Wizard, Mount Manager and Picker bind active consumers of
that shared projection. It serializes `endpoint.overview.list` queries, fences pre-acceptance and
pre-mutation responses, and polls 500ms after query settlement only while consumers and an active
operation exist. Observation failure preserves the previous operation and retries observation,
never installation. Closing a window releases its consumer, not the Worker operation; reopening
queries current truth. Picker loads the intended/home directory once per open generation when
browsing becomes possible. Progress is localized and indeterminate; reduced-motion disables the
spinner without hiding the named progressbar or polite status.

Bootstrap progress markers have an exact versioned allowlist and are display signals only.
Managed SSH opts into 256 KiB per-stream diagnostic capture while command observers receive all
chunks; other process callers keep the unlimited default. Active UI suppresses transient tunnel
noise. Terminal details strip control/progress markers, redact credentials, deduplicate channel
refusals, and cap output at three bounded lines. Lifecycle diagnostics allowlist operation
correlation/phase/elapsed/failure fields and never write credentials, arguments or scripts.
`endpoint.sshConfigHosts` is a read-only projection of the current user's SSH configuration. Its
domain parser has no filesystem/runtime dependencies, while the Main boundary exclusively owns
bounded file and `Include` reads. It returns concrete `Host` aliases for preview only; importing
still uses `endpoint.registerManagedSsh`, and the stored host remains the alias so OpenSSH owns
effective `HostName`, `User`, `Port`, identity, and proxy resolution.
`endpoint.updateManagedSsh` validates the complete replacement configuration before side effects,
fences operation admission, cancels/drains local SSH execution, stops the previous tunnel, revalidates the endpoint against the topology store's current state,
then commits the replacement through the store's serialized write queue before preparing the new
tunnel. Admission stays fenced through the durable mutation; an access read started before the
mutation cannot start stale work afterward. If stopping the previous tunnel succeeds but the durable write fails, the old durable
configuration remains authoritative even though its tunnel has already stopped; callers can
reconnect or repair it. Endpoint and credential identity plus concurrent mount bindings are
preserved. Callers must re-resolve endpoint connections after an update and must not cache the
runtime-only loopback port.

Interactive `endpoint.remove` callers must send the `expectedMountCount` from the overview they
presented so a concurrent binding change fails closed. The field remains optional for compatible
non-interactive callers; omitting it deliberately accepts and removes the current mount impact.

Mount-aware operations resolve `mountId` through `mountTarget.resolve`, enforce mount root scope, then route to the correct endpoint.

对仅持有 `spaceId` 的 session/node-control 调用，当前也复用同一套 Space mount 解析规则：优先以 `targetMountId` 为 authority，必要时从兼容性的 `directoryPath` 推断并修复旧 Space 绑定，然后再决定是否进入 mount-aware 路由。

## Architectural Boundary

Control Surface is a facade, not the durable owner:

- Workspace state belongs to workspace persistence/usecases.
- Files belong to filesystem providers guarded by approved roots and mount root.
- PTY/session runtime belongs to Worker runtime and stream hub.
- Endpoint/mount registry belongs to topology store.

Current code has some handlers that directly orchestrate persistence/topology because those stores are boundary owners. New feature logic should still be placed in context application/usecase first, then exposed through Control Surface.

## Adding A Capability

1. Identify the state owner and durable truth; implement side effects in the existing usecase/owner.
2. Add one definition in `shared/contracts/controlSurface/operations/domains/<prefix>.ts` and include
   it in `registry.ts`. Declare `id`, `kind`, `scope`, `availability`, a short summary and non-common
   error codes. Unmigrated operations explicitly use `defineLegacyOperation`.
3. Use two stages: `input` describes only wire shape and must pass
   `z.toJSONSchema(input, { io: 'input', unrepresentable: 'throw' })`. Do not use refine, transform,
   superRefine, preprocess or custom types. Pure `normalize` owns trimming, defaults, truncation,
   cross-field rules, enum fallbacks and URI checks; reject with `common.invalid_input`.
   Preserve the legacy accept-domain, including permissive fields, until a versioned change.
4. Register schema operations through Main's `registerOperation`; retain handler authorization,
   lifecycle fences and default error codes. Registry metadata does not grant authorization.
5. Add strict export, frozen-oracle parity and real composition registration tests before adding
   CLI/IPC/Web mappings. Output schemas are outside this migration.

Renderer / Preload layers may only `import type` from operations and must not import `zod` at
runtime. `architecture.rendererNoOperationRuntime` enforces this boundary, including subpaths.

## Verification Anchors

- `tests/contract/controlSurface/controlSurfaceHttpServer.managedSshOperations.spec.ts`
- `tests/unit/contexts/managedSshEndpointOperationOwner.spec.ts`
- `tests/unit/contexts/endpointOverviewProjectionOwner.spec.ts`
- `tests/e2e/settings.managed-ssh-cold-bootstrap-progress.spec.ts`
- `tests/e2e/remote-directory-picker.managed-ssh-progress.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.controlPlane.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.ptyProxy.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.integration.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionPrepareOrRevive.spec.ts`

## Agent runtime queries and events

`agent.get` and `agent.list` expose the executing Worker’s decided run state with read scope.
`agent.list` returns an epoch/sequence watermark for the separate agent runtime stream on `/events`.
See [Agent run state](../agent/RUN_STATE.md) for input fields, filters, retention, resynchronization
and mounted-session compatibility. Runtime sequences are independent of durable app-state revisions.

### Session grant authentication

`SessionGrantRegistry` defines Worker-local, 256-bit random credentials with SHA-256-only
storage and constant-time digest comparison. Its owner must supply authoritative session
liveness. `requestAuth` accepts an injected registry and represents successful verification as
`{ kind: 'session-grant', grant }`. An invalid explicit bearer does not fall back to a cookie.

A session grant is a guardrail for agents running as the same OS user, not an OS sandbox.
It prevents prompt-injected or confused agents from using the documented API to make decisions
that belong to a human. **Project isolation is not yet enforced**; cross-project reads and
mutations remain possible and are the separate S1b work.

`http/sessionGrantPolicy.ts` is the exhaustive, fail-closed authority table. Unknown IDs,
`admin`, `worker.*` and `auth.*` operations are denied. Both HTTP admission and internal
`controlSurface.invoke` use it; constrained checks run after validation and before execution.
The read/interact tier remains a ceiling, not an authorization heuristic.

Grants allow the listed canvas, filesystem, worktree and session operations, including Space
creation and node updates. Launches and prompts are constrained. Use `api ops` and `api schema`
inside OpenCove to inspect current access; schema fields do not grant permission.
The table below is a selective index, not the exhaustive policy. Endpoint/mount administration,
project addition/root approval and plugin distribution or execution require a human decision.

| Denied operations | Reason |
| --- | --- |
| `endpoint.prepare/register/registerManagedSsh/remove/repair/updateManagedSsh/readDirectory`, `mount.create/promote/remove` | Endpoint and mount administration belongs to the user |
| `project.add`, `workspace.approveRoot` | Project addition and root approval require a human decision |
| Plugin install/update/apply/rollback/discover/reload/enable/remove and repository operations | Plugin distribution belongs to the user; consult the policy for exact IDs |
| `session.writeNode` | Send messages with `agent.prompt`; only the user answers permission prompts and dialogs in OpenCove |
| `sync.state`, `sync.readWorkspaceStateRaw` | Application settings can contain private credentials |
| `sync.writeState`, `sync.writeWorkspaceStateRaw` | Settings, permission policy and persisted roots belong to the user |
| `sync.writeNodeScrollback`, `sync.writeAgentNodePlaceholderScrollback` | OpenCove owns saved terminal history |
| `session.attachAgentStateWatcher`, `session.detachAgentStateWatcher`, `session.prepareOrRevive` | OpenCove owns observation and recovery |
| `workspace.allocateProjectPlaceholder`, `workspace.ensureDirectory` | Project setup and root approval belong to the user; use filesystem operations within approved roots |
| `plugin.command.run`, `plugin.invoke`, `plugin.host.request`, `plugin.sidebar.items`, `plugin.view.open`, `plugin.window.open` | These paths can execute code with plugin authority |
| `plugin.storage.set`, `plugin.preferences.set`, `plugin.view.preferences.set` | Installation-wide plugin state belongs to the user |

Grant launches (`session.launchAgent`, `session.launchAgentInMount`) accept only target fields
(`spaceId` / `cwd` or `mountId` / `cwdUri`), `prompt`, `provider`, `model`, `cols`, `rows`.
Explicit `agentFullAccess`, `env`, `executablePathOverride`, `resumeSessionId`,
`codexReuseRunningAppServer`, `mode` and unknown fields are refused, including null/false values.
Grant launches also refuse nonempty prompts whose trimmed text is a single whitespace-free token,
including ordinary words, because providers may dispatch them as commands. Describe the task in a sentence.
This check also applies to nested agent creation and runs before remote bearer forwarding.
The existing launch owner reads the user’s configured permission policy and environment.
For remote grant launches, Home resolves and forwards its saved `agentFullAccess` and
`codexReuseRunningAppServer` values explicitly, so the destination Worker does not replace
them with its own defaults. Trusted callers retain their existing override behavior.

Launch responses and session listings describe the public command. Private process arguments
and environment transport, including WSL environment assignments, stay out of session metadata.
Home omits arguments from older Workers' WSL wrapper metadata when no public command is available.
Process failures retain their error code without returning private launch details.
Known application refusals retain their typed reason and fixed recovery guidance; arbitrary
process error payloads remain private for every caller.

Provider launch planners preserve option-like prompts using the provider's literal input channel.
Codex terminates parsing before every initial prompt; Pi uses text-file input only for
option-like prompts, including older versions. Trusted Pi single-word prompts stay inline;
Pi and Claude retain native command dispatch for trusted single-word prompts. Pi prompt files belong to the executing Worker's
launch artifact owner and follow session cleanup; Home forwards prompt text, never a local file.
Terminal profiles translate marked host-file arguments only after selecting the actual runtime;
WSL profiles refuse files that cannot be mapped into that runtime.
Model option values use the same literal encoding when their parser could interpret them as options.
Grant-originated launch and delivery prompts also reject the target provider's command prefixes
at the first non-whitespace character: Claude Code ! / # & (including legacy memory and background-task entry),
Codex/OpenCode/Pi/Gemini ! /, and Kimi /. Delivery checks the resolved run fence before
allocating a delivery record or writing input; launch checks the resolved provider before
preparation or remote bearer forwarding. Trusted callers retain native provider behavior.


Forbidden envelopes include `details.reason` (`operation_denied` or `field_denied`),
`operationId`, a human-readable `message`, and `field` for launch restrictions. Invalid or
revoked credentials return 401; policy refusals return `common.forbidden` (HTTP admission uses
403). CLI authorization failures exit 4 without suggesting a broader credential.
`system.whoami` returns the actual tier and identity, never credentials. For grant callers,
`system.operations` adds `policyVersion` and per-operation `access` (`allowed`, `denied`,
`constrained`), with denial reasons and `rejectedFields` reasons for constrained launches.
Grant calls to `system.operation.describe` include the same access information and `policyVersion`
beside the full input schema. Inside OpenCove, CLI schema output keeps the schema and adds these
access annotations; schema fields alone do not authorize their use. Older Workers show unknown
access. Outside OpenCove, schema export stays offline without asserting caller permissions.
The CLI operation catalog reports `access: unknown` offline or with older Workers and omits
`allowed`; constrained operations also omit `allowed`.

CLI environment credentials are paired with `OPENCOVE_CONTROL_URL`. An explicit `--endpoint`
requires `--token`; profile discovery never borrows an environment token. `pty attach` sends
Authorization in a header and requests viewer access, keeping tokens out of URLs.
These changes stay within the existing process and dependency boundaries: no executable-rule impact.

Invariants:

- **I1** A session grant never authorizes an admin or unregistered operation.
- **I2** A grant is valid only while its hosting session exists; kill/exit revokes it, including
  across hosting Worker restarts.
- **I3** Grant tokens are never logged or returned by operations, are stored only as hashes,
  and the full Worker bearer never reaches spawned processes.

Each hosting Worker creates one registry and supplies it to HTTP and PTY transports. Its local
PTY wrapper reserves a hashed credential before spawn and activates it only after successful session
registration. Pending/failed reservations cannot authenticate. Exit, kill and shutdown revoke grants
and close associated streams. `SessionRegistrationOwner` fences exit-before-registration and late
spawn completion after shutdown. The token exists in plaintext only in the temporary spawn environment.

Canvas spawn identity comes from Worker workspace records or an authenticated new-node reservation.
`node.create` allocates its ID before launching and uses the same ID when committing the node. Trusted
UI launchers likewise supply their reserved node ID; existing node membership is resolved from Worker
records. Session grants cannot supply arbitrary canvas node IDs. Recovery carries the persisted node
identity in an in-process context. This context propagates across nested spawn operations, isolated
per asynchronous invocation. Caller environment variables never determine identity.

For remote mounts, the Home Worker forwards its resolved identity with the existing private Worker
bearer. The hosting Worker accepts this delegation only from bearer-authenticated callers, creates
its local session/grant binding, and injects its own private Control Surface URL. The Home Worker does
not mint or forward a grant token. This is a trust relationship between Workers possessing each other's
administrative bearer, not a new permission available to grant or cookie callers.

`/events` provides the Worker-wide revision stream. `/pty` grants permit viewer attach/detach only;
control, write, resize and agent reexec messages are refused. SSE and WebSocket connections subscribe
to revocation; SSE membership is removed synchronously and sockets are terminated. Pending HTTP
bodies and persistence preparation are followed by authoritative liveness checks before dispatch.
Project scoping remains a follow-up; a scope tier is not a project isolation boundary.

### Prompt delivery

`agent.prompt` is a schema-backed **interact** command composed once per executing Worker.
Its application service depends on SessionInputPort, RunStateFencePort and provider prompting
capabilities. Local Claude Code and lifecycle-hook Codex agent windows OpenCove launched
contribute supported prompting with a 300 ms submit delay. Explicit managed PTY provenance
is required; terminal shim invocations and other providers refuse. Read-tier credentials cannot invoke it. The Hub reserves its existing session
operation queue once and exposes a scoped raw writer, live input generation, ingress mode and
watermark; the callback never invokes enqueuing Hub APIs. Response disconnect and grant revocation
propagate cancellation to the service. Internal receipt fields stay out of public snapshots.
See [Prompt delivery](../agent/PROMPT_DELIVERY.md) for the precise promise and limitations.
This adds an operation and internal ports within existing dependency boundaries; no executable-rule impact.

## 节点血缘查询

`features.nodeLineageV1` 表示 Worker 安装了 lineage repository 与 `node.resolveCallerSelector`。
该 strict-schema read query 接受 `{selector:"@parent", expectedCallerNodeId?:string}`；
expected ID 仅为身份 mismatch fence，parent 始终由 verified grant 推导。无身份、root、已删除父节点
分别返回 `node.parent_unavailable` 的 caller_identity_required、no_parent、parent_deleted，均不可自动重试。
节点不存在返回 node.not_found，身份不符返回 common.forbidden。父节点不限 kind，具体操作继续检查权限与运行状态。
`node.list`、`agent.list` 的 spawnedByNodeId 仅筛选直接子节点，在客户端 limit 之前执行。
公开 node query 返回 spawnedBy、lineageDepth、lineageStatus；agent CLI/context 从 node metadata 投影。
现有 @self fallback 与 Space 语义不变。此功能不声明 spawn cap 或 PR2 admission 支持。
无新增跨层依赖规则：no executable-rule impact。


### Bounded grant runtime creation

Policy `s1a-v5` permits grant runtime creation only through `node.create` with a current,
locally owned agent/terminal caller bound to the authenticated session. The existing node mutation
queue owns admission through launch and commit settlement. Depth is at most 3 (user root = 1),
with at most six distinct live or pending grant-created runtime descendants per immutable root.
Agent and terminal descendants share the budget across Spaces/projects. Human, task Run and recovery
launches remain exempt; their recovered descendant bindings contribute to subsequent admission.

`AgentSpawnAdmissionOwner` retains pending identities and immutable lineage until all related runtime
incarnations exit. Engine-returned session IDs are captured before callbacks. Kill, revocation, node
deletion and failed requests are not completion evidence. An unknown dispatch fences its tree until
that exact PTY host confirms completion. An uncertain node commit with a known live session retains
one occupied slot. Admission permits are private, single-use, Worker-local objects; raw session/PTY
routes reject grants without a matching internal permit. Permits never enter wire identities,
remote forwarding, environment or SQLite.

Grant runtime targets must remain local, including after mount re-resolution. Delegated grants
cannot create roots on the executing Worker. Historical remote bindings cannot prove completion
through disconnection or saved status. At admission after startup or a persistence revision change, a read-only lineage audit
finds unaccounted orphan rows whose node/session/endpoint association was lost; affected roots fail closed.
Creation branches that never launch runtimes record that fact in the admission owner for the Worker
lifetime. Deleting their notes, tasks or websites does not make the census incomplete. Actual local,
remote or unknown runtime observations still take precedence over that creation fact. After a restart,
unclassified local or non-runtime orphans remain conservative fences because existing lineage rows do
not retain kind or endpoint. No reservation or endpoint history is persisted. The user can
inspect/stop historical runtimes and start a new canvas root for further delegation. Local surviving
nodes count only from actual runtime bindings, never their persisted status/session ID alone.
Observed remote roots retain their fence independently of node membership. Worker-local forwarding
observations also fence ambiguous remote incarnations even when a node was previously local and
is deleted before the next admission; no observation callback crosses the wire. Local runtime provenance
survives completion for the Worker lifetime, so a deleted, authoritatively exited local session is
not mistaken for an unknown remote orphan. Warm-start bindings seeded from an active hub observation
are retained until exact runtime completion; public registry disappearance cannot release them.
Internal post-spawn, failed-commit and deletion cleanup uses a trusted exact-session runtime port,
without the public session lookup gate. Public `session.kill` authorization remains unchanged.

The additive `boundedAgentSpawningV1` capability requires the installed admission/runtime owner and
lineage transaction support. CLI negotiation uses its existing per-run authenticated identity cache
and shared dispatcher, covering `api call`; bearer launches and non-runtime work are exempt. Raw grant
launches receive migration guidance before CLI selector resolution, including terminals outside a Space.
