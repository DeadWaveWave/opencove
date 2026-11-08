---
name: opencove-agent-prompt
description: Send a prompt to an existing OpenCove agent window with the OpenCove CLI when the user requests agent prompt delivery.
---

Use `opencove agent prompt` only for local agent windows OpenCove launched from a task,
the agent launcher, or `node create agent`: Claude Code or Codex with lifecycle hooks.
Agents typed into a terminal cannot receive prompts because the shell would receive the input after the agent stops.
Start an agent meant to receive prompts, such as a lead agent other agents report to, as an agent window using Run Agent on a task, the agent launcher, or `opencove node create agent --space <space> --prompt <text>`; it can still use the opencove CLI from there.
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

## Steering an existing turn

`agent prompt` defaults to steering an authoritative working Claude Code or Codex
agent; the message belongs to the current OpenCove turn. Use `--if-busy refuse` for
busy refusal. The CLI checks `system.operation.describe` first; an older Worker
without `whenBusy` receives no new fields, and busy refusal stays visible. No retry
is made after an error. Waiting/dialogs and unknown/degraded states refuse.

The CLI prints its generated deliveryId before sending; retain it even if the
response is lost. Codex steering returns `dispatched`, exit 0, while awaiting
consumption. Check `opencove agent delivery <id> --wait --timeout 2m` before treating
it as submitted. Confirmation is in order only while no other PTY input intervenes;
other input makes it ambiguous, and interruption/end can leave it unknown.
Claude same-ID receipts confirm submission independently of run-state acceptance.
textComparison never decides submission. The submitted text differed from what you
sent; an existing draft may have been included. Do not resend; inspect the screen.

The orchestration loop is prompt → delivery status → `wait --turn` = **the containing
turn ended** (check outcome) → `read --turn` (Claude correlated; Codex reply reads
stay uncorrelated). Turn end does not prove a steer was handled. `agent delivery`
exits 0 for submitted, 1 for not_sent/ambiguous/unknown/unavailable or an unconfirmed
snapshot, 124 for a wait timeout. Self-wait returns immediately so consumption can
proceed. Unresolved records are pinned; capacity refuses before bytes. A closed evidenceWindow is not a result. Worker restart/expiry makes lookup unavailable, never
proof of not_sent. A pasted draft may remain after not_sent (no CR).
Late qualifying hooks can upgrade retained uncertainty within the existing 60 s
trust window. Claude transcript-based reconciliation is out of scope, a known
limit. Never resend; check delivery status or the screen.

Use `agent prompt --expect-turn <turnId>` when a correction must steer that exact
active turn: idle or a changed turn refuses before paste, and the condition is
rechecked before Enter. Without this option, an ended turn may become a new turn.
The CLI negotiates `expectTurnId` separately; a Worker without the guard refuses
this option without writing. `--if-busy refuse` still refuses working agents.
`evidenceWindow: open | closed` describes collecting delivery evidence, not the
agent's work; a closed window does not mean that the containing turn finished.
A completed turn means the agent stopped, not that your request was fulfilled —
check the reply covers what you asked before marking work done.
Scripts should read replies with `-o json`.
