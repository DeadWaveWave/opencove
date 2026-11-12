# Read replies and inspect screens

Read tries the latest ended turn's agent.finalMessage first. `--turn <turnId>` selects exactly the
OpenCove turn ID returned by prompt: no prefixes, another turn or transcript fallback. Confirm
delivery, wait for the saved turn and check outcome before reading. All ended outcomes exit 0 when
waiting; ended does not mean successful. `--last` makes the latest-turn default explicit and may
accompany --turn.

## Read several agents

Repeat `--node` up to 10 times (IDs, names, unique prefixes, `@self` or `@parent`):

```sh
opencove agent read --node "Reviewer" --node "Lead"
opencove agent read --node "Reviewer" --node "Lead" --screen --lines 20
opencove agent read --node "Reviewer" --node "Lead" --fields node,ok,message,error
```

Multiple targets always return a JSON array in input order, including duplicates. Each entry has
`node` (the input selector), `ok`, and the same fields as a single read, or `ok: false` and `error`.
Selector and read failures are isolated. Exit 0 means every read succeeded; otherwise the first
failing target's exit code applies, so always inspect every entry. There is no separate partial-failure
exit code. `--turn` / `--expect-turn` and other exact-turn options are refused (exit 2); use separate
reads for saved turn IDs. `--last`, `--screen`, `--scrollback` and `--lines` apply to every target.
One target keeps the existing plain-text default and JSON shape. Existing per-target Worker reads
are used, including their transcript fallback and old-Worker error behavior.

## Correlated replies and archive

Claude and Codex lifecycle hooks supply exact-turn content with the same output contract. Codex
daemon reuse, notify-only coverage, file-only telemetry and Windows do not add correlated replies;
previously archived replies remain readable in those modes. Missing IDs provide no content. The
relay may shorten oversized hook payloads to a marked 16 KiB prefix before delivery; truncated
reports either that limit or the final 64 KiB cap.

Hook replies (≤64 KiB UTF-8), outcome and IDs are private. Exact archived local --turn reads/waits
survive restarts without a live agent and return the original session ID. Archive caps: 60
turns/node, 30 days, 20,000 global records and 128 MiB of message text. JSON includes persisted and
memoryOnlyReason when false; archive_unavailable differs from a miss. Deleting the node removes
OpenCove history, not provider transcripts or existing backups. No prompt text or delivery records
are archived. `opencove agent history clear --node <selector>` deletes a node's stored replies
(archive and memory) and keeps the node, transcripts, run state and deliveries; archive
unavailability clears memory but exits 1. Remote waits use mirrored snapshots/events; older history
requires the executing Worker. Local Claude hooks match session/prompt IDs; Codex lifecycle hooks
match session/turn IDs. Codex stores the first matching Stop reply that ends the local turn. Later
continuation cannot replace it; same-pair steering keeps that turn and does not clear waiting.
Missing IDs or hook coverage provide no exact reply. Archived replies remain readable regardless of
current hook coverage. Claude queued messages/provider follow-ups stay in one OpenCove turn; exact
reads return its final reply after continuations. An unknown continuation marks the last provider
reply messageKind: intermediate and prints a notice. An unqualified read selects only the latest
ended reply, including after a node-level idle wait. Check outcome; ended does not mean successful.

## Unqualified reads and recovery

Only a read without `--turn` falls back to the transcript when the hook reports `no_ended_turn` or
`provider_sent_no_message`, including restored conversations; other errors are preserved. An empty
or whitespace-only hook reply succeeds and wins. Unqualified reads never search older hook messages
and remain current-incarnation reads. --last makes the default explicit and may accompany --turn.
Exact-turn reads preserve `agent.final_message_unavailable` and `details.reason`: `turn_not_ended`
includes current state and blockedReason; waiting asks the user to resolve it in OpenCove, working
suggests an exact-turn wait; `turn_not_found` means unknown/evicted, `provider_sent_no_message`
means no correlated content, and `no_ended_turn` means no observed end. Exact errors include known
nodeId/sessionId/turnId and recovery commands: wait for turn_not_ended; agent get for
turn_not_found; --screen/session final for absent content/history. remote_history_unavailable means
older remote history requires the executing Worker, not eviction. Do not resend a prompt because its
reply is unavailable.

Read defaults to plain message text even when piped. `-o json` or `--fields` keeps structured
results, including `source: hook|transcript` and `truncated`. Hook JSON includes nodeId, sessionId,
turnId, optional promptId, deliveryIds, promptIds, outcome, persisted, optional
memoryOnlyReason/messageKind; transcript JSON keeps sessionId, provider, startedAt, cwd and
resumeSessionId with source: transcript and truncated: false. A truncated hook prefix prints one
stderr notice: look for the rest with `session final --session <sessionId>` (transcript) or `agent
read --node <selector> --screen`; neither guarantees the rest, and no automatic replacement occurs.

Transcript fallback and `session final` reject null/empty/whitespace-only messages with
`session.transcript_not_ready`, exit 1. If working, wait `--until idle` and read again. If already
idle after a completed turn, check provider transcript saving and inspect `--screen`; waiting cannot
create a transcript. Missing conversation: check selector/session, do not prompt just to create
output. Transcript reads may cache a discovered transcript identity.

## Retained turn identifiers

deliveryIds are retained correlations of OpenCove deliveries with this turn, including refused or
uncertain attempts. Membership proves neither submission nor consumption; inspect each deliveryId
with opencove agent delivery <id>. promptIds are the provider's own prompt IDs (Claude continuations
included); agent delivery does not accept them. Best-effort wait lookup failures omit IDs without
changing completion/outcome/durability. Resolved delivery records expire after 30 minutes and
existing capacity limits apply; restart clears them. Live history keeps up to 64 previous provider
prompt IDs plus the final ID; archives retain only the final prompt ID. Missing IDs never justify
resending.

## Screen inspection

```sh
opencove agent read --node agent-123 --screen
opencove agent read --node agent-123 --screen --lines 20 -o json
opencove agent read --node agent-123 --scrollback --lines 500
opencove agent read --node agent-123 --turn turn-123 -o json
opencove agent history clear --node agent-123
```

Screen reads replay the snapshot at its columns/rows, preserving cursor-created spaces, overwrites
and wide CJK/emoji cells. They select its normal/alternate buffer, ignore styling/modes, trim
row-end spaces and trailing blank rows, and return the last 40 rendered viewport rows by default.
`--scrollback` adds retained normal-buffer history (last 200 lines; `--lines` 1–5000); the active
alternate screen has no scrollback. Both work for plain terminals and agent windows.
JSON/projectable fields: nodeId, sessionId, lines. --lines requires --screen or --scrollback;
--screen and --scrollback conflict with each other and with --last and --turn. Reading never sends input or grants permission to answer
another agent's dialog.
