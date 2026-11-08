# Sending a prompt to Claude Code or Codex

`opencove agent prompt` pastes text into a local agent window OpenCove launched
(Claude Code or Codex with lifecycle hooks) and attempts to press Enter once. It never retries automatically.

```sh
opencove agent prompt --node node-123 --text "Review the changes"
opencove agent prompt --node node-123 --text-file ./prompt.txt --timeout 20s
cat prompt.txt | opencove agent prompt --node node-123 --text-file -
```

Use exactly one of `--text` or `--text-file`. The agent must have finished a turn
that OpenCove observed. A newly opened or resumed session may need a turn completed
in its terminal before this command can be used.

The command attempts one bracketed paste into the current editor. If the paste reaches the editor and Enter submits it, any existing draft is
submitted too. Check for drafts and dialogs with
`opencove agent read --node <selector> --screen` before sending a prompt.
After a successful prompt, save its `turnId` and use `opencove agent wait --node <selector> --turn <turnId>`,
then read its final message.

## Supported agent windows

Only agent windows OpenCove launched from a task, the agent launcher, or
`opencove node create agent` are promptable. Their PTY was spawned for the agent
process; agent exit ends that PTY and OpenCove generates its full argument vector.
Agents typed into terminal shells, including terminal shim/launcher invocations,
refuse for both providers with `agent.prompt_unsupported` / `terminal_agent_unsupported`.
A Stop, reliable idle, or installed lifecycle hooks cannot change that launch kind.
Missing legacy launch provenance also refuses. Terminal invocation metadata still
supports observation and session identity; it grants no prompt capability.

Managed launches with a custom executable path (Settings → agent executable) report
`hookCoverage: unverified_executable` for both Claude Code and Codex and refuse with
`agent.prompt_unsupported` / `executable_override_unverified`. OpenCove cannot verify
that a custom executable keeps the hooks required for prompting. This includes overrides
that happen to name a direct provider binary. Remove the override and launch a new agent
window with the required lifecycle hooks to make it promptable; changing the setting
does not change an already running invocation's coverage. Hook installation and run-state
observations are unchanged.

Option-like model/resume values also have no verified lifecycle coverage: Codex reports
conservative `notify_only` coverage and Claude reports `none`.
The default provider executable must honor the generated argv; OpenCove cannot attest
arbitrary code substituted on PATH. Generated Codex hook configuration takes precedence
over lower config defaults, while disabled matching handlers fail trust resolution.
Requested environment, including CODEX_HOME, is included in the trust probe. No user
configuration is modified to force hooks on.

## Supported providers and invocation coverage

| Provider | Required for this invocation | Readiness and receipt |
| --- | --- | --- |
| Claude Code | Installed lifecycle hooks, `hookCoverage: lifecycle` | Selected reliable `claude_hook` Stop or StopFailure; `claude_hook` UserPromptSubmit receipt |
| Codex (macOS/Linux) | Trusted lifecycle hook configuration actually passed at launch, `hookCoverage: lifecycle` | Selected reliable `codex_hook` Stop; `codex_hook` UserPromptSubmit receipt |

Both require idle with no active turn and bracketed paste enabled. `installed` alone
is insufficient. Trust resolution failure leaves Codex with `notify_only` coverage;
notify cannot observe submissions or permission requests. Daemon reuse (`skipped`),
Windows (`not_required`, session files), no hooks (`none`), and file-only readiness
refuse with `agent.prompt_unsupported`. Reasons are `codex_hooks_notify_only`,
`codex_hooks_skipped`, `codex_hooks_not_required`, `codex_hooks_not_installed`,
`codex_hooks_partial`, `codex_hooks_error`, `codex_hooks_missing`, or
`codex_lifecycle_observation_missing`. Missing Claude coverage reports
`claude_hooks_missing`. Legacy launches without coverage fail closed.

Codex PermissionRequest is observed as waiting and refuses with `agent.blocked`,
including zero paste/submit attempts. Conversational questions in the normal editor
are distinct from modal dialogs: Codex has no dedicated hook for every question or
notice. Coverage names the configured events, not proof that every blocking surface
is observable. The strict fixture verifies our protocol and delivery path, not a
particular real Codex version. Real CLI acceptance is still required.

