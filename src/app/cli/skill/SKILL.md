---
name: opencove
description: Coordinate agents and share work inside OpenCove using its bundled CLI.
---

# OpenCove agent guide

This guide ships inside the CLI build. Use `opencove --version` to identify it;
`opencove skill -o json` includes the matching version and guide content.
All example IDs, names and paths must be replaced with actual query results.

## Establish identity before acting

Check the environment variable `OPENCOVE_ENV=1` before using session defaults.
If it is absent, stop and obtain an explicitly authorized endpoint/profile;
do not search or modify a real user's profile. Never print control tokens.

```sh
opencove --version
opencove whoami
opencove context
opencove node get --node @self
```

`whoami` reports your grant and scope; `context` orients you in the project/space.
For agents, `context.nodes[].state` is run state; `sessionStatus` is session
lifecycle (running does not mean working). node list keeps raw status as lifecycle;
use agent list/get
for run state. Missing context run observations are unknown, never inferred idle.
Use command `--help` without a connection whenever an option is unclear.
Success stdout is the result itself, without an ok/value wrapper.
Errors go to stderr; non-TTY or `-o json` uses a structured `error` object.

## Select targets explicitly

Node, space and project selectors accept a full ID, exact case-sensitive title/name,
or a unique ID prefix of at least six characters. Ambiguity exits 6: use a full ID.
`@self` uses your authenticated terminal identity, not your working directory.
Inside OpenCove, omitted space targets default to your space; explicit `--project`
selects project scope for lists. Names/prefixes use your project unless overridden.
Terminal nodes can report observed agents; only agent windows can receive prompts.
Resolve targets from the agent list before prompting.

```sh
opencove node list -o table
opencove agent list --space @self -o table
opencove agent get --node "Reviewer" --pretty
```

## Notes and tasks are a shared blackboard

Read existing notes/tasks before changing them. Keep task ownership visible.
Claim a task by setting status `doing` and putting your actual node ID from
`whoami` in a tag or requirement note. This is a coordination convention, not an
atomic lock: re-read and negotiate any conflicting claim. `--tag` replaces the
provided tag list, so preserve existing tags or use a requirement note.
Finish with `ai_done`; reserve `done` for human acceptance.

```sh
opencove node list --kind note
opencove node list --kind task
opencove node get --node task-123
opencove node create note --title "Progress" --text "Review started"
opencove node update note --node note-123 --text-file ./progress.txt
opencove node create task --title "Review" --requirement "Review the implementation"
opencove node update task --node task-123 --status doing --requirement "Original requirement; claimed by node-123"
opencove node get --node task-123
opencove node update task --node task-123 --status ai_done
```

Long text accepts `--text-file` or `--requirement-file` and `-` for stdin.
Do not supply both inline and file variants. Preserve others' findings and claims.

## Coordinate: list → prompt → wait → read

Only create an agent when authorized for its provider, model and workspace.
Do not close or prompt nodes you did not create unless explicitly asked.
Never answer another agent's permission prompt; ask the human to handle it.
A `waiting` agent may be asking a question or permission, even with null blockedReason.

```sh
opencove agent list -o table
opencove agent get --node agent-123
opencove agent read --node agent-123 --screen
opencove agent prompt --node agent-123 --text-file ./assignment.txt --timeout 20s
opencove agent wait --node agent-123 --turn turn-123 --timeout 10m
opencove agent read --node agent-123 --turn turn-123
opencove agent read --node agent-123 --turn turn-123 -o json
```

