# Worker Web Access Lifecycle

本文档定义 Desktop 管理的本机 Worker 如何在不替换 Worker、PTY 或 Renderer 的前提下应用 Web UI 配置。它补充 `docs/architecture/CONTROL_SURFACE.md`：Control Surface runtime 是长期运行的能力 owner，Web listener 只是可替换的接入边界。

## Scope

本契约覆盖 Settings 中的四类 Web access 变化：

- enable / disable
- port
- LAN exposure
- password

Desktop 启动的本机 Worker 使用本文的独立 Web listener。用户显式通过 CLI 启动的 Worker 保留单 listener 的兼容语义，除非其公开 CLI contract 另行升级；CLI-managed Worker 活跃时 Desktop Settings 的 hot apply 会 fail closed，而不是改写其运行时或启动第二个 durable writer。本文只保证 listener 配置变化不退出 Worker；完整 Worker 进程退出后 live PTY 继续存在不是本契约的承诺，冷恢复仍遵循 `RECOVERY_MODEL.md`。

## Runtime Shape

```text
Desktop-started local Worker
  ControlSurfaceRuntime                 one Worker lifetime
    handlers / persistence / topology
    PTY runtime / PtyStreamHub
    presentation / terminal recovery
    shared PtyStreamService

  PrivateControlListener                stable Worker lifetime
    loopback + bearer authentication
    connection-file endpoint

  HomeWorkerConfigurationOwner         application owner
    disabled / active / degraded listener authority
    preparing / restoring / draining transitions
    Web assets / login / cookie policy
    delegates invoke / events / pty to ControlSurfaceRuntime
```

`ControlSurfaceRuntime` may create more than one HTTP listener, but every listener delegates to the same handlers and `PtyStreamService`. A listener owns only its HTTP listen socket and accepted HTTP transport resources. Closing or replacing it cannot call runtime, Hub, presentation, recovery or PTY final disposal.

## State Ownership

| State | Class | Owner | Write entry | Restart source |
| --- | --- | --- | --- | --- |
| Home Worker Web intent | durable fact | Home Worker configuration store | one serialized config mutation | `home-worker.json` |
| Active Web listener generation | runtime state | settings application Web-access owner | serialized apply transaction | durable Web intent |
| Private listener endpoint | runtime state | Worker composition | Worker startup/final shutdown | Worker launch |
| Web ticket/cookie generation | runtime state | `WebSessionManager` | issue/claim/revoke | none |
| Web socket auth kind/generation | runtime observation | PTY stream client record | accepted upgrade | none |
| PTY/session/presentation/geometry | runtime state | existing terminal owners | existing terminal operations | terminal recovery contract |
| Settings status/error | UI projection | Renderer | apply/status result | recompute |

While an owned local Worker is live, all `home-worker.json` mutations route through that Worker's single serialized configuration store. Main uses the same normalization/persistence implementation only when no live owned Worker exists. Renderer never writes the file directly.

The durable file remains version 1. Writes use a same-directory temporary file followed by rename, preserve unrelated mode/remote/Web fields, and advance `updatedAt`. The revision timestamp is strictly monotonic (`max(now, previous + 1 ms)`) even when the wall clock is frozen or moves backward; malformed legacy revisions normalize to `null` and are repaired. A stale expected revision fails closed instead of overwriting a newer configuration.

## Listener Roles

### Private listener

- binds loopback only;
- is recorded in the Worker connection file;
- accepts bearer-authenticated Desktop/CLI/control traffic;
- issues one-time Web claim tickets;
- does not serve Web assets or password login;
- remains stable through all Web access changes.

### Web listener

- exists only when Web access is enabled;
- binds loopback or all interfaces according to LAN exposure;
- serves same-origin Web assets, login/claim, `/invoke`, `/events` and `/pty`;
- delegates business and terminal work to the long-lived Control Surface runtime;
- is never written to the private connection file.

## Apply State Machine

```text
disabled -> preparing -> active
active -> preparing replacement -> active(new) + draining(old)
preparing -> failed -> previous active state
same-port rollback failure -> degraded -> restoring -> active(previous)
active/degraded -> disabling -> disabled
booting/active/degraded/draining -> final shutdown -> disposed
```

