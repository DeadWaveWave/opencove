# Agent Runtime

Agent nodes launch external AI CLIs through the Worker/session runtime. The public contract is the same for Desktop, Web UI and CLI clients: renderer/UI layers send intent, Worker/session owners launch or restore runtime, and durable workspace state stores only recoverable metadata.

## Current Capabilities

- Providers: `claude-code`, `codex`, `opencode`, `gemini`.
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
- Local Claude launches use a Worker-owned loopback hook channel for authoritative
  `working` / `waiting` / `standby` observations. Other providers and remote hosts continue to use
  the session-file detector.

## Main Owners

| State | Owner |
| --- | --- |
| provider settings | settings context |
| executable override | settings context |
| executable resolution result | agent executable resolver, runtime cache |
| interactive launch runtime | terminal profile resolver |
| launch intent | agent/session launch path |
| PTY process | Worker PTY runtime |
| local Claude hook receiver and credentials | Worker Control Surface lifecycle |
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
those states; only `working` owns the 120-second freshness lease. The lease timer belongs to the renderer
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

## Related Docs

- `../cli/EXTERNAL_EXECUTABLE_RESOLUTION.md`
- `../architecture/RECOVERY_MODEL.md`
- `../terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `../CLI_CANVAS_NODE_CONTROL.md`