Prompt works only with **agent windows OpenCove launched** (from a task, the agent
launcher or `node create agent`) running **Claude Code**, or **Codex** with its
lifecycle hooks, at authoritative working state or after an observed finished turn. Agent windows started with a custom
executable path are refused.
Agents typed into a terminal cannot receive prompts because the shell would receive the input after the agent stops.
Start an agent meant to receive prompts, such as a lead agent other agents report to, as an agent window using Run Agent on a task, the agent launcher, or `opencove node create agent --space <space> --prompt <text>`; it can still use the opencove CLI from there.
Newly opened/resumed sessions may need a completed turn first.
Save the successful prompt's `turnId` (replace `turn-123` above). The normal loop is
prompt (save deliveryId/turnId) → delivery status → wait `--turn <turnId>` (the containing turn ended; check outcome) → read `--turn <turnId>` (Claude correlated; Codex reply reads stay uncorrelated).
A successful prompt reports `textComparison`: `matched` means Claude Code's reported
text equals what you sent (newlines and trailing spaces aside); `different` (for
example a draft was submitted with it) still exits 0 but means stop, inspect with
`agent read --screen`, and never resend; Codex reports `unavailable`.
The command attempts one bracketed paste and one Enter; an existing editor draft
is submitted too. Inspect drafts and dialogs first with
`opencove agent read --node <selector> --screen`; unseen dialogs may consume input.
Screen reads replay the snapshot at its columns/rows, preserving cursor-created
spaces, overwrites and wide CJK/emoji cells. They select its normal/alternate buffer,
ignore styling/modes, trim row-end spaces and trailing blank rows, then return the
last 40 rendered viewport rows. Use `--lines 20` to change the tail;
`-o json` returns nodeId, sessionId and lines. Never answer another agent's permission
prompt. Screen inspection grants no authority to resolve it.
`submission_observed` confirms a matching authenticated UserPromptSubmit observation,
not exact text processing, causation, successful work, or turn completion.

Refusals describe this call only; they do not cancel another delivery:

- `agent.blocked`: waiting for input (reason may be null); human resolves the dialog.
- `agent.busy` / `working`: legacy Worker or `--if-busy refuse`; wait for completion.
- `agent.busy` / `delivery_in_progress`: await that delivery's result before deciding.
- `agent.state_unknown` / `readiness_unobserved`: finish a turn in the terminal first.
- `agent.state_unknown` / `observation_degraded`: check hooks and await reliable evidence.
- `agent.not_running`: inspect the node; start/resume only when authorized.
- `agent.prompt_unsupported`: the reason says what is missing (another provider,
  `terminal_agent_unsupported`, `executable_override_unverified`, Codex
  `codex_hooks_notify_only`); `bracketed_paste_off` means the terminal has not
  enabled bracketed paste. Check the terminal prompt.
- `agent.prompt_timeout` before paste: check target and attempt flags before deciding
  whether a new call is appropriate.

`agent.prompt_interrupted` means paste was attempted, but this call did not attempt
Enter. Text may remain in the editor. **Never resend after interrupted**; inspect
the editor with `agent read --node <selector> --screen` and have the human resolve
dialogs before continuing.
`agent.prompt_stalled` means Enter was attempted without a matching submission
receipt. **Never resend after stalled**; inspect
`agent read --node <selector> --screen` and the conversation to establish whether
it submitted. Transport loss, CLI interruption, invalid response
or Worker restart also leaves a potentially submitted prompt: do not resend.
`pasteDispatchAttempted` and `submitDispatchAttempted` describe attempts, not receipt.
Missing flags do not mean false. A deadline preserves the phase and attempt flags.

Wait never sends input. After a prompt, save `turnId` and wait `--turn <turnId>`.
This selects that exact end, even if a newer turn starts, and keeps waiting during
permission/question pauses. It returns `{nodeId, sessionId, turnId, outcome, endedAt?, state}`;
all ended outcomes exit 0. Check `outcome` (completed, failed, aborted or unknown).
`--turn` requires exactly one node and conflicts with `--until`, multiple nodes and
`--any`. Unknown/evicted turns or restart without retained evidence exit 1; inspect
`agent get`. Its `lastEndedTurn` identifies the latest end and persists during the
next turn; replacement/restart clears it. Older Workers omit it; events/history
remain usable. History fallback requires interact scope.
For node-level state waits, a state that already holds counts immediately; unknown
or degraded never counts as idle. `--until turn-end` observes a subsequent end.
Default is `--all`, timeout 20s; minimum is 250ms (smaller budgets exit 2 before
connection/target lookup). Set `--timeout` for real work.
Live list excludes exited sessions; inspect a known exited node with get or wait.