Only the settings application Web-access owner mutates this state. `app/worker` composes its listener/config/session adapters and owns no transition policy. Apply calls share one serial queue; duplicate requests are idempotent, and a stale config revision cannot overtake a newer request. Final disposal fences new work, aborts pending listeners/restoration, and joins startup plus the complete apply queue before returning; no older continuation may activate a listener afterward.

### Transaction

```text
normalize + authorize + revision check
  -> prepare gated listener/auth candidate
  -> atomically persist the complete next config
  -> activate by owner-local generation swap
  -> synchronously revoke obsolete auth/LAN authority
  -> bounded transport drain of the previous generation
```

Candidate preparation includes host/port bind and route/auth construction, but the candidate rejects public admission until activation. Activation performs no fallible IO. If validation, bind or persistence fails, the candidate is disposed and the previous active listener plus previous durable configuration remain authoritative.

For a different port, the candidate can warm before the old listener stops accepting. For a same-port host change, the owner does **not** rely on concurrent wildcard/loopback binds: a gated candidate can still steal pre-commit traffic on some operating systems. It synchronously retires only the old listen handle, starts its accepted-handler drain without awaiting it, attempts the replacement bind, and relistens the old address on failure. After successful activation, obsolete auth/LAN authority is revoked before that drain is joined. Accepted streams and upgraded WebSockets are tracked separately from the listen handle and survive this handover unless the security transition explicitly revokes them. Accepted HTTP work drains to an explicit deadline; a client that never finishes its request body is destroyed at that boundary and cannot block disable, LAN tightening or rollback forever, while the runtime-global registry still owns any application handler until final settlement/watchdog.

If both replacement and rollback binds fail, previous durable config, listener generation, Web policy and surviving upgraded clients remain authoritative. Status becomes `degraded`, and one cancellable bounded-backoff restoration loop retries the previous bind. Worker, PTY, Hub, presentation and private listener remain live. New HTTP admission cannot be promised while the operating system refuses every bind; OpenCove reports that physical boundary rather than pretending rollback succeeded or failing closed by destroying the last-known-good authority.

## Transition Semantics

| Change | New admission | Existing Web clients | Terminal/Worker effect |
| --- | --- | --- | --- |
| enable | allowed after candidate activation | none | none |
| disable | rejected immediately | Web sessions/sockets revoked | PTYs and private clients continue |
| different port | new port after activation; old generation rejects new admission | bounded drain, then reconnect/rehydrate | none |
| LAN enable | Web listener widens only after valid password policy | loopback clients may continue | none |
| LAN disable | non-loopback admission rejected | existing non-loopback sockets close; leaving password mode also rotates old password-cookie sessions | PTYs continue; private bearer clients continue |
| password change | persisted hash swaps in place on the active listener; no rebind/generation change | old Web ticket/cookie generation closes | PTYs and bearer clients continue |
| failed apply | previous admission remains | previous clients continue | none |

A Web transport close caused by disable or security tightening is intentional access revocation, not terminal recovery. After valid reauthentication, the browser hydrates the same Worker sessions from presentation snapshot and stream replay.

Old listener generations have a bounded transport drain deadline. Final listener cleanup closes only transport resources owned by that generation; it cannot kill terminal sessions. A handler that outlives that deadline remains registered in the runtime-global accepted-request owner rather than in the retired socket/listener. Final runtime disposal seals and joins that registry before disposing application or terminal owners.

## Authentication Boundaries

- Web configuration commands require the private bearer path and runtime payload validation.
- Cookie-authenticated Web clients cannot change Worker listener or credential configuration.
- One-time tickets and cookie sessions carry an auth generation.
- Password change and disable invalidate previous Web generations server-side.
- Every accepted password request captures the listener auth revision. A hash result that completes after policy rotation cannot mint a new cookie.
- Removing LAN exposure also revokes accepted non-loopback Web sockets.
- Private-listener bearer-authenticated Desktop/CLI sockets are not members of Web auth generations. A bearer/query-token transport intentionally opened through the Web listener still belongs to that listener's enable/LAN lifecycle.

A password change may disconnect affected browser clients to preserve the security boundary. It must never restart the Worker or close the underlying PTY.

## Terminal Continuity Contract

During any Web access apply that does not intentionally revoke the observing browser transport, these identities remain unchanged:

- Worker `pid` and `createdAt`
- private connection endpoint
- `PtyStreamService.instanceId`
- PTY session/runtime epoch and process identity
- presentation sequence and geometry revision
- Desktop Renderer `performance.timeOrigin`
- Desktop xterm instance and DOM identity

Continuous output must keep sequence order and existing Desktop scrollback/viewport. Settings code must not navigate/reload Renderer, remount xterm, suspend terminal hydration, or call Worker stop/start.

## Shutdown And Recovery

Web listener replacement is not a restart boundary. Listener generation and Web sessions are runtime-only and are reconstructed from durable Web intent after a real Worker start.

Final Worker shutdown still follows the terminal recovery ordering in `docs/architecture/RECOVERY_MODEL.md`. Composition synchronously begins runtime shutdown before awaiting Web-owner cleanup: it freezes new runtime/listener admission, stops every listener, joins the runtime-global accepted-handler registry independently of client socket lifetime, then drains/checkpoints terminal owners before disposing shared resources. The Worker watchdog exceeds the accepted-request drain deadline, and the Desktop launcher escalation exceeds the Worker watchdog. Web listener drain cannot run this sequence independently.

If Main loses an apply response, it queries Worker status/config revision before retrying. An idempotent retry observes the committed generation or safely prepares the desired durable state. It must not infer failure and restart the Worker. Offline Desktop writes and Desktop Worker startup share an owner-exact configuration lease: a complete owner directory is prepared privately and atomically renamed into authority, a valid live legacy JSON-file claim remains authoritative during mixed-version overlap, malformed claims are reclaimed only after their stale boundary, and release/reclaim quarantine the captured identity before deletion. Main rechecks runtime ownership inside that lease, while Worker holds it from config read through private-owner publication.

## Diagnostics

Diagnostics distinguish Worker identity from Web access generation:

- private Worker endpoint: pid, creation time, host/port and runtime instance;
- desired Web config: enabled, port, LAN/password flags and config revision;
- active Web generation: state, bind address, resolved port and password-policy flag;
- draining generations: bounded generation IDs;
- last startup/apply failure: sanitized detail without password/hash/token content.

See `WEB_UI_TROUBLESHOOTING.md` for operational checks.

## Invariants

1. Web access apply never invokes Worker, PTY, Hub, presentation or recovery final disposal.
2. Every private/Web listener generation delegates terminal traffic to one `PtyStreamService` and one Hub.
3. Candidate bind or persistence failure leaves the previous active and durable configuration usable.
4. Password, disable and LAN-tightening revocation affect only the corresponding Web-listener/auth transports; private Desktop/CLI bearer clients and PTYs remain live.
5. A live owned Worker is the sole durable configuration writer; Main writes only under the shared config lease after an in-lease owner recheck, and Worker startup cannot read config concurrently with that write.
6. Renderer navigation, xterm replacement and renderer cache are never Web access recovery mechanisms.
7. Listener generation cleanup is bounded and disposes only generation-owned transport resources.
8. `dispose()` joins startup/apply/restoration; after it resolves, no prior continuation can bind, activate or re-enable Web policy.
9. A double bind failure preserves durable authority and surviving Web transports; only new admission is degraded while restoration is pending.
10. Password-only changes never replace the listening socket or advance its listener generation.
11. Partial or stalled accepted HTTP transports have a bounded listener drain deadline; their application handlers remain runtime-owned until completion or final process watchdog.
12. Replacement activation revokes obsolete password-cookie and LAN socket authority before awaiting old-listener drain.

## Verification Anchors

- `tests/contract/controlSurface/controlSurfaceHttpRuntime.listenerLifecycle.spec.ts`
- `tests/contract/controlSurface/desktopManagedControlSurface.webAccess.spec.ts`
- `tests/unit/app/homeWorkerConfig.spec.ts`
- `tests/unit/contexts/homeWorkerConfigLease.spec.ts`
- `tests/unit/app/controlSurfaceHttpListener.spec.ts`
- `tests/unit/app/desktopManagedControlSurface.shutdown.spec.ts`
- `tests/unit/app/workerWebAccessRuntime.spec.ts`
- `tests/e2e/workspace-canvas.worker-web-access-continuity.spec.ts`
- `tests/e2e/workspace-canvas.desktop-web-terminal-consistency.spec.ts`
- `tests/e2e/worker-web-listener-handover.windows.spec.ts`
