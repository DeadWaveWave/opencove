---
name: opencove
description: Coordinate agents and share work inside OpenCove using its bundled CLI.
---

# OpenCove agent guide

This guide ships inside the CLI build. Use `opencove --version` to identify it; `opencove skill -o json` includes the matching version and guide content. Replace example IDs, names and paths with actual query results.

Agent terminals cannot read or change private settings, override launch policy, run provider commands through prompts, or run plugin code through the API; only the user answers permission prompts and dialogs in OpenCove and changes agent permissions in Settings → Agent → Providers → Permissions → Full Access Mode. Project isolation is not yet enforced. OpenCove may give supported local agents a short canvas guide at session start (Settings → Agent → Tell agents about OpenCove).

## Establish identity before acting

Check the environment variable `OPENCOVE_ENV=1` before using session defaults. If it is absent, stop and obtain an
explicitly authorized endpoint/profile; do not search or modify a real user's profile. Never print control tokens.

```sh
opencove --version
opencove whoami
opencove context
opencove node get --node @self
```

`whoami` reports your grant and scope; `context` orients you in the project/space. For agents,
`context.nodes[].state` is run state; `sessionStatus` is session lifecycle (running does not mean working). node
list keeps raw status as lifecycle; agentState exposes work state in node list/context; use agent list/get for
details. Missing context run observations are unknown, never inferred idle. Use command `--help` without a
connection whenever an option is unclear; inside OpenCove, `api schema` also reports access and rejectedFields, since schema fields alone do not authorize their use. Success stdout is the result itself, without an ok/value wrapper. Errors
go to stderr; non-TTY or `-o json` uses a structured `error` object.

## Select targets explicitly
Node, space and project selectors accept a full ID, exact case-sensitive name, or a unique ID prefix (6+ characters). Ambiguity exits 6: use a full ID. `@self` uses your authenticated terminal identity, not your
working directory. Inside OpenCove, `node create` and `node list` read your current container: your Space,
or the root canvas when you are outside every Space. There, `node list` lists the whole project; use `node list --root-canvas` for only root nodes. Explicit `--project` selects project scope for lists;
creation also needs a Space target or `--root-canvas`. Other commands keep their existing Space defaults. Names/prefixes use your project unless overridden. Terminal nodes can report observed
agents; only agent windows can receive prompts. Resolve targets from the agent list before prompting.

```sh
opencove node list -o table
opencove agent list --space @self -o table
opencove agent get --node "Reviewer" --pretty
```

To put a node on the canvas outside any Space: `opencove node create note --root-canvas --text …`.
Outside OpenCove, add `--project <id>`. Placement searches next to you when run inside OpenCove, or from the origin if your node is unavailable. Use `--focus` to reveal it.

## Notes and tasks are a shared blackboard
Read existing notes/tasks before changing them. Keep task ownership visible. Claim a task by setting status `doing`
and putting your actual node ID from `whoami` in a tag or requirement note. This is a coordination convention, not
an atomic lock: re-read and negotiate any conflicting claim. `--tag` replaces the provided tag list, so preserve
existing tags or use a requirement note. Finish with `ai_done`; reserve `done` for human acceptance.

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

Long text accepts `--text-file` or `--requirement-file` and `-` for stdin. Use either inline or file input. Preserve others' findings and claims.

## Coordinate: list → prompt → wait → read
Only create an agent when authorized for its provider, model and workspace. Do not close, stop or prompt nodes you did
not create unless explicitly asked. Never answer another agent's permission prompt; ask the human to handle it. A
`waiting` agent may be asking a question or permission, even with null blockedReason.

Name an agent at creation: `opencove node create agent --title "Reviewer"`; its name stays fixed.
Rename a window: `opencove node update agent --node "Reviewer" --title "Lead"` (use `terminal` for a terminal).
Stop its session, keeping the node: `opencove agent stop --node "Lead"`; already exited returns not_running, exit 0.
```sh
opencove agent list -o table
opencove agent get --node agent-123
opencove agent read --node agent-123 --screen
opencove agent prompt --node agent-123 --text-file ./assignment.txt --timeout 20s
opencove agent wait --node agent-123 --turn turn-123 --timeout 10m
opencove agent read --node agent-123 --turn turn-123
opencove agent read --node agent-123 --turn turn-123 -o json
```

