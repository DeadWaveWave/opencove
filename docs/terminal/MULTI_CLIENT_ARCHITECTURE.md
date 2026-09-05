# Multi-Client Terminal Architecture

OpenCove terminal sessions use worker-owned runtime and presentation state. Desktop and Web UI render locally as clients; correctness comes from Worker snapshot + stream replay, not from renderer cache. Web listener replacement is only a transport lifecycle and never replaces the Worker terminal owners.

## Current Runtime Shape

```text
PTY / Agent CLI output
  -> Worker PTY runtime
  -> PtyStreamHub
  -> TerminalPresentationSession
  -> Worker terminal recovery checkpoint (plain terminal only)
  -> session.presentationSnapshot
  -> client attach(afterSeq)
```

Key implementation files:

- `src/app/main/controlSurface/ptyStream/ptyStreamHub.ts`
- `src/platform/terminal/presentation/TerminalPresentationSession.ts`
- `src/app/main/controlSurface/handlers/sessionStreamingHandlers.ts`
- `src/app/renderer/browser/BrowserPtyClient.ts`
- `src/contexts/workspace/presentation/renderer/components/TerminalNode.tsx`
- `src/contexts/terminal/application/TerminalRuntimeAvailability.ts`

## Ownership

| State | Owner | Write path |
| --- | --- | --- |
| PTY process lifecycle | Worker PTY runtime | spawn/kill/exit callbacks |
| Terminal startup phase + epoch | Worker terminal runtime availability | startup scan/reconciliation/shutdown |
| PTY byte stream seq | `PtyStreamHub` | output append |
| Terminal presentation state | `TerminalPresentationSession` | PTY output applied in seq order |
| Presentation snapshot | Worker | `session.presentationSnapshot` |
| Replay baseline | Worker | `appliedSeq` from snapshot |
| Controller role + authority epoch | `PtyStreamHub` | `/pty` attach/control handoff |
| Browser socket generation + attach readiness | Browser PTY attach coordinator | exact current-socket hello/attached ACK |
| PTY geometry | Worker geometry transaction | controller request -> runtime ACK -> presentation commit |
| Terminal recovery generation/archive/binding/checkpoint | Worker terminal recovery owner | reconcile/output checkpoint/atomic retire/two-phase shutdown drain |
| Agent/Terminal Worker binding (`endpointId + mountId`) | Workspace node persistence | launch result -> node state -> SQLite; prepare/revive resolves it against topology |
| Terminal agent session binding | Workspace persistence | verified `provider` + resume identity record; an unverified provider remains a hint, never a resumable identity or durable node-kind rewrite |
| Ordinary-terminal Agent invocation generation/revisions/exit fence | Worker `TerminalAgentInvocationRegistry` | authenticated shim prepare/complete plus current provider hook observation; runtime-only, bounded, and never a PTY or persistence writer |
| Terminal agent overlay and run-state | Renderer run-state arbiter | one runtime projection from fresh hook > warm session-file > nothing; never terminal presentation or durable node truth |
| Terminal agent raw-source replay | `PtyStreamHub` session state | one timestamped runtime-only observation per source; replayed on attach and removed with the session |
| Desktop renderer state replay | Main remote PTY runtime | per-source transport mirror for reloaded subscribers; never reattaches or restarts the Worker PTY |
| Retrofitted agent session-state watcher | Renderer overlay lifecycle + Worker terminal session manager | attach once per bound live session; dispose on drop-back, node removal, or renderer owner teardown |
| Renderer backend health | client | local rebuild/resync |
| Visible output and dirty rows | xterm parser/renderer | ordered PTY bytes; never a geometry write path |
| Selection/local scroll/zoom | client | local UI only |
| Find overlay | client | local search state/decorations only |
| Applied terminal appearance | client terminal appearance owner | final-wins apply/refresh |
| Shared display reference | persisted settings owner | explicit/automatic reference update |
| Local display calibration | each renderer client | client-local automatic/manual calibrator |

### Terminal Agent Overlay Contract

A submitted, recognized agent command can project an existing `terminal` node as an Agent without
restarting its PTY. The durable node `kind`, node ID, session ID, and worker-owned terminal
presentation remain unchanged. Persistence stores a separate verified agent session binding, or only a
provider hint while identity is unknown. Renderer hydration reconstructs the overlay and reattaches the
session-state watcher in either case. Watcher metadata may promote a hint to a verified binding, but it
cannot replace a different verified durable identity.