## What success means

A successful result contains:

```json
{
  "deliveryId": "…",
  "nodeId": "…",
  "sessionId": "…",
  "phase": "submission_observed",
  "turnId": "…",
  "textComparison": "matched",
  "comparisonProfile": "claude-code-v1",
  "promptId": "…"
}
```

OpenCove received a token-authenticated UserPromptSubmit with a range-checked,
caller-supplied relay timestamp at or after the pre-Enter boundary, and matching
source/sequence/identity checks described below.
`phase` always stays `submission_observed`. `textComparison` describes only the
hook's submitted text evidence:

- `matched`: both private digests are present and equal under `claude-code-v1`.
- `different`: both digests are present and unequal. This is uncertainty, not a
  delivery failure or proof of an existing draft. The CLI still exits **0** and
  prints a notice on stderr, including when stdout is filtered with `--fields`.
- `unavailable`: the receipt has no usable digest (missing, malformed or oversized
  prompt metadata, or a legacy relay). Codex always reports `unavailable` until a
  Codex comparison profile is verified.

For Claude Code, `comparisonProfile: claude-code-v1` is included even when evidence
is unavailable. It means equality **modulo newline representation and trailing
ASCII whitespace**: first CRLF and CR become LF; then space, tab and LF are removed
from the end of the whole text. Leading and interior whitespace, Unicode normalization
forms, NBSP and other characters remain significant. Transport canonicalization is
unchanged. This profile was verified through real PTY delivery for **Claude Code
2.1.319**, covering three/five lines, 900 characters, edge spaces/tabs, an interior
blank line, Unicode, a literal paste marker and CRLF. Other releases, configurations,
wrappers, images and multimodal payloads are not attested by this text comparison.

The provider's optional `promptId` is returned on any comparison outcome when valid.
For Claude Code, matching session and prompt IDs also bind retained Stop/StopFailure
messages to the observed start. `agent.finalMessage` can select that provider ID;
the CLI uses the OpenCove `turnId` returned by `agent prompt`. Codex has no comparison
profile or hook-carried final-message support in this cut.

Equality is not proof of causation or model processing: another qualifying submission
of identical text also matches, and another hook may block processing after this
observation. Nor does it prove the turn finished. Use `agent.turn_completed`
separately to observe an outcome. Public events contain no prompt ID or message text.
There is no delivery-status store or idempotency key.

On `different`, **stop automatic orchestration**, retain the delivery, session, turn
and optional prompt identifiers, and inspect the terminal/conversation with
`opencove agent read --node <nodeId> --screen`. Decide explicitly whether to continue,
correct or cancel. **Never resend, clear the editor, press Enter again or cancel a
running turn automatically because of the comparison.** The CLI notice is:

> Claude Code reported a submitted prompt whose text differs from what you sent — an existing draft may have been included. Do not resend; check the agent with `opencove agent read --node … --screen`.

## When nothing is sent

| Condition | Error | Next step |
| --- | --- | --- |
| The agent is waiting for input, even when the reason is unknown | `agent.blocked` | Resolve the dialog in the terminal. |
| The agent is working | `agent.busy` / `working` | Wait for the turn to finish. |
| Another delivery is in progress | `agent.busy` / `delivery_in_progress` | Wait for that delivery's result before deciding whether another is needed. |
| OpenCove has not observed a completed turn | `agent.state_unknown` / `readiness_unobserved` | Complete a turn in the terminal first. |
| Hook observations are unavailable or unreliable | `agent.state_unknown` / `observation_degraded` | Check the hook setup and wait for a reliably observed turn end. |
| No running agent exists at the target | `agent.not_running` | Check the node and start or resume its session. |
| The agent window uses a custom executable path | `agent.prompt_unsupported` / `executable_override_unverified` | Remove the override in Settings → agent executable and launch a new agent window with lifecycle hooks. |
| The target is an agent typed into a terminal | `agent.prompt_unsupported` / `terminal_agent_unsupported` | Launch an agent window from a task, the agent launcher, or `node create agent`. |
| The target is remote or uses another provider | `agent.prompt_unsupported` | Select a local agent window OpenCove launched. |
| The terminal has not enabled bracketed paste | `agent.prompt_unsupported` / `bracketed_paste_off` | Check that the agent is at its prompt. |
| The timeout expires before the paste attempt | `agent.prompt_timeout` | Check the target, then retry if appropriate. |

