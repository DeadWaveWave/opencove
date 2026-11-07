# Sending a prompt to Claude Code

`opencove agent prompt` pastes text into a running local Claude Code session and
attempts to press Enter once. It never retries automatically.

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
After a successful prompt, use `opencove agent wait --node <selector> --until idle`,
then read its final message.

## What success means

A successful result contains:

```json
{
  "deliveryId": "…",
  "nodeId": "…",
  "sessionId": "…",
  "phase": "submission_observed",
  "turnId": "…"
}
```

OpenCove received a token-authenticated UserPromptSubmit with a range-checked,
caller-supplied relay timestamp at or after the pre-Enter boundary, and matching
source/sequence/identity checks described below.
This does not prove that this command caused the event, that Claude processed the
exact text, or that the turn finished. Use `agent.turn_completed` separately to
observe a turn's outcome. There is no delivery-status store or idempotency key.

## When nothing is sent

| Condition | Error | Next step |
| --- | --- | --- |
| The agent is waiting for input, even when the reason is unknown | `agent.blocked` | Resolve the dialog in the terminal. |
| The agent is working | `agent.busy` / `working` | Wait for the turn to finish. |
| Another delivery is in progress | `agent.busy` / `delivery_in_progress` | Wait for that delivery's result before deciding whether another is needed. |
| OpenCove has not observed a completed turn | `agent.state_unknown` / `readiness_unobserved` | Complete a turn in the terminal first. |
| Hook observations are unavailable or unreliable | `agent.state_unknown` / `observation_degraded` | Check the hook setup and wait for a reliably observed turn end. |
| No running agent exists at the target | `agent.not_running` | Check the node and start or resume its session. |
| The target is remote or uses another provider | `agent.prompt_unsupported` | Select a local Claude Code session. |
| The terminal has not enabled bracketed paste | `agent.prompt_unsupported` / `bracketed_paste_off` | Check that Claude Code is at its prompt. |
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

The CLI returns 1 for a refusal or unconfirmed delivery, 2 for invalid input, 124
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

A qualifying event must be an accepted, non-degraded `claude_hook`
`UserPromptSubmit` for the same Worker lifetime, agent incarnation and target
binding, with a source sequence newer than the one captured before Enter and an
assigned turn ID. Its `x-opencove-hook-emitted-at` value must be finite, within
60 seconds before to 2 seconds after the receiver's current wall clock, and no
earlier numerically than the timestamp captured immediately before the Enter write.

The shipped relay records `Date.now()` before reading stdin. However, the receiver
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

The Worker prompt service owns the in-memory delivery intent and one reservation
per agent incarnation until settlement. The Hub owns the session input queue and
the writer valid within its reserved operation. The run-state registry owns
observation sequences and identity generations; they are not public snapshot DTOs.

Before paste, the service rechecks identity, caller authority, deadline, readiness
and bracketed-paste mode inside the reserved input operation. Readiness requires a
selected, non-degraded Claude `Stop` or `StopFailure` observation, idle state and no
active turn.

Between paste and Enter, an accepted observation, identity change, loss of paste
mode, caller revocation, shutdown or deadline permanently cancels the remaining
write. Returning to idle does not undo cancellation. The Claude provider policy
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
