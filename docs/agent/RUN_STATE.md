# Agent run state

## Ownership and recovery

The executing Worker owns one `AgentRunStateRegistry`, composed in the Control Surface runtime.
Its lifetime is independent of HTTP listeners and renderer connections. Provider hooks, session-file
watchers, OpenCode status and PTY launch/exit feed the application ingress adapter. The domain reducer
reuses `resolveAgentRunStateAuthority`; transport and consumers do not choose between observations.

| State                                             | Owner                           | Write entry                                                 | Restart truth                              |
| ------------------------------------------------- | ------------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Private ended-turn history and message text       | Executing Worker registry entry | Selected reducer-accepted turn ends                         | Separate Worker archive for exact turns    |
| Run snapshot, active turn and last ended identity | Executing Worker registry       | Fenced provider observations and lease deadlines            | New incarnation starts unknown             |
| Event epoch and sequence                          | Executing Worker registry       | Accepted snapshot/turn transition                           | New Worker epoch; re-query                 |
| Session-to-node/project/Space association         | Registry binding projection     | Initial durable read and successful workspace writes        | Durable session binding, never node status |
| Durable node metadata                             | Existing workspace owner        | Existing workspace mutations                                | Existing persistence                       |
| Badges and node status                            | Existing UI projection          | Decided runtime snapshots and existing lifecycle projection | Not a run-state authority                  |

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
legacy working placeholder as a decision. Completion cues consume `lastEndedTurn.id` once per session,
never UI working/standby edges. Cached delivery seeds deduplication without a cue. Exit is explicit in
the snapshot and existing PTY lifecycle. Reconnect caches retain the latest decided projection.

## Blocking dialogs

`waiting` means a live block, not an unacknowledged completed turn. `blockedReason`
is `permission`, `question`, `plan`, or null. PermissionRequest takes precedence over
its tool name. Claude Notification maps permission_prompt to permission and
elicitation_dialog / elicitation_url_dialog to question. agent_needs_input is
ambiguous and contributes no reason. Notifications never create turn boundaries.

Within a same-source blocking episode, empty refreshes preserve reason and summary;
permission remains the highest-priority reason. A selected trustworthy start/end/reset,
resolution to working/idle, exit, incarnation replacement or conversation-generation
reset clears the episode. Lower-priority file observations cannot resolve a hook dialog.

`blockedSummary` is nullable, optional for older Workers, and runtime-only. Questions
use `{kind: "question", questions: [{question, options: [label]}]}`: at most three
questions, four labels each, and 200 Unicode code points per string, including a
trailing `…` on truncation. Malformed entries are omitted. ExitPlanMode uses only
`{kind: "plan"}`; no plan content or path is exposed. A permission block may retain a
question summary because approval and answering the question are different steps.
Only JSON outputs carry this untrusted dialog data; it never changes readiness,
asks the CLI to act, or appears in the wait error message/hint.

## Observation and turn boundaries

The ingress adapter assigns a monotonic sequence before registry fan-out. The domain fences by source
sequence and incarnation, not timestamp equality: distinct events may share one timestamp. Evidence
older than its source’s accepted timestamp or the current turn boundary is rejected before arbitration.
A PTY exit remains a lifecycle fact even if the Worker clock moves backwards. Replayed
registry observations must retain their sequence. Existing hook credentials and watcher-generation
fences remain in place; Pi also rejects stale conversation revisions. Sources without an event ID
cannot provide end-to-end exactly-once delivery; the HTTP runtime sequence is the consumer cursor.

Session-file history folds to one baseline across chunks, partial records and file replacement;
it cannot start or end turns or override live work. New invocations read their new file as live.
Terminal invocation intent is independent of verified identity; watchers use the current invocation's
verified ID, never a prior durable binding. Identity discovery preserves the cursor. Resumed Codex files
are located by ID, regardless of date/mtime. Codex SessionStart publishes identity only. Appended Codex task_started/task_complete/turn_aborted records
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
`resync_required` with `query: 'agent.list'`, then closes the stream. Malformed cursors/filters return 400. With no cursor, subscription begins at the current watermark. Replay and listener registration
are synchronous; reentrant delivery is serialized and snapshots are cloned. Disconnect, listener
replacement and Worker shutdown release subscriptions; slow SSE consumers are disconnected and can
resume from their last accepted cursor.

