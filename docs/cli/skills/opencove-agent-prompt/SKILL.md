---
name: opencove-agent-prompt
description: Send a prompt to an existing OpenCove agent window with the OpenCove CLI when the user requests agent prompt delivery.
---

Use `opencove agent prompt` only for local agent windows OpenCove launched from a task,
the agent launcher, or `node create agent`: Claude Code or Codex with lifecycle hooks.
Agents typed into a terminal shell, including shim/launcher invocations, are unsupported.
A terminal node that reports agent activity or Stop remains a terminal invocation.
Executable overrides and option-like model/resume values have no verified lifecycle
coverage. `executable_override_unverified` means remove the override in Settings →
agent executable and launch a new agent window with the required hooks. A fresh window may need a hook-observed completed turn before it is ready.

Use the requested target ID and exactly one text source:

```sh
opencove agent prompt --node node-123 --text-file ./prompt.txt --timeout 20s
```

The command attempts one bracketed paste and Enter into the current editor; existing
editor drafts may be submitted too. Resolve visible dialogs and inspect the editor.
`terminal_agent_unsupported` means the target must be an agent window OpenCove launched.
Do not try raw PTY writes to work around that refusal. `agent.blocked` means resolve the
pending dialog before trying delivery again.

`submission_observed` confirms a matching authenticated submission observation, not
exact text processing, causation, or turn completion. Never resend automatically after
an interrupted/stalled delivery, transport loss or unknown outcome; inspect the editor
and conversation first. Missing attempt flags do not prove that nothing was sent.

See [CLI prompt guidance](../../AGENT_PROMPT.md) and
[delivery contract](../../../agent/PROMPT_DELIVERY.md) for input limits and recovery.