These refusals describe this call only. They do not cancel another delivery.
`agent.not_running` can also report cancellation before delivery, such as caller
revocation, shutdown or a changed target; check `details.reason`.

## Recovering from a failed or uncertain delivery

- `agent.prompt_interrupted`: a paste was attempted, but this command did not
  attempt Enter. Text may be in the editor. Inspect it and resolve any dialog
  before continuing; do not paste the same text again if it is already there.
- `agent.prompt_stalled`: Enter was attempted, but OpenCove could not confirm
  a matching submission event. **Do not resend.** Inspect the terminal and conversation to determine
  whether the prompt was submitted.
- A lost connection, interrupted CLI, invalid response or Worker restart can leave
  the outcome unknown. Treat this as a potentially submitted prompt, not as proof
  that nothing was sent.

Service delivery errors contain `details.reason`, `pasteDispatchAttempted`,
`submitDispatchAttempted` and `retryable`. The flags describe attempted writes,
not confirmed receipt by the terminal. Validation errors and transport failures
may not contain those details. Never infer false flags from missing fields.

The CLI returns 0 for every observed submission, including `different` and
`unavailable`. It returns 1 for a refusal or unconfirmed delivery, 2 for invalid input, 124
for the overall deadline, and 130 for interruption. A deadline after a paste or
Enter attempt preserves that phase's error and attempt flags. The separate
five-second submission-observation limit returns `agent.prompt_stalled`, exit 1,
unless the overall deadline has also expired.

## Known risk: dialogs that hooks do not report

OpenCove cannot detect every dialog from hook events. In the maintainer's local
acceptance with Claude Code 2.1.319 and a local Messages API stand-in, a one-time
settings notice consumed the paste and Enter without a hook reporting the modal.
No qualifying submission event arrived. OpenCove returned `agent.prompt_stalled`
with the instruction not to resend.

This is a concrete limit of the observation model: an apparently ready session
can still contain an unseen dialog. Inspect and resolve the notice, then check
the editor and conversation before deciding what to do next. Do not automatically
resend after a stalled result.

Maintainer-reported acceptance on that same version and local stand-in used
`tests/e2e/agent.prompt.real-claude.spec.ts`: a three-line prompt arrived as one user message, and an open `AskUserQuestion` dialog was observed as `waiting`
with `blockedReason: null` and refused with `agent.blocked` without prompt bytes.
Its passing setup marks
one-time notices as seen; it is not an automated regression for the swallowed-input
variant. These results cover the tested release and environment, not every Claude
Code version or platform.

## Input and timeout

The Control Surface operation is `agent.prompt`, with exactly one of `nodeId` or
`sessionId`, plus `text` and optional `timeoutMs`. The timeout defaults to 15000 ms
and accepts integer values from 1 to 60000 ms.

Text must be valid Unicode, nonblank, and at most 32768 UTF-8 bytes before
normalization. Tabs and newlines are allowed. Other C0 controls, ESC, DEL and C1
controls are rejected. CRLF, CR and LF each become one carriage return per newline;
trailing newlines are removed. The entire text is sent as one bracketed paste.

## Submission-event checks and trust boundary

A qualifying event must be an accepted, non-degraded `claude_hook` (Claude Code) or `codex_hook` (Codex)
`UserPromptSubmit` for the same Worker lifetime, agent incarnation and target
binding, with a source sequence newer than the one captured before Enter and an
assigned turn ID. Its `x-opencove-hook-emitted-at` value must be finite, within
60 seconds before to 2 seconds after the receiver's current wall clock, and no
earlier numerically than the timestamp captured immediately before the Enter write.

The shipped relay records `Date.now()` before reading stdin or argv. Codex lifecycle
hooks use stdin; legacy notify uses argv. Both carry `x-opencove-hook-emitted-at`,
but notify can never serve as a submission receipt. However, the receiver
authenticates possession of the session's hook token; it does not authenticate the
relay executable or independently verify when the event occurred. Any holder of
the session's hook token can claim a submission and supply the timestamp. This contract assumes relay and Worker use the same wall clock without
adjustments; the receiver cannot establish whether that assumption holds. Missing or invalid timestamps can update
run state but cannot confirm delivery.

