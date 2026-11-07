# Agent run state

## Ownership and recovery

The executing Worker owns one `AgentRunStateRegistry`, composed in the Control Surface runtime.
Its lifetime is independent of HTTP listeners and renderer connections. Provider hooks, session-file
watchers, OpenCode status and PTY launch/exit feed the application ingress adapter. The domain reducer
reuses `resolveAgentRunStateAuthority`; transport and consumers do not choose between observations.

| State | Owner | Write entry | Restart truth |
| --- | --- | --- | --- |
| Private ended-turn history and message text | Executing Worker registry entry | Selected reducer-accepted turn ends | None; discarded on replacement/restart |
| Run snapshot and active turn | Executing Worker registry | Fenced provider observations and lease deadlines | New incarnation starts unknown |
| Event epoch and sequence | Executing Worker registry | Accepted snapshot/turn transition | New Worker epoch; re-query |
| Session-to-node/project/Space association | Registry binding projection | Initial durable read and successful workspace writes | Durable session binding, never node status |
| Durable node metadata | Existing workspace owner | Existing workspace mutations | Existing persistence |
| Badges and node status | Existing UI projection | Decided runtime snapshots and existing lifecycle projection | Not a run-state authority |

This change does not alter how `node.status` is persisted. Runtime observations stay separate; unknown
remains explicit in the Control Surface snapshot, not a new UI label or durable node status.
An unknown snapshot leaves the legacy UI observation/node-status projection unchanged. Persisted nodes alone do not create live
agent sessions. A session needs live provider metadata or a provider observation before registration.

## Invariants

- **I1:** One arbiter decides agent run state for renderer, plugin host and Control Surface. The
  PtyStreamHub broadcasts the registry's decided snapshot; renderer caches it without arbitration.
  Plugin `agents.get` and `terminals.get` read the same registry through the hub.
- **I2:** Completion requires a turn start observed or inferred in the same incarnation. A plain
  working refresh, SessionStart or idle baseline cannot manufacture a completed turn. Prompt submit,
  task_started, agent_start and busy are trustworthy starts. Explicit failed/aborted outcomes stay
  distinct; PTY exit without an outcome ends an active turn as unknown.
- **I3:** Unknown and degraded observations never become idle. A wait-for-idle consumer must require
  `state === 'idle'` and non-degraded quality. Missing evidence, a stale working lease or an unsupported
  remote source must not satisfy it.

The legacy PTY state field retains working/waiting/standby for compatibility. New consumers use
`agentRunState` (the full snapshot). For unknown it accompanies `degraded: true` and
`observationUnavailable: true`; renderer retains its previous UI projection rather than treating the
legacy working placeholder as a decision. Completion cues consume decided turn transitions directly,
so a coalesced React render cannot erase a completed turn. An idle baseline never triggers a cue. Exit is explicit in the snapshot and existing PTY lifecycle. Reconnect
caches retain only the latest decided projection, not a set of competing raw sources.

## Observation and turn boundaries

The ingress adapter assigns a monotonic sequence before registry fan-out. The domain fences by source
sequence and incarnation, not timestamp equality: distinct events may share one timestamp. Evidence
older than its source’s accepted timestamp or the current turn boundary is rejected before arbitration.
A PTY exit remains a lifecycle fact even if the Worker clock moves backwards. Replayed
registry observations must retain their sequence. Existing hook credentials and watcher-generation
fences remain in place; Pi also rejects stale conversation revisions. Sources without an event ID
cannot provide end-to-end exactly-once delivery; the HTTP runtime sequence is the consumer cursor.

Session-file history is a baseline. Appended Codex task_started/task_complete/turn_aborted records
carry explicit boundaries. A selected, non-degraded session-file idle → working edge also starts an
inferred turn, and a subsequent selected idle observation completes that turn. A working baseline or
refresh alone never starts one. These decisions remain fenced by source sequence and incarnation. Pi agent_start/agent_settled snapshots carry explicit evidence, while heartbeats and
session_start do not. A coalesced pre-commit Pi snapshot may hide a start; in that case no completion is
invented. OpenCode busy/retry provides an inferred start. Its status API uses a sparse map: an absent
entry in a successful map response means idle, just like an explicit idle entry, and can end an
observed turn. Malformed status evidence remains unknown/degraded; an idle baseline never creates
a completed turn. Providers that only expose state
refreshes can still report state, but only a trustworthy boundary or the observed idle → working
edge can establish the turn required for completion.

The registry uses an injected cancellable scheduler. At `nextTransitionAtMs` it reevaluates existing
observations without replaying boundaries. Working hook lease expiry publishes unknown/degraded,
never completion. Renewal, exit, incarnation replacement and disposal cancel stale callbacks. Waiting
and idle hook authority follow the existing arbiter's rules and do not use the working lease.

## Queries and resumable runtime events

Both operations have read scope and validated field-level input schemas:

- `agent.get { nodeId }` or `{ sessionId }` returns the snapshot, or null when absent. Supplying both
  locators is invalid.
