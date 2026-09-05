# Agent Runtime

Agent nodes launch external AI CLIs through the Worker/session runtime. The public contract is the same for Desktop, Web UI and CLI clients: renderer/UI layers send intent, Worker/session owners launch or restore runtime, and durable workspace state stores only recoverable metadata.

## Current Capabilities

- Providers: `claude-code`, `codex`, `opencode`, `gemini`, `pi`, `kimi`.
- Provider executable discovery uses `AgentExecutableResolver`.
- Provider model list, session discovery, and AI helper CLI paths use host executable
  diagnostics from `AgentExecutableResolver`.
- Interactive agent launch uses the selected terminal profile, matching terminal shell
  startup semantics for PowerShell, Git Bash, and WSL.
- Provider-level executable override is passed to both diagnostics/model-list paths and
  the terminal-profile launch path when configured.
- Agent launch can run in a Space mount via `session.launchAgentInMount`.
- Agent session restore participates in worker `session.prepareOrRevive`.
- Canvas nodes store provider/model/prompt/session metadata; PTY output and presentation belong to Worker runtime.
- Claude, Codex, and Pi launches use Worker-owned loopback hook channels for authoritative
  `working` / `waiting` / `standby` observations. Other providers use session-file detection.
  Remote workers own their own local credentials and observation sources.
- Terminal-command Agent adoption through PATH shims supports POSIX bash/zsh and native Windows
  processes. On Windows, WSL profiles and `wsl.exe` launches intentionally fail open to the exact
  untouched spawn: host loopback credentials, host paths, and PowerShell scripts are not injected
  into the Linux guest.

The Worker invocation registry is runtime-only. It assigns generations, monotonic source and
aggregate revisions, retains the current invocation plus at most eight still-live superseded
invocations and bounded completion tombstones, and lists its owner baseline. `PtyStreamHub` retains
the latest validated transport metadata projection for the query-only renderer baseline. A verified
Claude/Codex provider session identity is immutable within its invocation and remains on both active and exited
baseline events. Pi uses an explicitly ordered `provider_session_snapshot` authority for in-process
conversation replacement, without changing the invocation generation. An explicit resume invocation records its target from the authenticated shim arguments and
accepts only the same provider identity at `SessionStart`; a mismatch cannot silently rebind durable
conversation truth. Invocation exit fences later hook activity but neither exits the PTY nor clears
the separately owned provider conversation binding. The loopback gateway owns only authentication, hook
artifacts, and cleanup; no invocation registry state is persisted.

## Pi Native Observation Contract

Both ordinary-terminal `pi` commands and managed Pi Agent nodes inject a private, launch-scoped
`-e` extension through the provider contribution. No global Pi configuration is changed. Native
Windows and POSIX shims share the injection planner; WSL retains its no-host-injection boundary.

The extension sends complete snapshots to authenticated `POST /hooks/pi`: process ID, monotonically
increasing sequence, conversation revision, exact session ID/file, persistence evidence, and state.
`PiAgentObservationOwner` rejects foreign processes and reordered snapshots before either identity
or state escapes. Sequence and conversation revision survive same-process extension reload. Child
Agents inherit an owner-PID guard and cannot adopt the parent terminal's invocation.

An allocated session path is not a verified resume binding. A nonempty persisted session file can
establish the exact resume path, including custom session directories. Missing files and transport
failure do not revoke an existing binding. Explicit conversation replacement (`/new`, resume,
fork) and ephemeral mode can revoke the previous binding; an unpersisted new conversation must
not silently resume the old conversation after a cold restart. Claude/Codex identity fences remain
unchanged. Invocation exit, extension shutdown, and turn completion are separate facts.

`agent_settled` supplies completion; a deferred affirmative `isIdle` check after `agent_end` is the
compatibility path. Blocking extension UI supplies waiting. Working snapshots renew the existing
lease every 60 seconds; quiet states do not poll. Delivery permits one active filesystem/network
operation and one latest pending snapshot, with a one-second HTTP deadline. Shutdown disposes
requests/timers without emitting a fabricated completion. Monitoring never waits on Pi's event path.

A credential-owned `PiSessionObservationWatcher` watches only the exact current transcript, not
cwd/time neighbours. Conversation-tagged observations fence stale fallback/replay; unavailable
files invalidate fallback evidence rather than manufacturing standby. Metadata projection is shared
across Worker, preload replay, and Renderer so discovery cannot overwrite native conversation truth.
Runtime snapshots are not persisted into workspace state; only the accepted resume binding is durable.

### Pi validation

