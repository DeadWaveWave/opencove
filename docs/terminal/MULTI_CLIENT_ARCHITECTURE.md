# Multi-Client Terminal Architecture

> Status: Canonical technical direction
> Scope: terminal and agent nodes rendered across Desktop, Web UI, and future Mobile clients
> Last updated: 2026-04-28

Verification workflow:

- `VERIFICATION_AND_RECORDS_PLAN.md`

## Decision

OpenCove terminal sessions use the industry-mature model:

```text
PTY / Agent CLI output
  -> Worker owns runtime and canonical presentation state
  -> Main only bridges transport and window lifecycle
  -> Desktop/Web/Mobile render locally as clients
  -> Desync or renderer failure resyncs from worker snapshot
```

We do not start by building a custom terminal emulator or bitmap streaming layer. The production path keeps xterm.js for local rendering while moving correctness, recovery, geometry authority, and resync semantics into the worker.

## Why This Route

This follows the same durable shape used by mature systems:

- VS Code separates process reconnection from process revive.
- tmux keeps session truth on the server and makes client size behavior explicit.
- xterm.js supports headless terminal state and serialization for reconnect.
- Termux separates terminal session lifetime from view lifetime.

The elegant part for OpenCove is not replacing xterm.js. The elegant part is defining a strict terminal correctness contract so every client can be discarded, rebuilt, hidden, or degraded without changing session truth.

## Current Main Delta

As of `2026-04-23`, latest `origin/main` is still earlier than this target architecture:

- Desktop/Web already share a raw PTY stream transport, but not a worker-owned presentation snapshot.
- renderer hydration still depends on `pty.snapshot`, placeholder handoff, and renderer screen caches.
- agent restore decisions still happen partly in renderer hydration logic.
- packaged and dev flows can still run through `standalone` main-owned PTY/runtime paths.

This document defines the target architecture. The migration from current main is tracked in:

- `CURRENT_MAIN_AUDIT.md`
- `MIGRATION_PLAN.md`

## User-Facing Promise

- Desktop and Web UI can attach the same session without stealing geometry from each other.
- Opening Web UI while Desktop is active cannot make both clients lose interaction.
- App restart recovery and `cmd+w` reopen recovery use the same worker-owned semantics.
- Restored content is committed once accepted from worker snapshot; typing afterward cannot clear it through renderer placeholder heuristics.
- Renderer WebGL/canvas/DOM failures degrade or resync the local renderer only; they do not corrupt the session.

## Ownership

| State | Owner | Allowed write path |
| --- | --- | --- |
| PTY process lifecycle | Worker `PtyExecutionSession` | worker session use case |
| Terminal presentation state | Worker headless terminal session | PTY output applied by worker |
| Presentation snapshot | Worker | `session.presentationSnapshot` |
| Replay seq and overflow policy | Worker | output append / attach |
| Canonical `cols/rows` | Worker geometry authority | accepted geometry candidate |
| Reconnect/revive state | Worker session/revive policy | durable records + runtime observation |
| Transport and windows | Main | orchestration only |
| Renderer backend health | Client | local health policy |
| Selection, local scroll, zoom | Client | local UI only |

## Protocol

### Snapshot

`session.presentationSnapshot` is the canonical baseline for a client:

```json
{
  "sessionId": "s1",
  "epoch": 4,
  "appliedSeq": 9801,
  "presentationRevision": 129,
  "cols": 120,
  "rows": 36,
  "bufferKind": "normal",
  "cursor": { "x": 4, "y": 35 },
  "title": "opencode",
  "serializedScreen": "..."
}
```

Rules:

- `serializedScreen` comes from worker-owned headless terminal state.
- Renderer cache is never merged into the snapshot.
- `epoch` changes after revive or incompatible reset; epoch mismatch forces resync.
- `appliedSeq` is the only valid `attach(afterSeq)` baseline.

### Attach

`session.attach(afterSeq)` streams bounded VT output increments after the snapshot baseline. If the requested sequence is too old, the worker reports overflow and the client must resync.

### Resync

Resync is fail-closed:

```text
snapshot -> local reset/resize -> write serializedScreen -> attach(afterSeq)
```

Clients must resync on:

- replay overflow or sequence gap
- renderer backend failure
- WebGL context loss or persistent blank canvas
- visibility resume when local state may be stale
- hydration failure

## Geometry