Prompt works only with **agent windows OpenCove launched** (from a task, the agent launcher or `node create agent`)
running **Claude Code**, or **Codex** with its lifecycle hooks, at authoritative working state or after an observed
finished turn. Agent windows started with a custom executable path are refused. Both providers require local
invocation lifecycle hooks, authoritative state, default executable and bracketed paste. Claude requires Stop or
StopFailure; Codex requires trusted hooks for this invocation (Stop). Codex notify-only, daemon reuse, file-only
telemetry and Windows are unsupported. Terminal shell/shim/launcher agents are unsupported. Executable overrides
and option-like model/session values have no verified lifecycle coverage. For executable_override_unverified,
remove the override in Settings → agent executable and launch a new window; the running invocation is unchanged.
Agents typed into a terminal cannot receive prompts because the shell would receive the input after the agent
stops. Start an agent meant to receive prompts, such as a lead agent other agents report to, as an agent window
using Run Agent on a task, the agent launcher, or `opencove node create agent --space <space> --prompt <text>`; it
can still use the opencove CLI from there. Newly opened/resumed sessions may need a completed turn first.

Exactly one prompt source: --text or --text-file (- reads stdin). Use valid Unicode, nonblank text, at most 32 KiB
UTF-8 before newline normalization; trailing newlines are removed. Prompt timeout accepts milliseconds/durations
(15s, 15000ms, 1m), default 15s, maximum 60s; HTTP timeout adds a five-second response margin. Save the successful
prompt's `turnId` (replace `turn-123` above). The normal loop is prompt (save deliveryId/turnId) → delivery status
→ wait `--turn <turnId>` (the containing turn ended; check outcome) → read `--turn <turnId>` (Claude and Codex lifecycle replies are correlated). A successful prompt reports `textComparison`: `matched` means Claude Code's
reported text equals what you sent (newlines and trailing spaces aside); `different` (for example a draft was
submitted with it) still exits 0 but means stop, inspect with `agent read --screen`, and never resend; Codex
reports `unavailable`. claude-code-v1, verified for Claude Code 2.1.319, normalizes CRLF/CR to LF and trailing
ASCII whitespace (space, tab, LF); leading/interior whitespace stays significant. Codex comparison stays
unavailable until a profile is verified. Optional promptId is diagnostic; equality proves neither causation nor
model processing. Different prints a stderr notice; never press Enter again because of comparison.

The command attempts one bracketed paste and one Enter; an existing editor draft is submitted too. Inspect drafts
and dialogs first with `opencove agent read --node <selector> --screen`; unseen dialogs may consume input. Screen
reads replay the snapshot at its columns/rows, preserving cursor-created spaces, overwrites and wide CJK/emoji
cells. They select its normal/alternate buffer, ignore styling/modes, trim row-end spaces and trailing blank rows,
then return the last 40 rendered viewport rows. Use `--lines 20` to change the tail; `-o json` returns nodeId,
sessionId and lines. Never answer another agent's permission prompt. Screen inspection grants no authority to
resolve it. --lines requires --screen and a positive integer; --screen conflicts with --last and --turn.
JSON/projectable screen fields are nodeId, sessionId, lines. `submission_observed` confirms a matching
authenticated UserPromptSubmit observation, not exact text processing, causation, successful work, or turn
completion. Checks require a range-checked caller-supplied relay timestamp at or after the pre-Enter boundary,
assuming the same wall clock without adjustments; any holder of the session hook token can claim submission. Unseen
dialogs include one-time settings notices. Local HTTP timeout exits 124; transport loss leaves outcome unknown.

Refusals describe this call only; they do not cancel another delivery:

- `agent.blocked`: waiting for input (reason may be null); human resolves the dialog.
- `agent.busy` / `working`: legacy Worker or `--if-busy refuse`; wait for completion.
- `agent.busy` / `delivery_in_progress`: await that delivery's result before deciding.
- `agent.state_unknown` / `readiness_unobserved`: finish a turn in the terminal first.
- `agent.state_unknown` / `observation_degraded`: check hooks and await reliable evidence.
- `agent.not_running`: inspect the node; start/resume only when authorized.
- `agent.prompt_unsupported`: the reason says what is missing (another provider,
  `terminal_agent_unsupported`, `executable_override_unverified`, Codex   `codex_hooks_notify_only`);
`bracketed_paste_off` means the terminal has not   enabled bracketed paste. Check the terminal prompt.
- `agent.prompt_timeout` before paste: check target and attempt flags before deciding
  whether a new call is appropriate.