```sh
opencove agent wait --node agent-123 --node agent-456 --until waiting --any --timeout 30s
opencove agent wait --node agent-123 --node agent-456 --until idle --all --timeout 2m
opencove agent get --node agent-123 --fields state,quality,turnOutcome
```

State waits print all selected snapshots; exact-turn waits print one result. Timeout prints lastKnown on stderr, stdout empty.
Ctrl-C exits 130 and closes subscriptions. It never stops the target agent.
Read tries the latest ended turn's `agent.finalMessage` first. `--turn <turnId>`
selects exactly the OpenCove turn ID returned by prompt: no prefixes or fallback.
Hook content, including an empty message, wins. History is private and in memory:
last 8 ended turns per incarnation; restart/replacement clears it. Remote exact waits use only mirrored
snapshots/events. Older remote turns require the Worker that runs them;
`details.reason: remote_history_unavailable` identifies this limit, not eviction. Hook messages
currently require correlated local Claude hooks. A finished turn may have failed;
check JSON `outcome` before claiming success.

Only a read without `--turn` falls back to the transcript when the hook reports
`no_ended_turn` or `provider_sent_no_message`. Exact-turn reads preserve
`agent.final_message_unavailable` and `details.reason`: `turn_not_ended` means
still active, `turn_not_found` means unknown/evicted, `provider_sent_no_message`
means no correlated content, and `no_ended_turn` means no observed end.
Do not resend a prompt because its reply is unavailable.

Read defaults to plain message text even when piped. `-o json` or `--fields` keeps
structured results, including `source: hook|transcript` and `truncated`. Hook JSON
includes nodeId, sessionId, turnId, optional promptId and outcome; transcript JSON
keeps provider, startedAt, cwd and resumeSessionId. A truncated hook prefix prints
one stderr notice: look for the rest with `session final --session <sessionId>`
(transcript) or `agent read --node <selector> --screen`; no automatic replacement.

Transcript fallback and `session final` reject null/empty/whitespace-only messages
with `session.transcript_not_ready`, exit 1. If working, wait `--until idle` and read
again. If already idle after a completed turn, check provider transcript saving
and inspect `--screen`; waiting cannot create a transcript. Missing conversation:
check selector/session, do not prompt just to create output. Transcript reads may
cache a discovered transcript identity.

## Exit codes and useful output

- 0: success (check outcome, turnOutcome or endedTurnOutcome; a turn boundary alone does not mean successful work).
- 1: operation refused/failed or prompt delivery unconfirmed.
- 2: invalid arguments; use command `--help`.
- 3: connection unavailable; check endpoint and authorized Worker.
- 4: authorization refused; do not seek another agent's credentials.
- 5: protocol incompatible or invalid stream; use matching CLI/Worker versions.
- 6: ambiguous target; select a full ID.
- 124: deadline/timeout; wait includes lastKnown; prompt may already have sent input.
- 130: interrupted; wait closes streams; prompt outcome may be unknown.

`--fields a,b` projects declared fields; `--pretty` indents structured JSON.
`-o table` works only where command help says supported.
Do not stop Workers or delete nodes owned by someone else. Summarize actual work,
remaining questions, failures and verification in the shared task/note.

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

Use `agent prompt --expect-turn <turnId>` to steer only that exact active turn; idle or a changed turn refuses before paste and is checked again before Enter.
The CLI negotiates `expectTurnId`; unsupported Workers refuse without writing.
Without the option, an ended turn may become a new turn; `--if-busy refuse` still refuses working agents.
`evidenceWindow: open | closed` describes collecting delivery evidence, not the agent's work; closed does not mean the containing turn finished.
A completed turn means the agent stopped, not that your request was fulfilled — check the reply covers what you asked before marking work done.
Scripts should read replies with `-o json`.
