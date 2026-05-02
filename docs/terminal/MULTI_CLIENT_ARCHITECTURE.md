# Multi-Client Terminal Architecture

OpenCove terminal sessions use worker-owned runtime and presentation state. Desktop and Web UI render locally as clients; correctness comes from Worker snapshot + stream replay, not from renderer cache.

## Current Runtime Shape

```text
PTY / Agent CLI output
  -> Worker PTY runtime
  -> PtyStreamHub
  -> TerminalPresentationSession
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
| Controller role | `PtyStreamHub` | `/pty` attach/control |
| PTY geometry | `PtyStreamHub` + PTY runtime | controller resize with commit reason |
| Renderer backend health | client | local rebuild/resync |
| Selection/local scroll/zoom | client | local UI only |

## Snapshot Contract

`session.presentationSnapshot` returns:

- `sessionId`
- `epoch`
- `appliedSeq`
- `presentationRevision`
- `cols`
- `rows`
- `bufferKind`
- `cursor`
- `title`
- `serializedScreen`

Rules:

- `serializedScreen` is produced by worker-owned headless xterm state.
- Renderer cache is not merged into the snapshot.
- Clients attach from `appliedSeq`; stale or missing seq handling must fail closed to resync.
- A restored Agent is not visually ready until worker snapshot/output contains meaningful visible content.

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

## Geometry

Current geometry behavior:

- `/pty` attach assigns one controller; additional clients become viewers unless controller is available.
- `PtyStreamHub.resize` accepts resize only from the controller client.
- Resize reason is `frame_commit` or `appearance_commit`.
- Accepted resize updates `TerminalPresentationSession`, then resizes the PTY runtime.

Constraints:

- Viewer attach must not resize the PTY.
- Focus, typing and ordinary stream attach must not change PTY geometry.
- Local calibration/fit may adjust renderer display, but canonical PTY size changes only through explicit resize commits.

Current limitation:

- Geometry authority is still tied to controller ownership. Dual-client attach must be tested carefully so a Web UI attach does not perturb Desktop geometry.

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

Each recovery should log a reason such as `overflow`, `gap`, `contextLoss`, `blankCanvas`, `visibilityResume` or `hydrateFailure`.

## Display Alignment

OpenCove exposes terminal display alignment through Settings:

- shared reference cell metrics are persisted user preference
- local device adjustment is client-local storage
- automatic reference setup and automatic calibration are user settings
- local compensation can adjust xterm font size, line height and letter spacing
- local compensation must not resize PTY or update canonical `cols/rows`

The goal is stable visual parity without letting multiple renderers fight for terminal size.

## Invariants

1. Worker presentation snapshot is the terminal screen baseline.
2. Renderer cache is never a correctness dependency.
3. `appliedSeq` must survive hydration wrappers.
4. Viewer attach does not resize.
5. Controller resize requires explicit commit reason.
6. Desync fails closed to snapshot resync.
7. Hidden or frozen clients can be dropped and rebuilt without changing session truth.

## Verification Anchors

- `tests/contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.integration.spec.ts`
- `tests/contract/controlSurface/controlSurfaceHttpServer.multiEndpoint.ptyProxy.spec.ts`
- `scripts/test-terminal-presentation-contract.mjs`
- Terminal renderer E2E cases under `tests/e2e/`.