`agent.prompt_interrupted` means paste was attempted, but this call did not attempt Enter. Text may remain in the
editor. **Never resend after interrupted**; inspect the editor with `agent read --node <selector> --screen` and
have the human resolve dialogs before continuing. `agent.prompt_stalled` means Enter was attempted without a
matching submission receipt. **Never resend after stalled**; inspect `agent read --node <selector> --screen` and
the conversation to establish whether it submitted. Transport loss, CLI interruption, invalid response or Worker
restart also leaves a potentially submitted prompt: do not resend. `pasteDispatchAttempted` and
`submitDispatchAttempted` describe attempts, not receipt. Missing flags do not mean false. A deadline preserves the
phase and attempt flags.

Wait never sends input. After a prompt, save `turnId` and wait `--turn <turnId>`. This selects that exact end, even if a newer turn starts; matching waiting now stops with 10 by default. It returns `{nodeId, sessionId,
turnId, outcome, endedAt?, state}`; all ended outcomes exit 0. Check `outcome` (completed, failed, aborted or unknown). `--turn` requires exactly one node and conflicts with `--until`, multiple nodes and `--any`.
Unknown/evicted turns or missing retained evidence exit 1; inspect `agent get`. Its `lastEndedTurn` identifies the
latest end and persists during the next turn; replacement/restart clears it. Older Workers omit it; events/history
remain usable. History fallback requires interact scope. State waits follow the current session; exact archived
waits retain the original session. Inspect persisted before relying on restart durability. For node-level state
waits, a state that already holds counts immediately; unknown or degraded never counts as idle. `--until turn-end`
observes a subsequent end; start while the turn is still running. Default is `--all`, timeout 20s; minimum is 250ms (smaller budgets exit 2 before
connection/target lookup). Wait accepts whole milliseconds up to 2147483647 (about 24 days). Set `--timeout` for
real work. Live list excludes exited sessions; inspect a known exited node with get or wait.

```sh
opencove agent wait --node agent-123 --node agent-456 --until waiting --any --timeout 30s
opencove agent wait --node agent-123 --node agent-456 --until idle --all --timeout 2m
opencove agent get --node agent-123 --fields state,quality,turnOutcome
```