Binding changes retain the previous node/project/Space association in the event ring. If a session
leaves a subscriber's binding filter, that subscriber receives `resync_required` and must re-query,
even when its `types` filter excludes state changes. This applies to live delivery and replay from a
query watermark, including node unbinding. Subscribers in the new scope receive the new snapshot.

Public snapshots include `lastEndedTurn: { id, outcome, endedAt } | null`: the most
recent turn ended by the reducer in this incarnation. The end transition sets it
atomically, including supersession and PTY exit (unknown outcome). It persists across
subsequent starts, refreshes and degraded states, and resets on a new incarnation.
No idle baseline or degraded observation invents an end. `endedAt` uses the accepted
end observation's epoch milliseconds, including exit even if the clock moved backwards.
The legacy `turnOutcome` is unchanged: ends set it, ordinary starts clear it, and
supersession sets unknown while opening the next turn. Use `lastEndedTurn.outcome`
when correlating an end's identity; the two fields can differ while a new turn runs.
The field carries no content, prompt text or provider prompt ID and flows through
get/list, events, remote mirrors and UI snapshots. Shared snapshot/event/frame
schemas accept additive fields; older Workers without it normalize to null.

`snapshot.nodeId === N` if and only if this Worker's binding for N points to that
session. Null means unbound or displaced, including a displaced session that is
still live. A move from S to R clears S's nodeId and queues an ordered
`agent.state_changed` for S before R's claim event. Both payloads are captured
before any fence/listener callback. Re-binding S publishes its nodeId again; a late
exit/retirement of the displaced session cannot detach the current owner.
`agent.get {sessionId}` still returns the displaced session with nodeId null.
Live list rows may be unbound; the CLI gives these rows title null rather than the
current owner's node title. Node-filtered subscriptions resync when S leaves N.

CLI waits resolve requested nodes through binding-aware `agent.get` and reconcile one
global stream with post-get and post-subscription watermarks. Distinct conflicting
sessions trigger one get per observed binding interval; only current-owner events
update selected state. Negative-history reads drain their fence before failing.
See [wait semantics](WAIT.md) for exits 10/11, fulfilled progress, exact-turn recovery
and the remote-ready limitation. Initial satisfied conditions remain immediate.
The registry captures and queues both state and completion payloads before notifying
fences, so reentrant starts/ends cannot overwrite a prior completion's snapshot.
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
Home's snapshot nodeId follows Home's own proxy binding, not the executing
Worker's canvas node ID. A remote displacement frame is still cached/routed by
session and does not erase an independently current Home binding. When Home moves
that binding, it publishes the same local null/claim sequence; later old-session
remote frames cannot restore it. PTY, Web and renderer state routing is session
based, so displaced-session events cannot update a replacement node. Prompt fences
invalidate on displacement (binding generation and nodeId); current-node admission
reads the new binding. Explicit session lookup remains available.

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
trust failure reports notify_only, and opt-in daemon reuse, Windows and absent hooks report
none. Claude Code reports lifecycle when its hook settings are installed. Installation
and coverage are separate: installed notify may inform run state but cannot establish
promptability. Codex daemon reuse is disabled by default; enable
`codexReuseRunningAppServer` in Agent → Codex settings to accept degraded observation and
unavailable prompt delivery when the shared daemon is reachable. See [prompt delivery](PROMPT_DELIVERY.md) for provider requirements.

