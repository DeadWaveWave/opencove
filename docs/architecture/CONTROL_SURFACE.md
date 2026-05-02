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
- WebSocket `/pty`：PTY attach、input、resize、role/control event。
- Worker 同源 Web UI：Full Web Canvas 和 debug shell。

Transport 只做鉴权、校验、mapping 和连接生命周期；业务 owner 仍在 context application/usecase、runtime manager 或 topology store。

## Authentication

当前鉴权路径：

- 程序化调用：`Authorization: Bearer <token>`。
- Browser loopback/tunnel：一次性 `/auth/claim` ticket 换 cookie session。
- LAN Web UI：`/auth/login` 使用 Web UI password 换 cookie session。

Worker 默认绑定 loopback；暴露到 LAN 时必须启用密码或等价安全门禁。

## Current Operation Groups

Core system:

- `system.ping`
- `system.homeDirectory`

Topology:

- `endpoint.list`
- `endpoint.register`
- `endpoint.remove`
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
- `session.prepareOrRevive`
- `session.spawnTerminal`
- `session.launchAgent`
- `session.launchAgentInMount`
- `session.kill`
- `pty.spawn`
- `pty.spawnInMount`
- `pty.listProfiles`

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

Mount-aware operations resolve `mountId` through `mountTarget.resolve`, enforce mount root scope, then route to the correct endpoint.

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
