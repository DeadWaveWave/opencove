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
| agent run-state observation | Worker hook channel, with session-file fallback |
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

Hook observations are runtime-only. Renderer projection may update `agentRuntimeObservation` and the
terminal-agent overlay, but it must never write hook state into durable node facts. This slice does not
arbitrate concurrent hook and session-file signals: a successfully installed local Claude hook is the
sole source, while every degraded install uses the session-file fallback.

## Related Docs

- `../cli/EXTERNAL_EXECUTABLE_RESOLUTION.md`
- `../architecture/RECOVERY_MODEL.md`
- `../terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `../CLI_CANVAS_NODE_CONTROL.md`