For Codex lifecycle coverage, runtime ingress discards legacy `notify` before it can replace
hook observations or the legacy UI projection. Stop/StopFailure own turn ends; notify cannot
alter state, active turn, outcome or retained `lastTurnEnd`. For `notify_only`, notify remains
an explicit completion signal. The relay preserves a validated, content-free `turn-id`;
native hook `turn_id` uses the same validation. Private channel evidence carries these IDs
to the registry, which rejects notify before arbitration when it conflicts with a known active
provider turn/session. Missing IDs retain uncorrelated fallback behavior. These IDs do not
enter public snapshots, receipts or durable state.

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
completion. Remote wait --turn uses mirrored snapshots/events only; older remote
turns must be checked on the Worker that runs them. Exact remote history requests
report `remote_history_unavailable`, without implying eviction or restart. No
cross-Worker history routing is added. Local memory retains up to 60 ends and 512 KiB per
incarnation, evicting whole records. Replacement/retirement/disposal release that cache;
exact reads also query the separate Worker archive. Every record stamps its launch node, or otherwise its binding at the turn end,
never its read-time binding. Prompt-ID selectors retain their eight-end window. Membership, age and revocation apply
to memory too. No content enters receipt rings or remote mirroring; archive lookup never
reconstructs readiness. Unqualified node lookup still selects the current incarnation.

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
Stop and lease expiry cannot manufacture ended history; notify and arbitrary payloads
cannot attach message text.
PTY exit may end an active turn as unknown, without hook content. Stop is an observed
boundary; other provider hooks may continue it, and StopFailure remains failed.

The query accepts one node/session locator and optionally one OpenCove `turnId` or
provider `promptId`. It selects only the newest ended turn by default, even if that
turn lacks content. Errors distinguish no ended history, unknown selected turn,
active selected turn and no provider message; eviction cannot be distinguished from
an unknown turn. Empty content is present. See [prompt delivery](PROMPT_DELIVERY.md)
for budgets, errors, coarse interact access, and the `prompt (save turnId) →
wait --turn <turnId> → read --turn <turnId>` loop. Exact waiting uses the retained
snapshot identity, subscribed `endedTurn`, or ended history when the turn is no
longer active. `provider_sent_no_message` includes `details.outcome` and `endedAt`
and also proves an end. History fallback retains interact scope. Idle waiting
remains a node-level condition and does not identify which turn ended.

Recovery command hints put each shell-quoted command on its own indented line,
without trailing prose punctuation. Copying an exact-wait command preserves the
turn ID, including apostrophes and spaces; known node/session IDs remain literal.

## Claude queued continuations

See [Claude continuations and transcript recovery](./CLAUDE_CONTINUATIONS.md) for queue
reconciliation, transcript attachment, generation fences and readiness recovery.

## Archived exact turns

Exact local `agent read --turn` and `agent wait --turn` survive Worker/app restarts,
without relaunching the agent, and return the original node/session IDs. JSON includes
`persisted`; false includes `memoryOnlyReason` (`unbound`, `remote`, `unavailable`,
`write_failed`, `deleted`, or `retention_backlog`). Older Workers cannot certify it.
`archive_unavailable` is distinct from missing/expired history; never resend to recover it.

The executing Worker stores final reply text (≤64 KiB UTF-8), outcome, IDs, timestamps
and truncation/intermediate metadata in a separate archive file. It stores no prompt
text, hook evidence or S2 delivery records. S1 provider continuations archive once at
the final OpenCove end; uncertainty stays `unknown`/`messageKind: intermediate` and
never grants readiness or proves steering consumption. Retention upper bounds are
60 turns/node, 30 days, 20,000 global records and 128 MiB of message text; metadata-only
ends count. Smaller memory caches may evict earlier. Oversized purges leave new turns
memory-only (`retention_backlog`) while bounded cleanup makes room for future records.

Deleting the node removes queryable OpenCove history, including caches; it does not
erase provider transcripts, existing backups or forensic remnants.
`opencove agent history clear --node <selector>` (`agent.history.clear`, interact scope) deletes the node’s archived and in-memory replies across retained incarnations, leaving the node, provider transcripts, backups, run state, active turns and delivery records unchanged; later ends store normally, and archive unavailability clears memory but exits 1. Unqualified reads, prompt-ID selectors and labelled transcript fallback
retain current-incarnation semantics. Remote history is not routed across Workers.