- `agent.list { projectId?, spaceId?, state? }` returns `{ epoch, seq, agents }` for live sessions.
  Exited sessions are excluded. Project and Space filters use the durable session binding projection.

To avoid losing changes between query and subscription:

1. Query `agent.list` and retain its `epoch` and `seq`.
2. Open authenticated `/events?stream=agent&epoch=<epoch>&afterSeq=<seq>`.
3. Optionally add `types=agent.state_changed,agent.turn_completed`, `nodeId` and `spaceId` filters.
4. Apply events in sequence order. On `resync_required`, re-query `agent.list` and reconnect with the
   new watermark.

`types` containing an agent event, `epoch`, or `afterSeq` also selects the runtime stream. Without
runtime selection, `/events` retains its existing durable synchronization behavior. The two streams
never mix counters. Runtime events carry `{ epoch, seq, snapshot }` and use `epoch:seq` as the SSE ID.
Clients resume with explicit query parameters; durable `afterRevision` is not a runtime cursor.

The Worker-wide sequence is assigned before filtering; gaps in filtered delivery are normal. Retention
is bounded to 1024 events. An old/future cursor, changed epoch, or afterSeq without epoch sends
`resync_required` with `query: 'agent.list'`, then closes the stream. Malformed cursors/filters return
400. With no cursor, subscription begins at the current watermark. Replay and listener registration
are synchronous; reentrant delivery is serialized and snapshots are cloned. Disconnect, listener
replacement and Worker shutdown release subscriptions; slow SSE consumers are disconnected and can
resume from their last accepted cursor.

Binding changes retain the previous node/project/Space association in the event ring. If a session
leaves a subscriber's binding filter, that subscriber receives `resync_required` and must re-query,
even when its `types` filter excludes state changes. This applies to live delivery and replay from a
query watermark, including node unbinding. Subscribers in the new scope receive the new snapshot.

Turn-end events include `endedTurn` because the snapshot has cleared its active turn. Inspect
`turnOutcome`: the event name `agent.turn_completed` denotes a turn boundary, not proof of success.

## Current node binding and retirement

Node lookup uses an explicit current node-to-entry binding. Replacement switches that binding before
notification. The old exited session remains queryable by session ID until retirement; node lookup
never searches historical entries. Successful durable writes update bindings without writing runtime
state back to persistence. Queries do not rebind sessions.

`retire({ sessionId, incarnation })` removes only the matching exited incarnation. It releases a node
binding only when that binding still points to that entry, so delayed cleanup cannot detach a newer
session. Reusing a session ID replaces its incarnation. Worker disposal cancels leases and clears
bindings, retention and subscriptions.

## Mounted sessions

The authenticated Worker PTY connection negotiates `agentRunEvents: 1` in its hello/ack. Supported
Workers send a runtime baseline and subsequent decided events on that ordered connection. Runtime
frames have their own registry epoch/sequence, independent of PTY replay offsets and durable revision.
Home maps remote session IDs to proxy sessions, keeps its own node/project/Space bindings, and mirrors
the executing Worker's state, quality, turn identity, transition time and outcome without arbitration
or local lease timers. Mirrored events receive Home's epoch/sequence for Home clients to resume.

An unsupported peer or disconnected stream reports unknown/degraded while its PTY remains live.
Home never arbitrates raw remote hook/file observations. Reconnect resumes from the remote cursor;
duplicate events are ignored, while unexpected gaps or malformed frames invalidate the mirror and
restart synchronization. Replaced sockets cannot update the mirror. Retention overflow or epoch
change sends `agent.resync_required` followed by a fresh baseline; a baseline never manufactures a
historical completion. `agent.ready` confirms synchronization before cached snapshots are restored.

State and turn-end frames share the PTY connection so remote turn boundaries precede the corresponding
PTY exit. Only the executing Worker emits a turn end; Home's exit handling does not synthesize one.
Socket closure releases the remote registry subscription; forgetting an exited proxy releases its
cached snapshot. Slow sockets disconnect and use the same resume/resynchronization protocol.

## Internal prompt fences

The registry exposes an internal RunStateFencePort for [prompt delivery](PROMPT_DELIVERY.md).
It contains Worker epoch, entry incarnation token, binding generation, selected source/event name,
active turn, accepted per-source sequence watermarks and a receipt cursor. These fields are not
added to public DTOs. Receipts preserve hook event names through runtime ingress and are emitted
for every reducer-accepted observation, including unchanged snapshots. Synchronous registration
and bounded replay close the query/watch gap; unavailable history invalidates rather than inventing
acceptance. Replaced entries, binding ABA, capability changes, lease expiry and disposal invalidate
pending delivery. Only a fresh accepted claude_hook UserPromptSubmit above the submit fence can
establish submission observation; session-file optimism cannot do so.

## Invocation hook coverage

