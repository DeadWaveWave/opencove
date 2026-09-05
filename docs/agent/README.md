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
- Local Claude and Codex launches use a Worker-owned loopback hook channel for authoritative
  `working` / `waiting` / `standby` observations. Other providers and remote hosts continue to use
  the session-file detector.
- Terminal-command Agent adoption through PATH shims supports POSIX bash/zsh and native Windows
  processes. On Windows, WSL profiles and `wsl.exe` launches intentionally fail open to the exact
  untouched spawn: host loopback credentials, host paths, and PowerShell scripts are not injected
  into the Linux guest.

The Worker invocation registry is runtime-only. It assigns generations, monotonic source and
aggregate revisions, retains the current invocation plus at most eight still-live superseded
invocations and bounded completion tombstones, and lists its owner baseline. `PtyStreamHub` retains
the latest validated transport metadata projection for the query-only renderer baseline. A verified
provider session identity is immutable within its invocation and remains on both active and exited
baseline events. An explicit resume invocation records its target from the authenticated shim arguments and
accepts only the same provider identity at `SessionStart`; a mismatch cannot silently rebind durable
conversation truth. Invocation exit fences later hook activity but neither exits the PTY nor clears
the separately owned provider conversation binding. The loopback gateway owns only authentication, hook
artifacts, and cleanup; no invocation registry state is persisted.

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
| local Claude/Codex hook receivers and credentials | Worker Control Surface lifecycle |
| agent run-state observation | Renderer run-state arbiter over Worker observations |
| terminal presentation | Worker stream hub |
| node placement and frame | workspace context |
| task-agent relation | workspace/task model |

## Local Agent Hook Contract

The local Worker owns loopback-only `POST /hooks/claude` and `POST /hooks/codex` receivers. Each PTY spawn
receives a fresh opaque token and the receiver URL through its child environment. The token is bound
to that PTY session after spawn, is rejected for every other session, and is removed on session exit,
kill, spawn failure, or Worker shutdown. Payloads are size-bounded and runtime validated before they
can emit a state observation.

The provider contribution injects private per-launch configuration and relay files; it does not
install new hooks into user-level settings. Existing unrelated user hooks remain provider-owned.
Launch artifacts are disposed with the session, and restored sessions generate fresh artifacts and
credentials. Existing live CLI processes retain their original injected configuration until relaunched.
An unavailable receiver or unsupported provider hook configuration fails open to the session-file detector.

### Relay launch and failure invariants

The route is `provider event -> generated command -> headless relay -> authenticated Worker receiver
-> run-state observation`. The relay owns only delivery, never session state or recovery decisions.
The receiver owns credentials and validation; the launch artifact scope owns temporary files.

- The generated command selects `ELECTRON_RUN_AS_NODE=1` at the relay boundary. Agent and terminal
  environments remain sanitized; forwarding Electron control variables through the provider is not
  a launch contract. A hook must never enter the desktop application's startup path.
- Codex command hooks, its legacy notify argument vector, and Claude exec hooks share the same relay
  launcher. POSIX uses `env`; Windows uses a private PowerShell launcher with explicit native argument
  quoting and an explicit byte stream for stdin (the Windows Electron executable cannot rely on
  inherited console input). Paths and notify JSON are data, including spaces, Unicode, quotes and
  shell metacharacters.
- Telemetry fails open with no decision output: the relay exits within its 2-second runtime budget,
  including unclosed stdin or an unresponsive receiver. The HTTP request has a 1.5-second timeout;
  command hooks also have a 3-second provider timeout. Transport failure never writes a terminal or
  durable conversation state. Input is bounded to the receiver's 256 KiB budget.

Regression coverage must execute generated commands after terminal environment resolution. A test
that posts directly to the receiver proves protocol/state behavior but cannot prove the relay launch
contract. Electron E2E coverage uses a controlled provider executable on the real launch path to exercise
repeated hooks and keyboard input without model/network dependencies.

Hook and session-file observations are runtime-only. The renderer arbiter keeps the session-file watcher
warm, but projects exactly one source per session: a fresh installed hook wins, a stale `working` hook or
an unavailable hook falls back to the cached session-file signal, and providers without a hook use their
session file normally. `waiting` and `standby` hook signals are sticky because silence is expected in
those states; only `working` owns the 180-second freshness lease. The lease timer belongs to the renderer
event hub and is disposed on session exit, node removal, or owner teardown.

An installed hook with no observation yet is `pending`, not stale. Both menu and terminal launches
continue using session-file state without a failure badge until evidence indicates degradation.
Startup silence has no lease: legacy notify may first emit at the end of a turn. Explicit installation
failure, an unavailable source, and expiry of a previously observed working hook still report degradation.

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
