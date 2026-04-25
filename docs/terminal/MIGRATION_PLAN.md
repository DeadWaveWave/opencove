# Terminal Migration Plan

> Status: Active public migration plan
> Scope: move latest `origin/main` to worker-owned multi-client terminal architecture
> Last updated: 2026-04-25

Canonical references:

- `MULTI_CLIENT_ARCHITECTURE.md`
- `CURRENT_MAIN_AUDIT.md`
- `VERIFICATION_AND_RECORDS_PLAN.md`

## Goal

Move OpenCove from:

- shared raw PTY stream
- renderer-owned restore logic
- cache-assisted correctness
- partially split runtime ownership

to:

- worker-owned runtime truth
- worker-owned presentation truth
- worker-owned canonical geometry
- unified revive semantics for Desktop and Web

## Non-Goals

- no bitmap streaming
- no custom terminal renderer
- no deepening renderer placeholder/cache correctness

## Phase 0: Rebaseline

Status: complete

Output:

- target architecture frozen
- current-main audit written down
- execution order reset against latest main

Public docs:

- `MULTI_CLIENT_ARCHITECTURE.md`
- `CURRENT_MAIN_AUDIT.md`
- `VERIFICATION_AND_RECORDS_PLAN.md`

## Phase 1: Worker Presentation Contract

Status: complete

Current landing:

- worker-owned `session.presentationSnapshot` is on the production path
- `session.attach(afterSeq)` is the canonical catch-up contract
- replay overflow now fails closed to snapshot recovery
- controller/viewer attach semantics are covered at the control-surface streaming boundary

### Objective

Create the canonical session baseline that latest main still lacks.

### Deliver

- worker-owned terminal presentation state
- `session.presentationSnapshot`
- `session.attach(afterSeq)`
- overflow => resync contract

### Acceptance

- worker can produce `serializedScreen`, `appliedSeq`, `cols`, `rows`, `bufferKind`, cursor, and title
- Desktop/Web can converge from the same worker snapshot

### Minimum Verification

- unit tests for worker presentation state
- contract tests for snapshot and attach
- integration proving `snapshot -> attach(afterSeq)` convergence

## Phase 2: Renderer Adoption And Correctness Exit

Status: complete

Current landing:

- renderer hydration now treats worker `presentationSnapshot` and live PTY snapshot as authoritative baselines
- accepted worker baselines are no longer replaced by placeholder-reset heuristics
- restart first-input recovery is covered and no longer depends on cache correctness
- worker `session.prepareOrRevive` now returns durable agent placeholder scrollback as the cold-start restore baseline
- cold-start and `cmd+w` restore now keep post-restore backspace/control redraw interactive without waiting for a later visible chunk
- initial active workspace restore now paints persisted nodes before worker prepare resolves, while keeping local spawn/launch fallback disabled on the Electron worker path
- restored click/input liveness is covered by integration tests and real `scripts/debug-repro-restored-agent-input.mjs` runs

### Objective

Make renderer consume worker presentation truth and stop treating placeholder/cache as correctness state.

### Deliver

- renderer hydration based on worker `presentationSnapshot`
- explicit “worker snapshot accepted” baseline
- no placeholder reset/replacement after acceptance

### Acceptance

- restored content no longer disappears after first input
- renderer cache is no longer required for restore correctness

### Minimum Verification

- unit tests around accepted-baseline rules
- integration test for restore + first input
- real repro for restart/reopen old Agent restore

## Phase 3: Geometry Authority Cleanup

Status: in progress

Current landing:

- controller/viewer roles and resize rejection are enforced at the streaming contract boundary
- resize broadcasts now flow through the shared session streaming contract
- single-client Desktop restore and explicit node resize no longer depend on implicit attach/focus resize

Remaining:

- move the whole product path to worker-owned canonical geometry commits
- prove attach/focus/typing can never perturb PTY size across Desktop and Web
- investigate the deferred Web UI issue where opening Web UI can still perturb the Desktop Agent node size and confuse WebGL-heavy TUIs such as OpenCode