Run-state replay (#337) and provider session resume solve different restart boundaries. Replaying
`working` / `waiting` / `standby` is useful for renderer reload and live reattach, but it is runtime-only and
does not survive a cold Worker restart. Cold resume is driven only by the durable verified binding: recovery
starts a fresh shell and enters the explicit provider resume command once. With only a provider hint,
recovery keeps the overlay, shows a manual-recovery notice, and sends neither a resume command nor a
new-agent command.

The renderer overlay lifecycle owns that watcher attachment. Clearing the overlay also clears its
binding and detaches the watcher; removing the node or disposing the renderer owner performs the same
detach. These are explicit clear/remove operations. By contrast, an authenticated invocation exit
changes only the runtime activity phase to `exited`: its verified durable binding remains resumable,
and cold recovery may still enter that exact provider session once. An alternate-screen exit,
provider process exit, or Ctrl+C is a presentation/runtime signal for drop-back, not authority to
clear the binding or retire the terminal session.

For ordinary-terminal adoption, the Worker invocation registry assigns the current generation and
publishes every accepted transition with a monotonic per-source `sourceRevision` and aggregate
`revision`. Its live baseline retains an exited current invocation, including its one immutable
verified provider session identity, so delayed or duplicated hook events cannot reactivate or
rebind it. At most eight still-live superseded invocations are retained per terminal; admission at
that boundary preserves existing live records and rejects the new invocation. Completed history
becomes bounded tombstones. Releasing the registry entry records terminal exit only inside this
runtime owner and removes the baseline. It does not kill the PTY, clear provider conversation
identity, write persistence, or create an Agent product aggregate. Legacy activity without
revisions remains transport-compatible; renderer ordering compares generation first, resets the
revision fence for a higher generation, and uses observation time only between same-generation
legacy events.

An active terminal overlay exposes the same copy-last-message, reload, list-session, and
switch-session actions as a durable Agent node. These actions read provider and resume identity from
the terminal binding, start time from the runtime overlay, and working directory from the terminal.
Reload and switch are explicit same-PTY re-executions. The renderer sends only provider, resume intent,
and its expected invocation fence through the controller-bound PTY stream; it never builds or writes a
shell command. `PtyStreamHub` serializes the operation with input/control/geometry work and validates
the attached controller, authority epoch, session, Worker-observed provider, and latest activity
projection. A fallback with no authenticated invocation cannot change provider. The target Worker
builds the provider command, interrupts the foreground process, waits for the same authenticated
invocation to exit plus a fresh shell-prompt observation, then clears the prompt line and enters the
command. A route to another endpoint repeats that validation at the downstream Hub and uses the
downstream controller epoch. Providers without authenticated activity use only a fresh shell-prompt
observation after the interrupt; terminal output text is never parsed as lifecycle authority. Node ID,
PTY session ID, and scrollback remain unchanged, while switching intentionally changes the durable
resume identity only after the Worker accepts the operation. The authenticated shim reports the
actual provider arguments when reserving the next invocation, so the registry records an explicit
resume target before `SessionStart`; a provider-reported identity that differs from that target is
rejected instead of silently rebinding durable conversation truth.

Each activation owns exactly one session-state watcher. A provider or resume-identity change is
serialized as detach-before-attach, and re-entry never reuses an old watcher. Presentation snapshot
hydration may update terminal input modes, but replayed alternate-screen exits must not emit live
drop-back effects.

An attach replays the latest raw state observation from every available source in original observation
order. The renderer feeds these observations through the same pure run-state arbiter used for live events;
the Hub does not duplicate authority policy. Observation timestamps cross the stream boundary so a late
attach cannot renew a stale `working` lease, while quiet `waiting` remains authoritative. The source cache
survives client detach but not session exit, retirement, or Worker shutdown.

Authenticated terminal activity uses the Hub's query-only metadata baseline in addition to live stream
metadata. A renderer subscribes to live metadata before requesting that baseline; generation and aggregate
revision fences reject an older late query result. Disposal fences async completion, and a failed query does
not tear down the live subscription. The Hub remains the runtime projection owner for local and translated
remote session IDs; renderer caches remain derived and are cleared on terminal exit.

The desktop relay mirrors these raw observations while its Worker stream remains attached. When a renderer
subscriber reloads, the relay targets the replay to that subscriber instead of issuing a second stream
attach, preserving input ownership, session identity, and scrollback. The relay keeps one replay cursor per
renderer subscriber, advances it only after successful IPC delivery, and uses the minimum active cursor for
an upstream reconnect; one newer renderer can never skip bytes still required by an older subscriber. The
mirror and subscriber cursors are cleared on session exit, explicit kill, or relay disposal.

## Snapshot Contract

`session.presentationSnapshot` returns:

- `sessionId`
- `epoch`
- `appliedSeq`
- `presentationRevision`
- `cols`
- `rows`
- `geometryRevision`
- `bufferKind`
- `cursor`
- `title`
- `serializedScreen`

Rules:

- `serializedScreen` is produced by worker-owned headless xterm state.
- Renderer cache is not merged into the snapshot.
- Clients attach from `appliedSeq`; stale or missing seq handling must fail closed to resync.
- A restored Agent is not visually ready until worker snapshot/output contains meaningful visible content.

For plain terminals, SQLite schema v11 also checkpoints this presentation shape together with its
`generation`, runtime binding, checkpoint revision, archived previous-epoch previews and bounded
current-epoch raw tail. That durable record supplies the restart hydration baseline and route fence;
it does not make renderer cache authoritative or pretend that a newly spawned shell is the prior
live presentation session.

## Attach And Resync

Client attach flow:

```text
presentationSnapshot
  -> local canonical reset + serializedScreen hydrate
  -> current socket hello
  -> attach(afterSeq)
  -> exact attached(sessionId, role, authorityEpoch) ACK
  -> enable write / resize / Agent re-exec
```

Socket open or hello send is not attach completion. Every Browser socket generation owns a separate attach barrier. Disconnect retires its pending acknowledgements and clears cached authority; a stale old-socket ACK cannot authorize work on the replacement socket. Malformed role/epoch/session data fails closed. Ordinary presentation hydrate may happen before authority is established, but every mutating operation waits for the exact current attach ACK. Browser detach invalidates its per-session attach generation before a delayed connection can send, and the Desktop relay rejects an in-flight Worker attach when session exit removes tracked ownership.

Clients resync when they detect:

- replay overflow or sequence gap
- renderer backend failure
- persistent blank canvas
- visibility resume with stale local state
- hydration failure

Resync rebuilds local renderer state from worker snapshot. It must not promote renderer cache into terminal truth.

When a cold restart replaces a plain shell, reserve archives the prior checkpoint before assigning a
new generation/runtime epoch. Recovery composes all retained static previews and the latest screen;
an unmatched alternate buffer is reset into normal-buffer history before the new shell appears. A
fresh prompt must never be written into the old alternate screen as if the TUI were still running.

## Geometry

Current geometry transaction:

- `/pty` attach assigns one controller; additional clients become viewers unless controller is available.
- Every control handoff increments the session `authorityEpoch` and broadcasts the new role/epoch.
- Attach, detach, explicit control changes, implicit control-on-write and resize all share one
  per-session FIFO. Attach acknowledgement is emitted only after its queued role/epoch transition;
  controller departure may promote only a still-live client that previously expressed controller
  intent, never an explicit read-only viewer.
- A modern resize request carries `operationId`, `baseGeometryRevision` and `authorityEpoch`.
- `operationId` correlates exactly one requester response; `baseGeometryRevision` is optimistic
  concurrency control; `authorityEpoch` fences a client that lost control while awaiting async work.
- Resize reason is `frame_commit` or `appearance_commit`.
- The Worker validates authority and base revision, awaits the local/remote PTY runtime ACK, and only
  then commits/broadcasts canonical presentation geometry. After the await it revalidates the exact
  presentation identity as well as controller/authority; same-id replacement, disposal or lease loss
  cannot commit through an older operation. A lease loss triggers a bounded canonical correction (or
  explicitly advances to the last confirmed runtime geometry).
- Geometry revision and authority epoch are local to each Hub. A Home Hub does not forward its CAS
  counters as if they belonged to the downstream Remote Hub.
- A transport disconnect immediately makes its cached authority epoch unknown (`null`). Until a new
  exact current-socket `attached`/`control_changed` message establishes that transport's role and epoch,
  reconnect traffic must not reuse the prior connection's epoch or issue write/resize/re-exec.
- The requester receives one typed `resize_result`: `accepted`, `accepted_unverified`,
  `rejected_not_controller`, `rejected_stale_authority`, `superseded`, `session_not_found` or
  `runtime_failed`. `accepted_unverified` means the resize was issued without verified application;
  it does not commit or broadcast the proposal. Windows waits for bounded real Console observation
  through the Host-owned observer before returning a verified ACK (see `TERMINAL_RUNTIME_STABILITY.md`). Every
  result includes the correlated operation id and, when known, canonical geometry and authority.
- An unchanged accepted size skips runtime resize only while the previous mutation is confirmed.
  After a failed/unverified mutation, the transaction owner retains a runtime-only uncertainty flag;
  a retry to the old canonical size must also obtain a fresh runtime ACK before clearing it.
- The Renderer measures without mutating xterm, gates PTY output while its operation is pending, and
  applies only the canonical result geometry. Rejection, supersession, timeout and stale-session
  completion all settle the gate; none may leave output permanently paused.
- Stable geometry measurement is derived from the terminal container and xterm cell metrics. Current
  text, progress frames, `.xterm-rows` bounds, glyph overhang and scroll width are renderer output,
  not geometry observations.
- On live reattach, the client first records the snapshot `geometryRevision` as its accepted baseline.
  A controller may then submit exactly one stable measured `frame_commit` against that base revision;
  a viewer applies canonical geometry only. Restored-Agent and explicit resize-suppression guards remain
  authoritative. Attach, focus and typing never substitute for this measured commit.
- Once a verified live commit settles, local xterm rows/columns equal Worker presentation and PTY
  runtime geometry. An unverified or failed result preserves the prior canonical geometry, releases
  the output gate and invalidates the renderer's size cache for explicit retry. Preserving canonical
  state is not evidence that an already-issued native resize rolled back. There is no local-only corrective size and no
  output-triggered shrink/recovery cycle.
- Legacy `revision` input remains compatibility-only. New clients order work through operation id,
  base revision and authority epoch.
- Any transaction that actually changes Worker presentation marks terminal recovery dirty, including
  a correction result whose public status is not `accepted`. Shutdown freezes ingress, drains the
  complete per-session FIFO (including queued attach/detach/control/write/resize work), then takes the
  final durable flush; waiting only for the leading resize promise is insufficient.

Constraints:

- Viewer attach must not resize the PTY.
- Focus, typing and ordinary stream attach must not change PTY geometry.
- Placeholder-only fit may establish a temporary local viewport before attach. A live terminal may
  change rows/columns only by applying an explicit canonical resize result.
- BrowserWindow pixel resize and canvas zoom affect the measured terminal body only when they change
  its stable row/column proposal; they are not independent geometry writers.
- Opening, closing or updating Find must not change the terminal body's measured height or emit a PTY
  resize. Find is an absolute overlay inside `.terminal-node__body`.
- PTY output, DOM text overhang and glyph proximity to the scrollbar must not resize local xterm or
  the PTY. Visual overflow is owned by stable CSS/renderer policy and cannot make geometry depend on
  which characters are currently visible.
- On old Windows ConPTY builds, local renderer resize may temporarily force xterm scrollback reflow
  so historical soft-wrapped lines project at the accepted geometry. This is renderer-only: it must
  preserve the real Windows PTY metadata and must not create another PTY geometry writer.

Remote routes forward the same transaction and await the downstream typed result. A persisted remote
binding includes endpoint/session ids plus home/target Worker instance fences; reconnecting through a
different target instance cannot reuse the old route silently.

## Startup Admission

Worker startup scans persisted workspace state before publishing its connection file. Workspaces
with runtime nodes remain `initializing` until `session.prepareOrRevive` completes; normal terminal
and agent spawn commands return typed `terminal.runtime_not_ready` while blocked. Recovery receives
one internal, attempt-scoped capability that is unavailable to public command contexts. Successful
reconciliation increments the workspace runtime epoch; failure stays `unavailable`, and shutdown or
an out-of-order older completion cannot reopen admission.

For a cold Agent/Terminal replacement, the node-owned `endpointId + mountId` is the route authority.
Recovery resolves that binding before the owning Space and uses Space `targetMountId` only for legacy
nodes without a binding. If the persisted remote endpoint or mount is unavailable, recovery returns
`fallback_terminal` with `remote_worker_unavailable`, retains the binding, and creates no Home PTY.

## Renderer Cache And Placeholder

Allowed:

- Skeleton/recovering UI before worker state is available.
- Selection, local scroll, zoom and viewport preference.
- Same-renderer handoff cache as UX optimization.
- Cached serialized screen for plain terminal placeholder while worker truth is pending.

Forbidden:

- Renderer cache becoming recovery correctness source.
- Placeholder replacing an accepted worker snapshot.
- Raw snapshot or cached output overriding `session.presentationSnapshot`.
- Destructive output heuristics clearing an accepted visible baseline.

Agent nodes are stricter than plain terminal nodes: cold restore should render from worker presentation snapshot and attach stream, not from renderer-published placeholder content.

## Renderer Health

Terminal renderer health is session-local:

- WebGL context loss falls back or rebuilds local renderer.
- Persistent blank canvas triggers rebuild and resync.
- Refresh triggers are coalesced.
- WebGL renderer creation is budgeted per client; excess sessions can use DOM renderer.
- DOM glyph clipping or scrollbar overlap is repaired through CSS/renderer policy without inspecting
  output to alter terminal rows or columns.

Each recovery should log a reason such as `overflow`, `gap`, `contextLoss`, `blankCanvas`, `visibilityResume` or `hydrateFailure`.

## Terminal Appearance

UI base scheme and terminal scheme are intentionally separate. `UiThemeDescriptor.terminalScheme`
selects terminal semantics; for example, `ember-light` uses a light application shell and a dark
terminal/OpenCode palette.

Each xterm instance has one immutable, revisioned `TerminalAppearanceSnapshot`. A final-wins
coordinator coalesces rapid changes, applies the latest snapshot at most once per frame, refreshes the
renderer, then exposes that snapshot as applied. Xterm colors, OpenCode OSC color replies, OpenCode
CSI mode notifications and Find decorations all consume the same applied snapshot. They must not mix
a desired new palette with an older rendered frame. Find clears/rebuilds decorations on appearance
revision while preserving query, result state, selection and viewport.

## Display Alignment

OpenCove exposes terminal display alignment through Settings:

- shared reference cell metrics are persisted user preference
- local device adjustment is client-local storage
- automatic reference setup and automatic calibration are user settings
- local compensation can adjust xterm font size, line height and letter spacing
- an automatic client calibrator waits for settings hydration, a compatible reference, loaded fonts and
  stable layout; it runs single-flight per profile/reference/environment signature
- the settings application calibration owner starts with no applicable projection and synchronously revokes it before environment revalidation; raw localStorage records never style xterm directly
- new records store environment proof atomically with the calibration; legacy sidecar proof must match a freshly measured stable environment and be promoted atomically before application, while metadata-less or measured-grid-less records remain diagnostic-only and unapplied
- renderer environment signature and exact-signature reset suppression include profile/reference, DPR, visual viewport scale, renderer kind and font fingerprint; changes invalidate signed local results
- automatic and manual apply require one mounted renderer kind matching reference provenance plus an `exact`/`close` candidate whose measured rows/columns, effective DPR and cell metrics equal the reference within tolerance; mixed DOM/WebGL handles or ambiguous results remain unapplied
- manual reset suppresses immediate recreation for the same signature
- calibration applies a verified value projection through app composition and updates xterm options in place; it cannot remount xterm, clear scrollback, move viewport or become a PTY geometry writer
- if those metrics change the stable grid, the client must use an `appearance_commit` and apply its
  canonical result; it must not resize only local xterm or update PTY geometry as an uncorrelated side effect

The goal is stable visual parity without letting multiple renderers fight for terminal size. Client-local compensation may differ, but all settled clients still render the one Worker-owned `cols x rows` grid.

## Invariants

1. Worker presentation snapshot is the terminal screen baseline.
2. Renderer cache is never a correctness dependency.
3. `appliedSeq` must survive hydration wrappers.
4. Viewer attach does not resize.
5. Controller resize requires explicit commit reason.
6. A stale authority epoch or base geometry revision never overwrites accepted geometry.
7. PTY runtime ACK precedes presentation commit and geometry broadcast.
8. PTY output is not written into xterm while local geometry is pending, and every terminal result settles the gate.
9. Find and local appearance refresh do not become PTY geometry writers.
10. Desync fails closed to snapshot resync.
11. Hidden or frozen clients can be dropped and rebuilt without changing session truth.
12. Only the current terminal recovery generation/binding can advance a durable checkpoint.
13. Attach, detach, control, write and resize have one per-session FIFO order.
14. A disconnected transport has no reusable authority epoch until reattachment establishes one.
15. Durable dirty state follows an actual presentation change, and shutdown drains the full session
    queue before its final checkpoint.
16. Ordered PTY output changes parser-owned buffer/cursor/dirty rows only; output content and DOM
    footprint never produce a geometry intent.
17. After a verified live geometry transaction settles, local xterm, Worker presentation and PTY
    runtime agree on rows/columns; an unverified transaction preserves canonical geometry and never
    substitutes requested rows/columns as an acknowledgement.
18. Only the current recovery reconciliation scope may spawn before its workspace runtime is ready;
    normal user/node paths cannot acquire or forge that scope.
19. A verified terminal Agent binding survives foreground, alternate-screen, Ctrl+C, and provider
    exit observations; only an explicit clear/remove or session switch may erase or replace its
    durable resume authority.
20. Ordinary-terminal invocation generation and exit fencing belong to the Worker registry, while the
    transport metadata baseline belongs to `PtyStreamHub`; an exited generation cannot be reactivated by a
    late or duplicate source event.
21. Renderer terminal-activity hydration subscribes live before querying the Hub baseline, and an older
    async baseline can never replace a newer live generation or revision.
22. Same-PTY Agent reload/switch is a controller-bound Worker operation. Client shell text is not an
    input, and a stale activity generation, stale authority epoch, viewer request, terminal exit, or
    unconfirmed shell prompt cannot inject the target command.
23. Browser socket open is not attach authority; exact current-generation role/epoch acknowledgement
    precedes write, resize and Agent re-exec.
24. Automatic display calibration is client-local, signature-fenced and conservative; it may change
    canonical rows/columns only through an acknowledged `appearance_commit`.
25. Web listener enable, replacement, drain or security revocation cannot dispose PTY, Hub,
    presentation or recovery state.
26. A Desktop relay reconnects from the minimum active renderer cursor; one subscriber's newer snapshot
    cannot advance another subscriber's replay boundary.

## Verification Anchors

- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.integration.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.ptyProxy.spec.ts`
- `tests/contract/ipc/ptyRuntimeGeometry.spec.ts`
- `tests/unit/app/ptyStreamHub.attach.authority.spec.ts`
- `tests/unit/app/ptyStreamHub.resize.authority.spec.ts`
- `tests/unit/app/ptyStreamHub.resize.spec.ts`
- `tests/unit/app/ptyStreamHub.resizeGeometryAck.spec.ts`
- `tests/unit/app/ptyStreamService.recoveryBarrier.spec.ts`
- `tests/unit/app/BrowserPtyClient.spec.ts`
- `tests/unit/app/remotePtyRuntime.multiSubscriberReconnect.spec.ts`
- `tests/unit/contexts/TerminalAgentInvocationRegistry.spec.ts`
- `tests/unit/contexts/terminalAgentActivityGateway.spec.ts`
- `tests/unit/contexts/terminalAgentActivityProjection.spec.ts`
- `tests/unit/contexts/terminalNode.output-scheduler.spec.ts`
- `tests/unit/terminalNode/terminalGeometrySync.domOverhang.spec.ts` (content-independent fit and
  canonical-only live resize)
- `tests/unit/terminalNode/useCommittedTerminalGeometry.spec.ts` (suppressed live resize refreshes
  current canonical geometry without local fit)
- `tests/unit/terminalNode/terminalAppearance.spec.ts`
- `tests/unit/terminalNode/terminalNodeFrame.findOverlay.spec.tsx`
- `tests/unit/terminalRecovery/`
- `tests/e2e/workspace-canvas.terminal-resize-shrink.spec.ts` (renderer accepted size = Worker
  presentation geometry = POSIX PTY `stty size`, after both expansion and shrink)
- `tests/e2e/pty-host.resize-ack.windows.spec.ts` (deferred ConPTY resize remains explicitly
  unverified and cannot overwrite canonical geometry with the request)
- `tests/e2e/workspace-canvas.terminal-theme.spec.ts` (Find overlay and applied appearance)
- `scripts/test-terminal-presentation-contract.mjs`
- Terminal renderer E2E cases under `tests/e2e/`.