These checks reject late events with earlier timestamps. They do not establish
causation, exclude another human submission, distinguish events within one
millisecond, or establish when the provider triggered a delayed relay. Wall-clock
adjustments can misclassify older or newer events. Do not interpret a range-checked
timestamp as proof of event ordering under clock changes or untrusted token holders.

## Implementation owners and invariants

The Claude normalizer validates optional UserPromptSubmit `prompt_id` as a nonempty,
well-formed string of at most 256 UTF-16 code units without whitespace or control
characters. It hashes only full, well-formed string `prompt` values bounded by the
existing 256 KiB hook envelope budget; it never truncates before hashing. Optional
malformed fields are dropped without discarding valid lifecycle evidence. No trimming
string helper is used on prompt content. The digest is SHA-256 over UTF-8 of
`"opencove-prompt-evidence-claude-code-v1\0" + normalizedText` (the separator is a NUL).
Raw hook prompt text is discarded during normalization; prompt correlation stores no prompt content beyond transient parsing/delivery buffers and never logs it. A relay-truncated prompt has no digest.

The digest and prompt ID travel only through private, same-process channel metadata,
runtime ingress and reducer-accepted internal fence receipts. They never enter public
run-state DTOs, SSE events or logs. PromptDeliveryService computes the expected digest
from the delivered canonical text synchronously before the reserved input operation;
comparison never changes receipt qualification or adds an await before Enter.
There is no new durable state or restart reconstruction; metadata dies with its runtime.

The Worker prompt service owns the in-memory delivery intent and one reservation
per agent incarnation until settlement. The Hub owns the session input queue and
the writer valid within its reserved operation. The run-state registry owns
observation sequences and identity generations; they are not public snapshot DTOs.

Before paste, the service rechecks identity, caller authority, deadline, readiness
and bracketed-paste mode inside the reserved input operation. Readiness requires a
retained selected, non-degraded Claude `Stop` or `StopFailure`, or Codex `Stop`
turn-end receipt, current idle state from that source and no active turn. A later
same-source idle refresh (for example Codex notify or a Claude Notification) preserves
that receipt but cannot establish it. A Stop from an argv launch prompt establishes
readiness even without an observed turn start; it does not fabricate a completed-turn
event. New turns, lifecycle resets, unavailable observations and source changes revoke
the receipt; another qualifying Stop is needed. A notify `done`, SessionEnd, launch baseline or file observation never establishes prompt readiness.

Between paste and Enter, an accepted observation, identity change, loss of paste
mode, caller revocation, shutdown or deadline permanently cancels the remaining
write. Returning to idle does not undo cancellation. Both provider policies
waits 300 ms before Enter; this delay does not prove that every dialog has closed.

Immediately before Enter, the service captures fresh source watermarks and the
timestamp without an intervening await. Waiting for a receipt releases the input
queue and ends by the earlier of five seconds after Enter or the overall deadline.
Receipt callbacks recheck deadlines and caller authority, even if a timeout callback
has not run. Every delivery settles once; cancelled queued callbacks cannot write.

WebSessionManager owns cookie generation, expiry and revocation. Worker
`beginShutdown` aborts invocation authority synchronously before transport drain.
The HTTP invocation adapter removes its listeners and expiry timer on disposal.