The PTY has exactly one canonical geometry: worker-owned `cols/rows`.

Client measurement produces a geometry candidate, not truth. Only explicit commits can update canonical geometry:

- `frame_commit`: user explicitly resized the shared node/frame.
- `appearance_commit`: user explicitly changed the terminal appearance profile.

Attach, focus, typing, controller switch, and Web UI opening must never resize the PTY.

## Appearance Profile

OpenCove uses an appearance profile as the terminal equivalent of a shared display contract:

- `fontFamily`
- `fontSize`
- `lineHeight`
- `letterSpacing`
- theme tokens
- unicode width policy and parser-sensitive xterm options

The profile can be implemented with CSS variables in clients, similar to a `rem` system, but it is not the truth. The truth remains integer terminal cells: `cols x rows`.

## Multi-Client Policy

- First interactive client may be controller.
- Additional clients default to viewer and ignore-size.
- Controller authority and resize authority are separate.
- Mobile defaults to read-only or viewer projection with scale, letterbox, pan, or zoom.
- Mobile may request controller or resize authority only through an explicit user action.

## Reconnect And Revive

Reconnect:

```text
live worker/session -> presentationSnapshot -> attach(afterSeq)
```

Revive:

```text
worker startup -> read durable records -> prewarm default visible sessions
  -> revive runtime or mark revive_pending/revive_failed
  -> clients attach only to worker-owned state
```

Renderer code must not spawn, resume, fallback, or guess a restored agent session as a correctness path.

Current migration landing:

- the shared cold-start runtime contract is `session.prepareOrRevive`
- active workspace hydration should consume that worker result before runtime nodes first mount
- Desktop no longer falls back to a main-owned standalone PTY/runtime host at startup
- renderer-local revive logic is non-production fallback only; production correctness no longer depends on renderer cache or mirror paths

## Renderer Cache And Placeholder

Allowed:

- skeleton or recovering UI before worker state is available
- selection, local scroll position, zoom, and viewport preference
- performance optimizations that can be dropped at any time
- cached serialized screen or dimensions as a temporary placeholder for plain terminal nodes while worker truth is still pending
- same-renderer handoff cache that never contributes a raw snapshot baseline
- terminal scrollback persisted from mounted renderer publish plus app-shell inactive PTY stream sync

Forbidden:

- cache participating in recovery correctness
- placeholder replacing a worker snapshot later
- destructive output heuristics resetting an accepted baseline
- renderer cache writing back canonical presentation state
- cached raw snapshot overriding an accepted worker `presentationSnapshot`
- main-side PTY snapshot mirroring acting as the producer of renderer placeholder correctness

Agent nodes are stricter than plain terminal nodes: cold-start restore must render from worker
`presentationSnapshot -> attach(afterSeq)` only. Agent placeholder scrollback and renderer screen
cache may remain as legacy cleanup/compatibility data, but must not be read into renderer state,
returned by `session.prepareOrRevive`, mounted as a placeholder xterm, or persisted from renderer
output.

If a revived Agent has attached but the worker presentation is still empty, the renderer may show a
recovering overlay and temporarily gate user input while still forwarding automatic terminal replies.
The overlay is UX-only: it is not terminal content, it is not persisted, and it disappears on the
first meaningful worker output. A bounded fail-open timeout is allowed only as a recoverability
fallback so the UI never becomes permanently blank/non-interactive; that fallback must log
diagnostics and still must not promote renderer cache into terminal truth.

`isLiveSessionReattach` means the runtime session exists; it does not mean the worker presentation is
ready to paint. Restored Agent readiness is determined by the resume contract plus an actually visible
worker snapshot/output. This prevents App restart from hydrating a blank xterm just because the worker
session was already alive.

After a restored Agent becomes visible, destructive control-only redraws (`clear`, alternate-screen
repaint fragments, cursor-home plus erase) are still coalesced until visible content follows, with a
bounded timeout fallback. This applies whether the first visible baseline came from a worker snapshot,
hydration replay, or the first live worker output after an empty hydration baseline. A client must not
paint a naked clear-screen fragment first and wait for the next chunk to refill the canvas, because
that reintroduces the "content disappears on first input or resize" failure mode.

Hydration replay is sequence-aware. If a worker `presentationSnapshot` with `appliedSeq=N` is accepted,
any buffered attach output at `seq <= N` is already represented by the snapshot and must not be
replayed into xterm again. Automatic terminal queries are the exception: they remain deliverable to
the local xterm so the runtime still receives feature/status replies during restore.