`workspace-canvas.pi-hook.spec.ts` executes the injected extension against a deterministic Pi API
fixture; it is not evidence of real Pi or real-model parity. The opt-in acceptance test instead uses
an installed Pi and its authenticated model configuration, verifies a persisted assistant reply, and
keeps its new transcripts in a disposable directory. It disables project trust, resource discovery,
and built-in tools without changing global settings:

```bash
pnpm build
OPENCOVE_TEST_REAL_PI=1 OPENCOVE_REAL_PI_EXECUTABLE="$(command -v pi)" \
  OPENCOVE_E2E_RETRIES=0 OPENCOVE_E2E_DISABLE_CRASH_FALLBACK=1 \
  pnpm exec playwright test tests/e2e/workspace-canvas.pi-hook.real.spec.ts --project electron
```

The real-model test requires POSIX and network access and may incur model usage. It waits for the
rendered Pi editor as well as the native startup snapshot before typing; native `session_start`
alone does not establish input readiness. It does not establish older-Pi, Windows, Linux, or full
reference lifecycle parity.

## Main Owners

| State | Owner |
| --- | --- |
| provider settings | settings context |
| executable override | settings context |
| executable resolution result | agent executable resolver, runtime cache |
| interactive launch runtime | terminal profile resolver |
| launch intent | agent/session launch path |
| PTY process | Worker PTY runtime |
| ordinary-terminal invocation generation, exit fence, and live baseline | Worker `TerminalAgentInvocationRegistry` |
| native hook receivers and credentials | Worker Control Surface lifecycle |
| agent run-state observation | Renderer run-state arbiter over Worker observations |
| terminal presentation | Worker stream hub |
| node placement and frame | workspace context |
| task-agent relation | workspace/task model |

## Local Claude Hook Contract

The local Worker owns a dedicated loopback-only `POST /hooks/claude` receiver. Each Claude PTY spawn
receives a fresh opaque token and the receiver URL through its child environment. The token is bound
to that PTY session after spawn, is rejected for every other session, and is removed on session exit,
kill, spawn failure, or Worker shutdown. Payloads are size-bounded and runtime validated before they
can emit a state observation.

The Worker atomically installs only its managed command-hook entries in the user-level Claude
settings and preserves unrelated hooks. Invalid settings, an unavailable loopback listener, explicit
hook disablement, or managed-hook restrictions fail open: the agent still launches, the existing
session-file detector remains active, and the renderer displays a localized fallback indicator.

Hook and session-file observations are runtime-only. The renderer arbiter keeps the session-file watcher
warm, but projects exactly one source per session: a fresh installed hook wins, a stale `working` hook or
an unavailable hook falls back to the cached session-file signal, and providers without a hook use their
session file normally. `waiting` and `standby` hook signals are sticky because silence is expected in
those states; only `working` owns the 180-second freshness lease. The lease timer belongs to the renderer
event hub and is disposed on session exit, node removal, or owner teardown.

Every source switch is reflected in runtime observation metadata and degraded fallback is visible in the
Agent header. Neither source may write run-state into durable node status; persistence strips the runtime
observation entirely.

The Worker stream hub retains one timestamped runtime observation per source for each live session. A
renderer attach replays those raw observations in observation order, and the same renderer arbiter derives
the winner again; attach never renews an old `working` lease. The desktop relay keeps the same per-source
runtime mirror so a reloaded window can receive replay without reattaching or disturbing the Worker PTY.
These caches are discarded on session exit or retirement and are never persisted. Renderer-only reload can
therefore reconstruct a quiet `waiting` state, while a cold Worker restart honestly re-derives state from
the newly launched process and its session file.

Run-state replay and provider session resume are separate recovery contracts. The run-state work introduced
in #337 replays runtime-only `working` / `waiting` / `standby` observations across renderer reload or live
reattach; those observations expire with the Worker and cannot restore conversation contents after a cold
restart. Cold session resume instead requires a durable, verified provider session ID. For a terminal-started
Agent, hydration starts a fresh shell and enters the explicit provider resume command exactly once. A provider
hint without a verified ID remains visible for manual recovery but never starts a new conversation
automatically.

For supported POSIX interactive shells, the PATH shim relay mirrors the user's normal non-login bash
`.bashrc` flow and zsh login/non-login startup files, including a custom `ZDOTDIR`, then restores the
shim at PATH precedence. Login bash is not produced by this relay (`bash` is started with
`--noprofile --rcfile ... -i`), so `.bash_profile` / `.profile` are outside this feature's startup
contract. Missing, malformed, or unreadable user rc files retain the underlying shell's outcome; the
relay never edits those files.

## Related Docs

- `../cli/EXTERNAL_EXECUTABLE_RESOLUTION.md`
- `../architecture/RECOVERY_MODEL.md`
- `../terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `../CLI_CANVAS_NODE_CONTROL.md`
