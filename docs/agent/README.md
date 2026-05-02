# Agent Runtime

Agent nodes launch external AI CLIs through the Worker/session runtime. The public contract is the same for Desktop, Web UI and CLI clients: renderer/UI layers send intent, Worker/session owners launch or restore runtime, and durable workspace state stores only recoverable metadata.

## Current Capabilities

- Providers: `claude-code`, `codex`, `opencode`, `gemini`.
- Provider executable discovery uses `AgentExecutableResolver`.
- Provider model list and launch paths receive provider-level executable override when configured.
- Agent launch can run in a Space mount via `session.launchAgentInMount`.
- Agent session restore participates in worker `session.prepareOrRevive`.
- Canvas nodes store provider/model/prompt/session metadata; PTY output and presentation belong to Worker runtime.

## Main Owners

| State | Owner |
| --- | --- |
| provider settings | settings context |
| executable override | settings context |
| executable resolution result | agent executable resolver, runtime cache |
| launch intent | agent/session launch path |
| PTY process | Worker PTY runtime |
| terminal presentation | Worker stream hub |
| node placement and frame | workspace context |
| task-agent relation | workspace/task model |

## Related Docs

- `../EXTERNAL_EXECUTABLE_RESOLUTION.md`
- `../RECOVERY_MODEL.md`
- `../terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `../CLI_CANVAS_NODE_CONTROL.md`