### Objective

Move from “controller can resize” to “worker owns canonical geometry; clients submit explicit commits”.

### Deliver

- geometry candidate / commit semantics
- viewer ignore-size default
- explicit frame/appearance commits as the only PTY size writers

### Acceptance

- attach/focus/typing do not change PTY size
- opening Web UI does not perturb Desktop geometry

### Minimum Verification

- unit tests for resize rejection rules
- contract tests for geometry authority
- dual-client E2E for shared node resize behavior

## Phase 4: Revive Unification And Worker Prewarm

Status: complete for Desktop restore

Current landing:

- Desktop startup no longer falls back to the old standalone production runtime path
- live remote session attach survives window reopen without dropping the worker-owned session
- active workspace cold start uses worker `session.prepareOrRevive` as the restore path
- startup no longer blocks first paint on worker prepare; persisted nodes render first with empty runtime `sessionId`, then worker-prepared runtime data is merged
- `cmd+w` reopen and full cold restart both pass the real restored-agent input script on 2026-04-25

### Objective

Give restart restore and `cmd+w` reopen the same worker-owned prepare/revive path.

### Deliver

- worker prepare/revive state machine
- worker prewarm for default visible sessions
- renderer no longer chooses resume/new/fallback as correctness behavior
- `session.prepareOrRevive` becomes the shared Desktop/Web worker contract for cold restore
- initial active workspace hydration accepts worker-prepared runtime nodes before first mount

### Acceptance

- old Agent recovery is worker-owned
- failure states are visible and recoverable, not fake-restored
- app restart first restore no longer depends on `mainPid`-based sessionId dropping

### Minimum Verification

- revive state-machine tests
- integration for restart vs reopen parity
- E2E for old Agent restore and continued interaction

## Phase 5: Renderer Health And Resync

Status: complete

Current landing:

- session-local renderer health policy is in place
- blank/corrupt WebGL sessions rebuild locally and can force DOM fallback
- real `scripts/` validation covers restart restore, reopen restore, and shared Web UI session flows

### Objective

Handle WebGL/canvas/backend failure as a local renderer health issue that resyncs from worker truth.

### Deliver

- session-local health policy
- rebuild + resync flow
- rate-limited health recovery diagnostics

### Acceptance

- renderer blank/corrupt states recover without killing the session
- backend fallback does not mutate PTY truth or geometry truth

### Minimum Verification

- unit tests for health transitions
- integration for context loss / blank canvas recovery
- real repro for dual-client and long-output cases

## Phase 6: Old Owner Cleanup

Status: complete

Current landing:

- Desktop startup no longer boots a main-owned standalone PTY/runtime path
- Home Worker is now the required Desktop runtime host
- cached raw screen state no longer overrides a worker `presentationSnapshot`
- main-side raw PTY snapshot mirrors are removed from the production path
- terminal scrollback now persists from mounted renderer publish plus app-shell inactive PTY stream sync; agent placeholder scrollback remains renderer-published UX cache
- renderer screen cache now carries serialized screen + geometry only; cached raw snapshot is no longer part of restore correctness

### Objective

Delete the production paths that no longer fit the final architecture.

### Deliver

- remove standalone production runtime ownership
- remove renderer correctness caches
- downgrade raw scrollback snapshot to diagnostics/migration only

### Acceptance

- worker is the only production runtime/presentation owner
- remaining cache is explicitly UX-only

### Minimum Verification

- cleanup regression coverage
- dual-client E2E after cleanup
- real repro for restart + first input + Web attach

## Stop Conditions

Pause and re-evaluate if any of these happen:

- renderer cache has to be reintroduced as correctness
- Desktop and Web need different restore semantics
- geometry still changes on attach/focus/typing
- reopen and restart drift back onto different restore paths
- the solution starts depending on a custom bitmap renderer
