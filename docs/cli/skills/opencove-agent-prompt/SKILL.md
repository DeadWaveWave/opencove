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

Save prompt's returned `turnId`. After success, save `turnId` and use this loop (replace `turn-123`
with that ID):

```sh
opencove agent wait --node node-123 --turn turn-123 --timeout 2m
opencove agent read --node node-123 --turn turn-123
```

Exact waiting returns the selected `turnId` and `outcome`, even if a newer turn has
started; permission/question pauses keep it pending. All ended outcomes exit 0,
so check `outcome`. It requires one node and conflicts with `--until` and `--any`.
Unknown/evicted turns or restart without retained evidence exit 1: inspect `agent get`
and its `lastEndedTurn`. Timeout exits 124 with `lastKnown` on stderr.
The exact read never falls back. Hook history is private/in-memory, limited to the
last 8 ended turns per incarnation; restart/replacement clears it. Remote exact waits use only mirrored
snapshots/events. Older remote turns require the Worker that runs them;
`details.reason: remote_history_unavailable` identifies this limit, not eviction. Currently
correlated local Claude hooks supply messages. Unqualified read alone can fall
back to the transcript for `no_ended_turn` or `provider_sent_no_message`.
Default stdout is message text only; `-o json` includes `source` and `truncated`.
A cut hook prefix prints a stderr notice with transcript/screen inspection commands.
Unavailable exact reads preserve `agent.final_message_unavailable` reasons; never
resend a prompt merely because a reply is unavailable.

The command attempts one bracketed paste and Enter into the current editor; existing
editor drafts may be submitted too. Resolve visible dialogs and inspect the editor.
`terminal_agent_unsupported` means the target must be an agent window OpenCove launched.
Do not try raw PTY writes to work around that refusal. `agent.blocked` means resolve the
pending dialog before trying delivery again.

`submission_observed` confirms an authenticated submission observation that passed
receipt fences. `textComparison` is `matched`, `different` or `unavailable`.
`claude-code-v1`, verified for Claude Code 2.1.319, compares equality modulo newline
representation (CRLF/CR → LF) and trailing ASCII whitespace (space, tab, LF).
Leading/interior whitespace and all other characters remain significant. Codex
comparison is `unavailable` until a profile is verified. Optional provider `promptId`
is diagnostic; it does not correlate turn completion. Equality proves neither
causation nor model processing or turn completion.

`different` still exits 0 and prints a notice on stderr: stop automatic orchestration,
retain the identifiers and inspect with `opencove agent read --node <id> --screen`.
Never resend, clear the editor, press Enter again or cancel a turn automatically
because of the comparison. Never resend automatically after
an interrupted/stalled delivery, transport loss or unknown outcome; inspect the editor
and conversation first. Missing attempt flags do not prove that nothing was sent.

See [CLI prompt guidance](../../AGENT_PROMPT.md) and
[delivery contract](../../../agent/PROMPT_DELIVERY.md) for input limits and recovery.
