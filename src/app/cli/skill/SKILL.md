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
A terminal is not an agent. Resolve actual agents from the list before prompting.

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
opencove agent wait --node agent-123 --until idle --timeout 10m
opencove agent read --node agent-123 --last
opencove agent read --node agent-123 -o json
```

Prompt works only with **agent windows OpenCove launched** (from a task, the agent
launcher or `node create agent`) running **Claude Code**, or **Codex** with its
lifecycle hooks, after an observed finished turn. Agents typed into a terminal and
agent windows started with a custom executable path are refused.
Newly opened/resumed sessions may need a completed turn first.
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
- `agent.busy` / `working`: wait for completion.
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

Wait never sends input. After a prompt, wait `--until idle`: a state that already
holds counts, so it returns even if the turn finished before you started waiting.
Unknown or degraded never counts as idle. Use `--until turn-end` only when you start
waiting while a turn is still running. A finished turn is not a successful one:
check `turnOutcome` (completed, failed, aborted or unknown) before claiming success.
Default is `--all`, timeout 20s; minimum is 250ms (smaller budgets exit 2 before
connection/target lookup). Set `--timeout` for real work.
Live list excludes exited sessions; inspect a known exited node with get or wait.

```sh
opencove agent wait --node agent-123 --node agent-456 --until waiting --any --timeout 30s
opencove agent wait --node agent-123 --node agent-456 --until idle --all --timeout 2m
opencove agent get --node agent-123 --fields state,quality,turnOutcome
```

Wait prints all selected snapshots; timeout prints lastKnown on stderr, stdout empty.
Ctrl-C exits 130 and closes subscriptions. It never stops the target agent.
Both `agent read` and `session final --session <id>` treat null/empty/whitespace-only
messages as no readable final message: session.transcript_not_ready, exit 1, with
the same recovery. The server has no separate marker for a genuine empty reply.
Read defaults to plain text even when piped. `-o json` or `--fields` keeps structured
results. For `session.transcript_not_ready`, a working agent can be awaited with
`agent wait --node <selector> --until idle`, then read again. If it is already idle
after a completed turn, the provider has not written a readable transcript (for
example transcript saving is disabled): inspect
`agent read --node <selector> --screen` and check provider settings; waiting cannot
create that transcript. Missing conversation: check the selector and session, do not
prompt just to create readable output. Reading may cache a discovered transcript identity.

## Exit codes and useful output

- 0: success (check turnOutcome or endedTurnOutcome; a turn boundary alone does not mean successful work).
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
