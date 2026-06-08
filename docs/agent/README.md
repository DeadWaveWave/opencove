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
- Agent nodes can branch a verified resumable session into a new Agent node.
- Canvas nodes store provider/model/prompt/session metadata; PTY output and presentation belong to Worker runtime.

## Session Branching

`Branch session` in an Agent node header creates a new Agent node from the source Agent's verified `resumeSessionId`. This is an Agent conversation-context fork, not a Git branch or worktree operation.

The action is only enabled after the current Agent session binding has been verified. When triggered, the renderer creates a sibling Agent node, copies the source provider, model, prompt, execution directory, directory mode, profile/runtime settings, and task context, then launches the new node through the existing `mode: 'resume'` path with the source `resumeSessionId`.

Branching preserves the source Agent:

- The source node is not killed, relaunched, or rebound.
- The source Agent keeps its existing task primary binding.
- A branched Agent that inherited task context can be closed without unlinking the original task Agent.
- If the source belongs to a mounted Space, branch launch continues through the mount-aware launch route.
- If placement fails before a branch node exists, no Agent runtime is launched.

## Main Owners

| State | Owner |
| --- | --- |
| provider settings | settings context |
| executable override | settings context |
| executable resolution result | agent executable resolver, runtime cache |
| interactive launch runtime | terminal profile resolver |
| launch intent | agent/session launch path |
| PTY process | Worker PTY runtime |
| terminal presentation | Worker stream hub |
| node placement and frame | workspace context |
| task-agent relation | workspace/task model |

## Related Docs

- `../cli/EXTERNAL_EXECUTABLE_RESOLUTION.md`
- `../architecture/RECOVERY_MODEL.md`
- `../terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `../CLI_CANVAS_NODE_CONTROL.md`
