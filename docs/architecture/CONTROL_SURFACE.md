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
Before persisted runtime nodes are reconciled, normal spawn operations fail with the stable,
user-explicable `terminal.runtime_not_ready` error. The scope is runtime-only and is never accepted
as client payload.

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
own local tunnel orchestration, remote runtime bootstrap, and health projection; browse flows
still resolve through `endpoint.homeDirectory` and `endpoint.readDirectory` on the target Worker.
`endpoint.sshConfigHosts` is a read-only projection of the current user's SSH configuration. Its
domain parser has no filesystem/runtime dependencies, while the Main boundary exclusively owns
bounded file and `Include` reads. It returns concrete `Host` aliases for preview only; importing
still uses `endpoint.registerManagedSsh`, and the stored host remains the alias so OpenSSH owns
effective `HostName`, `User`, `Port`, identity, and proxy resolution.
`endpoint.updateManagedSsh` validates the complete replacement configuration before side effects,
stops the previous tunnel, revalidates the endpoint against the topology store's current state,
then commits the replacement through the store's serialized write queue before preparing the new
tunnel. If stopping the previous tunnel succeeds but the durable write fails, the old durable
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

1. Identify the owner and durable truth.
2. Implement the domain/application usecase or boundary owner method.
3. Register a command or query with runtime validation.
4. Add contract tests for payload validation, success shape and stable error semantics.
5. Add CLI/IPC/Web mapping only after the Control Surface contract exists.

## Verification Anchors

- `tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.controlPlane.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.ptyProxy.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.integration.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionPrepareOrRevive.spec.ts`