That `appliedSeq` is part of the correctness contract and must be preserved through every renderer
hydration wrapper. If an orchestration layer drops it before calling the hydration router, the client
will replay stale attach chunks over an accepted worker snapshot and can reintroduce first-input
screen jumps that look like renderer cache bugs.

If a buffered hydration chunk has no sequence after an authoritative snapshot baseline, it is not
safe to treat it as fresh output. The client drops non-query unknown-seq chunks instead of replaying
possibly stale output over the accepted screen.

If fresh post-snapshot Agent output is a destructive TUI repaint with visible content, that repaint
becomes the new local baseline: reset the local xterm and write the fresh frame rather than painting
it over a stale restored frame. This avoids old prompt lines surviving below a newly restored Codex
or OpenCode screen.

For restored Agent cold-start, a post-geometry worker snapshot is accepted as the visible baseline
only after it contains meaningful display content. Control-only snapshots such as terminal feature
queries, bracketed-paste toggles, or color probes can drive xterm replies during hydration, but they
must not reveal the Agent as restored or release initial user input.

Control-only snapshots are also not accepted as sequence baselines. They may align local xterm
geometry and keep the recovery state visible, but buffered attach output after the last visible
baseline remains eligible for replay. Otherwise a worker snapshot that only contains mode toggles
could fence off the real restored TUI frame and make the Agent look empty until the next input.

After a visible presentation snapshot has been written locally, attach completion is bounded. A stuck
transport attach must not leave the Agent in a visible-but-input-gated state forever; the still-pending
attach may continue in the background, while the renderer finalizes hydration against the accepted
snapshot and visible worker output.

## Renderer Health

Terminal renderer health is session-local and recoverable:

- WebGL context loss falls back to DOM and resyncs.
- Persistent blank or missing canvas triggers rebuild and resync.
- Refresh triggers are registered once and coalesced.
- Handoff between Desktop and Web must not reuse poisoned renderer state as truth.

Each recovery should log a reason such as `overflow`, `gap`, `contextLoss`, `blankCanvas`, `visibilityResume`, or `hydrateFailure`.

## Invariants

1. Worker is the only screen truth owner.
2. Worker is the only canonical geometry owner.
3. Renderer cache and placeholder are never correctness dependencies.
4. Reconnect and revive are distinct states with distinct failure handling.
5. Any desync fails closed to snapshot resync.
6. Hidden or frozen clients can be dropped and rebuilt without changing session truth.
7. Accepted worker snapshots cannot be replaced by later renderer heuristics.
8. A live Agent session is not considered visually ready until a worker snapshot/output contains visible content.

## Rollout

Phase 0: latest-main rebaseline.

Freeze the owner model, current gap audit, and verification matrix against latest `origin/main`.

Phase 1: worker presentation contract.

Add worker-owned terminal presentation state plus `session.presentationSnapshot` and `attach(afterSeq)` as the canonical Desktop/Web attach contract.

Phase 2: renderer adoption and correctness exit.

Switch renderer hydration to the worker snapshot baseline and stop placeholder or destructive-chunk heuristics from resetting an accepted baseline.

Phase 3: geometry authority cleanup.

Make all PTY size changes go through explicit worker-validated geometry commits. Enforce viewer ignore-size semantics.

Phase 4: revive unification.

Move cold-start restore decisions to worker prewarm/prepare so app restart and `cmd+w` reopen share the same state machine.

Phase 5: renderer resilience.

Add session-local health policy, rebuild poisoned renderers, and resync from worker snapshot on overflow, blank canvas, context loss, or visibility resume.

Phase 6: old owner cleanup.

Remove standalone production runtime ownership, renderer correctness caches, and any remaining main correctness mirrors.

## Verification

Minimum verification for architecture-changing work:

- Unit: geometry authority reducer, hydration state machine, placeholder policy, overflow/gap resync.
- Contract: `session.presentationSnapshot`, `session.attach(afterSeq)`, `session.commitGeometryCandidate`, `session.prepareOrRevive`.
- Integration: worker prewarm -> Desktop attach -> Web attach -> dual input -> resize commit -> visibility resume.
- E2E: real script paths for old Agent restore, Web UI attach during live output, first input after restart, Codex/OpenCode resize/render resilience.