The synchronous ingress tracker reads live output before batching or replay
truncation. Session/terminal replacements reset it. Its bounded parser state tracks
bracketed-paste mode using the pinned xterm VT500 rules, including fragmented
DECSET/DECRST, RIS, DECSTR, controls and string transitions. Parity tests compare its
mode with xterm. See [xterm's modes API](https://xtermjs.org/docs/api/terminal/interfaces/imodes/).
Automatic terminal protocol replies use a separate path and may bypass the input
queue. There is no automatic resend, raw-typing fallback or wait-until-idle queue.

## Reading the observed turn result

Retain `turnId` from the successful prompt response:

```sh
opencove agent prompt --node node-123 --text "Review the changes"
opencove agent wait --node node-123 --turn turn-123 --timeout 60s
opencove agent read --node node-123 --turn <turnId>
```

Replace `turn-123` with prompt's saved `turnId`. `wait --turn` waits for that exact
OpenCove turn, including permission/question pauses, even if another turn has started.
It returns `{ nodeId, sessionId, turnId, outcome, endedAt?, state }` and exits 0 for
every ended outcome (`completed`, `failed`, `aborted`, `unknown`); inspect `outcome`.
`read --turn` selects the same turn and never substitutes a transcript message.
History can be evicted between waiting and reading. An unknown/evicted turn or a
restart without retained evidence makes waiting fail with exit 1 and an `agent get`
hint. Timeout remains exit 124 with `lastKnown` on stderr. `--turn` requires one node
and conflicts with `--until`, multiple nodes and `--any`.

`lastEndedTurn` in the public snapshot retains the latest end's identity, outcome
and time while a newer turn runs. Older Workers omit it; the CLI treats it as null
and uses subscribed ended-turn events or local `agent.finalMessage` history when the turn
is no longer active. A `provider_sent_no_message` response also proves an end and
carries content-free `details.outcome` and `details.endedAt` (older Workers without
outcome report unknown). History fallback uses the existing interact scope.
`wait --until idle` remains available for node-level readiness, without selecting a turn.

`agent.finalMessage` is an interact-scope query accepting exactly one of `nodeId`
or `sessionId`, optionally exactly one of `turnId` or provider `promptId`. It returns
`{ nodeId, sessionId, turnId, promptId?, outcome, message, truncated, source: 'hook' }`.
The newest observed ended turn is selected by default, including when it has no
message; older messages are never substituted. Empty strings are present messages.
Unavailable results use `agent.final_message_unavailable` with `details.reason`:
`no_ended_turn`, `turn_not_found`, `turn_not_ended`, or `provider_sent_no_message`.

An unqualified `agent read --node …` tries this query first. Only `no_ended_turn`
or `provider_sent_no_message` permits fallback to `session.finalMessage`, labelled
`source: 'transcript'`. That reply is the latest provider transcript message and
is **uncorrelated** with an OpenCove turn. Authorization, transport and other errors
are returned directly. `--screen` reads buffered terminal output for inspection.

This is the message at an **observed OpenCove turn end**, not proof of irrevocable
provider completion: another Stop hook may continue processing. StopFailure keeps
outcome `failed`; text does not imply success. Claude Code 2.1.319 supplies matching
`session_id`/`prompt_id` and `last_assistant_message`. Missing/malformed IDs preserve
legacy state transitions but withhold exact message content. Conflicting identified
ends, overlapping different starts and replayed retained IDs are ignored before
changing authoritative state. Overlapping Claude turns are unsupported.

The generated relay reads at most 8 MiB. Above the 256 KiB POST budget it shrinks only
`last_assistant_message` and `prompt` to 16 KiB UTF-8 prefixes, setting the corresponding
`<field>_truncated: true`. This conservative prefix budget allows worst-case JSON
escaping of both fields. Unshrinkable or over-hard-cap bodies retain the prior drop
behavior. The receiver keeps its 256 KiB body limit; normalization separately bounds
assistant content to 64 KiB UTF-8 at a code point boundary and preserves truncation.

Remote exact waits use mirrored snapshots and events (the latest retained end),
without routing history across Workers. When an older remote turn is no longer
active or the mirrored `lastEndedTurn`, unavailable history reports
`agent.wait_turn_unavailable` with `details.reason: remote_history_unavailable`.
Check older remote turns on the Worker that runs the agent; this is not eviction.

The executing Worker registry owns at most eight ended records and 512 KiB of message
text per agent incarnation, evicting oldest whole records. Content is private memory,
never persisted, mirrored, logged or included in snapshots, SSE events, or receipt
rings. Replacement, retirement and Worker disposal release it. Node lookup uses only
the current binding; an old exited session can be queried explicitly until retired.
Replies may quote user content. Access uses the existing coarse interact scope, not
a new project/target ACL; read-tier callers cannot retrieve this store. Remote hook
history is unavailable; remote transcript retrieval remains the separate fallback.