Launch planning owns `hookCoverage` (`lifecycle`, `notify_only`, `none`, `unverified_executable`) next to
`hookInstallState`. Managed launches and terminal shim invocations carry it as runtime
metadata into the registry's internal RunStateFencePort. It is not a public run
snapshot field or a durable workspace fact. New incarnations reset it; hook or file
observations cannot infer or upgrade it. Missing legacy metadata remains unsupported.

Codex reports lifecycle only when its trusted lifecycle configuration is passed;
trust failure reports notify_only, and daemon reuse, Windows and absent hooks report
none. Claude Code reports lifecycle when its hook settings are installed. Installation
and coverage are separate: installed notify may inform run state but cannot establish
promptability. See [prompt delivery](PROMPT_DELIVERY.md) for provider requirements.

## Retained turn-end evidence

The run-state reducer retains the last selected, reliable explicit turn-end receipt
in the current idle interval. The internal fence exposes `lastTurnEnd` independently
of each source's latest observation; same-source idle refreshes preserve it. Refreshes
alone never establish readiness. Non-idle/active turns, source changes and invocation
lifecycle resets clear the evidence. Synthetic shell-only idle is a reset, not a turn end.

A selected Stop may establish readiness for a launch prompt whose start was not
observed. It still emits no `agent.turn_completed` without an active turn (I2).
The receipt is runtime-only, cleared by new incarnations and remote mirroring;
public snapshots, completion events and durable workspace state are unchanged.

## Launch provenance and prompting

`AgentLaunchKind` is runtime metadata: headless PTY spawn with `agentProvider` supplies
`managed`; the terminal invocation registry behind the gateway always supplies
`terminal`. The run-state runtime carries it to the internal fence. Provider hooks,
Stop evidence, durable node kind and renderer labels cannot infer managed provenance.
A terminal invocation cannot be upgraded by a later metadata refresh. New incarnations
clear missing provenance; remote sessions remain unsupported.

Prompt admission requires managed provenance before readiness checks. Only local Claude
Code/Codex agent windows OpenCove launched are eligible. Agents typed into shells refuse
with `terminal_agent_unsupported`, including when a suspended/killed agent leaves stale
Stop evidence and the foreground scanner reports shell-only. Gateway coverage metadata
remains useful for observation but never authorizes prompting.

## Private observed-end messages

`agent.finalMessage` (interact scope) reads private per-incarnation ended history;
`agent.get/list` and `agent.state_changed` / `agent.turn_completed` remain content-free.
The registry inserts history synchronously before notifying fences or publishing the
completion. It retains at most eight ended turns (`turnId`, optional `promptId`,
`outcome`, `endedAt`, optional message/truncation) and 512 KiB of UTF-8 text, evicting
oldest whole records. Entry replacement, retirement and disposal release the store.
No durable state, receipt-ring content, remote mirroring or restart reconstruction
is added. Node lookup never searches old incarnations.

Claude start identity is private: provider session, validated prompt ID, and the
relay emitted-at time of the accepted UserPromptSubmit that opened the turn
(`x-opencove-hook-emitted-at`, range-checked at ingress). Duplicate submits and
state refreshes do not replace that start time. A conflicting identified end is
rejected before source replacement/arbitration. A distinct-prompt UserPromptSubmit
in the same provider session may supersede the active turn only when both relay
emitted-at times are present and the candidate is strictly later. Missing, equal,
or older times reject the conflicting submit; Worker arrival time/source sequence
cannot stand in for relay-time ordering. This freshness fence belongs to the active
identity and survives eviction of ended-message records: replaying an evicted old
submit with its original timestamp cannot supersede live work, and its conflicting
Stop cannot grant readiness. Retained-ID rejection applies even to newer timestamps.
A trustworthy newer submit atomically ends the active turn as unknown (no content)
and opens the new turn. This recovers a missing Stop, including user interruption or relay loss,
without inventing reliable idle evidence. The supersession completion carries the
old endedTurn and outcome unknown while its snapshot already shows the new active
turn. The reducer still enforces incarnation, sequence, timestamp and authority
fences. Late ends for retained superseded identities are ignored even when idle;
replayed retained identities cannot reopen or replace a result. Missing IDs preserve
legacy run state but cannot serve correlated content.
Only a matching selected reliable Stop/StopFailure can attach message text. Baseline
Stop, lease expiry, notify and arbitrary payloads cannot manufacture ended history.
PTY exit may end an active turn as unknown, without hook content. Stop is an observed
boundary; other provider hooks may continue it, and StopFailure remains failed.

The query accepts one node/session locator and optionally one OpenCove `turnId` or
provider `promptId`. It selects only the newest ended turn by default, even if that
turn lacks content. Errors distinguish no ended history, unknown selected turn,
active selected turn and no provider message; eviction cannot be distinguished from
an unknown turn. Empty content is present. See [prompt delivery](PROMPT_DELIVERY.md)
for budgets, errors, coarse interact access, and the `prompt → wait --until idle →
read --turn <turnId>` loop. Idle waiting does not guarantee which turn ended.
