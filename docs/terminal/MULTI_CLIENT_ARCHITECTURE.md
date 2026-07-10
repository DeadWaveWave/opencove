# Multi-Client Terminal Architecture

OpenCove terminal sessions use worker-owned runtime and presentation state. Desktop and Web UI render locally as clients; correctness comes from Worker snapshot + stream replay, not from renderer cache.

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

## Ownership

| State | Owner | Write path |
| --- | --- | --- |
| PTY process lifecycle | Worker PTY runtime | spawn/kill/exit callbacks |
| PTY byte stream seq | `PtyStreamHub` | output append |
| Terminal presentation state | `TerminalPresentationSession` | PTY output applied in seq order |
| Presentation snapshot | Worker | `session.presentationSnapshot` |
| Replay baseline | Worker | `appliedSeq` from snapshot |
| Controller role + authority epoch | `PtyStreamHub` | `/pty` attach/control handoff |
| PTY geometry | Worker geometry transaction | controller request -> runtime ACK -> presentation commit |
| Terminal recovery generation/archive/binding/checkpoint | Worker terminal recovery owner | reconcile/output checkpoint/atomic retire/two-phase shutdown drain |
| Renderer backend health | client | local rebuild/resync |
| Visible output and dirty rows | xterm parser/renderer | ordered PTY bytes; never a geometry write path |
| Selection/local scroll/zoom | client | local UI only |
| Find overlay | client | local search state/decorations only |
| Applied terminal appearance | client terminal appearance owner | final-wins apply/refresh |

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
presentationSnapshot -> local reset/resize -> write serializedScreen -> attach(afterSeq)
```

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
  `attached`/`control_changed` message establishes that transport's epoch, reconnect traffic must not
  reuse the prior connection's epoch.
- The requester receives one typed `resize_result`: `accepted`, `rejected_not_controller`,
  `rejected_stale_authority`, `superseded`, `session_not_found` or `runtime_failed`. Every result
  includes the correlated operation id and, when known, canonical geometry and current authority.
- An unchanged accepted size acknowledges the operation without issuing another runtime resize.
- The Renderer measures without mutating xterm, gates PTY output while its operation is pending, and
  applies only the canonical result geometry. Rejection, supersession, timeout and stale-session
  completion all settle the gate; none may leave output permanently paused.
- Stable geometry measurement is derived from the terminal container and xterm cell metrics. Current
  text, progress frames, `.xterm-rows` bounds, glyph overhang and scroll width are renderer output,
  not geometry observations.
- Once a live commit settles, local xterm rows/columns equal Worker presentation and PTY runtime
  geometry. There is no local-only corrective size and no output-triggered shrink/recovery cycle.
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
- if those metrics change the stable grid, the client must use an `appearance_commit` and apply its
  canonical result; it must not resize only local xterm or update PTY geometry as an uncorrelated side effect

The goal is stable visual parity without letting multiple renderers fight for terminal size.

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
17. After a live geometry transaction settles, local xterm, Worker presentation and PTY runtime agree
    on rows/columns; no local-only correction may temporarily diverge them.

## Verification Anchors

- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.integration.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.ptyProxy.spec.ts`
- `tests/contract/ipc/ptyRuntimeGeometry.spec.ts`
- `tests/unit/app/ptyStreamHub.attach.authority.spec.ts`
- `tests/unit/app/ptyStreamHub.resize.authority.spec.ts`
- `tests/unit/app/ptyStreamHub.resize.spec.ts`
- `tests/unit/app/ptyStreamService.recoveryBarrier.spec.ts`
- `tests/unit/app/BrowserPtyClient.spec.ts`
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
- `tests/e2e/workspace-canvas.terminal-theme.spec.ts` (Find overlay and applied appearance)
- `scripts/test-terminal-presentation-contract.mjs`
- Terminal renderer E2E cases under `tests/e2e/`.