Exit 10 = waiting observed: the agent may need the user. Never answer its dialog; ask the user to resolve it in OpenCove (Desktop or this Worker's Web UI), inspect `agent read --node <id> --screen` (same connection options, matching session/turn IDs), then repeat the wait with the same --turn. Exit 11 = an unfulfilled target exited. Success beats both; 11 beats 10. --any stops on the first success or attention event; fulfilled bindings never stop --all, and a session change resets progress. turn-end results carry `completion` {sessionId, turnId, outcome}; event waits cannot resume an observed completion, so prefer --turn. --through-waiting keeps waiting through waiting (not exit 11). Exact PTY exit normally returns 0/unknown.

State waits print all selected latest snapshots; exact-turn waits print one result. Timeout prints lastKnown on stderr, stdout empty. Ctrl-C exits 130 and closes subscriptions. It never stops the target agent. Read tries the latest
ended turn's `agent.finalMessage` first. `--turn <turnId>` selects exactly the OpenCove turn ID returned by prompt:
no prefixes or fallback. Hook replies (≤64 KiB), outcome and IDs are private; exact archived local --turn reads/waits survive
restarts without a live agent. Archive caps: 60 turns/node, 30 days, 20,000 global records and 128 MiB of message text. JSON includes
persisted and memoryOnlyReason when false; archive_unavailable differs from a miss. Deleting the node removes
OpenCove history, not provider transcripts or existing backups. No prompt text or delivery records are archived.
`opencove agent history clear --node <selector>` deletes a node's stored replies (archive and memory) and keeps the
node, transcripts, run state and deliveries; archive unavailability clears memory but exits 1. Remote waits use mirrored snapshots/events; older history requires the executing
Worker. Local Claude hooks match session/prompt IDs; Codex lifecycle hooks match session/turn IDs. Codex stores the first matching Stop reply that ends the local turn. Later continuation cannot replace it; same-pair steering keeps that turn and does not clear waiting. Missing IDs or hook coverage provide no exact reply. Archived replies remain readable regardless of current hook coverage. Claude queued messages/provider
follow-ups stay in one OpenCove turn; exact reads return its final reply after continuations. An unknown
continuation marks the last provider reply messageKind: intermediate and prints a notice. After wait --until idle,
unqualified read selects only the latest ended reply. Check outcome; ended does not mean successful.

Only a read without `--turn` falls back to the transcript when the hook reports `no_ended_turn` or
`provider_sent_no_message`, including restored conversations; other errors are preserved. An empty or
whitespace-only hook reply succeeds and wins. Unqualified reads never search older hook messages and remain
current-incarnation reads. --last makes the default explicit and may accompany --turn. Exact-turn reads preserve
`agent.final_message_unavailable` and `details.reason`: `turn_not_ended` means still active, `turn_not_found` means
unknown/evicted, `provider_sent_no_message` means no correlated content, and `no_ended_turn` means no observed end.
Exact errors include known nodeId/sessionId/turnId and recovery commands: wait for turn_not_ended; agent get for
turn_not_found; --screen/session final for absent content/history. remote_history_unavailable means older remote
history requires the executing Worker, not eviction. Do not resend a prompt because its reply is unavailable.

Read defaults to plain message text even when piped. `-o json` or `--fields` keeps structured results, including
`source: hook|transcript` and `truncated`. Hook JSON includes nodeId, sessionId, turnId, optional promptId and
outcome; transcript JSON keeps sessionId, provider, startedAt, cwd and resumeSessionId with source: transcript and
truncated: false. A truncated hook prefix prints one stderr notice: look for the rest with `session final --session
<sessionId>` (transcript) or `agent read --node <selector> --screen`; neither guarantees the rest, and no automatic
replacement occurs.

Transcript fallback and `session final` reject null/empty/whitespace-only messages with
`session.transcript_not_ready`, exit 1. If working, wait `--until idle` and read again. If already idle after a
completed turn, check provider transcript saving and inspect `--screen`; waiting cannot create a transcript.
Missing conversation: check selector/session, do not prompt just to create output. Transcript reads may cache a
discovered transcript identity.

## Exit codes and useful output

- 0: success (check outcome, turnOutcome or endedTurnOutcome; a turn boundary alone does not mean successful work).
- 1: operation refused/failed or prompt delivery unconfirmed.
- 2: invalid arguments; use command `--help`.
- 3: connection unavailable; check endpoint and authorized Worker.
- 4: authorization refused; do not seek another agent's credentials.
- 5: protocol incompatible or invalid stream; use matching CLI/Worker versions.
- 6: ambiguous target; select a full ID.
- 10: waiting observed; inspect before acting. 11: unfulfilled target exited.
- 124: deadline/timeout; wait includes lastKnown; prompt may already have sent input.
- 130: interrupted; wait closes streams; prompt outcome may be unknown.

`--fields a,b` projects declared fields; `--pretty` indents structured JSON. `-o table` works only where command
help says supported. Do not stop Workers or delete nodes owned by someone else. Summarize actual work, remaining
questions, failures and verification in the shared task/note.

## Steering an existing turn

Working Claude Code/Codex agents receive steering in the current turn by default; --if-busy refuse preserves busy
refusal. system.operation.describe negotiates whenBusy first; older Workers receive no new fields and still refuse
busy agents. Waiting/dialogs and unknown/degraded states refuse. No error is retried.

Retain the deliveryId printed before sending, even after response loss. Codex dispatched exits 0 pending
consumption; check opencove agent delivery <id> --wait --timeout 2m. Confirmation stays in order only with no
intervening PTY input; other input is ambiguous, interruption/end may leave unknown. Claude same-ID receipts
confirm submission independently of run-state acceptance; textComparison never decides submission.

agent delivery exits 0 for submitted, 1 for not_sent/ambiguous/unknown/unavailable or unconfirmed snapshots, 124
for wait timeout. Self-wait returns immediately to allow consumption. Unresolved records are pinned; capacity
refuses before bytes. Restart/expiry means unavailable, never proof of not_sent; a pasted draft may remain after
not_sent (no CR). Late qualifying hooks can upgrade retained uncertainty within 60 s. Claude transcript-based
reconciliation is out of scope. Never resend; inspect status or screen.

--expect-turn <turnId> requires that exact active turn; idle/changed turn refuses before paste and is rechecked
before Enter. expectTurnId is negotiated separately; unsupported Workers refuse without writing. Without it, an
ended turn may become a new turn; --if-busy refuse still refuses working agents. evidenceWindow open/closed
describes evidence collection, not work or turn completion. Turn end does not prove a steer was handled; check
outcome and reply fulfills the request. Scripts should read replies with -o json.

## Retained turn identifiers

deliveryIds are retained correlations of OpenCove deliveries with this turn, including refused or uncertain attempts.
Membership proves neither submission nor consumption; inspect each deliveryId with opencove agent delivery <id>.
promptIds are the provider's own prompt IDs (Claude continuations included); agent delivery does not accept them. Best-effort
wait lookup failures omit IDs without changing completion/outcome/durability. Resolved delivery records expire
after 30 minutes and existing capacity limits apply; restart clears them. Live history keeps up to 64 previous
provider prompt IDs plus the final ID; archives retain only the final prompt ID. Missing IDs never justify resending.
