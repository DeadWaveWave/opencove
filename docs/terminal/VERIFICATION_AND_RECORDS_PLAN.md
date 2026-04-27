# Terminal Verification And Records Plan

> Status: Active working plan
> Scope: terminal and agent nodes across Desktop, Web UI, and future Mobile clients
> Last updated: 2026-04-28

## Purpose

This document defines how OpenCove terminal work is verified, accepted, and recorded over time.

It exists to prevent two failure modes:

- architecture work lands without durable regression coverage
- important findings stay trapped in chat history, ad-hoc notes, or commit messages

The plan below turns terminal work into a repeatable loop:

```text
architecture change
  -> phase target
  -> minimum verification set
  -> real repro validation
  -> acceptance decision
  -> update records in the right docs
```

## Canonical References

When terminal behavior changes, keep these documents aligned:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`: canonical architecture and ownership rules
- `docs/terminal/CURRENT_MAIN_AUDIT.md`: latest-main codepath audit
- `docs/terminal/MIGRATION_PLAN.md`: public execution plan
- `docs/RECOVERY_MODEL.md`: durable recovery ownership and restart truth
- `docs/DEBUGGING.md`: debugging method and repro workflow
- `CHANGELOG.md`: user-visible release notes after PR creation

## Verification Levels

### Level 1: Unit

Use for deterministic rules and invariants:

- geometry authority reducers
- hydrate or revive state machines
- overflow and resync policy
- placeholder and cache correctness boundaries
- renderer health decision logic

Goal:

- prove invariant-level correctness without UI timing noise

### Level 2: Contract

Use for worker/client boundaries:

- legacy `pty.snapshot` / `attach` migration coverage while cutover is in flight
- `session.presentationSnapshot`
- `session.attach(afterSeq)`
- `session.commitGeometryCandidate`
- `session.prepareOrRevive`
- controller and resize authority semantics

Goal:

- prove that the boundary contract stays stable as ownership moves into worker

### Level 3: Integration

Use for multi-step runtime flows:

- worker prewarm -> Desktop attach -> Web attach
- restore -> first input -> history preserved
- explicit resize commit -> geometry broadcast -> both clients converge
- renderer rebuild -> resync -> session remains interactive

Goal:

- prove cooperation between runtime, transport, renderer, and persistence

### Level 4: E2E

Use for user-visible promises:

- old Agent reopened on Desktop then Web UI attaches
- app restart first restore
- `cmd+w` close and reopen
- Codex/OpenCode live output while another client attaches
- resize stress under Desktop/Web interaction

Goal:

- prove the user-facing behavior, not only internal state

### Level 5: Real Repro

Use for cases that canvas or Playwright-only tests tend to miss:

- real agent provider launch
- long-running TUI output
- WebGL or canvas renderer degradation
- environment-dependent CLI behavior

Goal:

- validate that our embedded terminal behaves like the real product path

## Phase Acceptance Gates

Each rollout phase must have a minimum acceptance gate before the next phase starts.

### Phase 0: Latest-Main Rebaseline

Required:

- current-main owner/gap audit updated
- canonical architecture and implementation order aligned
- at least one real repro command chosen for the first migration slice

Record updates in:

- `docs/terminal/CURRENT_MAIN_AUDIT.md`
- `docs/terminal/MIGRATION_PLAN.md`

### Phase 1: Worker Presentation Contract

Required:

- unit or contract proof for worker-owned presentation state
- proof that `presentationSnapshot -> attach(afterSeq)` converges
- proof that overflow becomes resync instead of partial corruption

Record updates in:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `docs/terminal/MIGRATION_PLAN.md`

### Phase 2: Renderer Adoption And Correctness Exit

Required:

- regression test for “restored content disappears after first input”
- integration or E2E proving placeholder no longer resets an accepted worker baseline
- one real repro on restart or reopen flow

Record updates in:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `docs/cases/agent-input-after-restart-recovery.md` or a new case if behavior differs

### Phase 3: Geometry Authority

Required:

- unit coverage proving attach/focus/typing do not resize PTY
- integration proving only explicit commit changes canonical geometry
- dual-client E2E proving viewer ignore-size behavior

Record updates in:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `docs/terminal/MIGRATION_PLAN.md`

### Phase 4: Revive Unification

Required:

- integration proving app restart first restore and `cmd+w` reopen share the same worker path
- E2E for old Agent recovery with continued interaction
- durable-state regression coverage for session binding and revive metadata

Record updates in:

- `docs/RECOVERY_MODEL.md`
- `docs/terminal/MIGRATION_PLAN.md`

### Phase 5: Renderer Resilience

Required:

- unit coverage for health policy transitions
- integration or E2E proving rebuild + resync after backend degradation
- at least one real repro for WebGL/canvas failure or blank renderer recovery

Record updates in:

- `docs/DEBUGGING.md`
- `docs/cases/` if a new repeatable failure mode is discovered

### Phase 6: Old Owner Cleanup

Required:

- proof that renderer cache is no longer needed for correctness
- proof that standalone production runtime ownership is removed
- E2E covering Desktop/Web attach after cleanup

Record updates in:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`
- `docs/terminal/ANSI_SCREEN_PERSISTENCE.md`
- `docs/terminal/TUI_RENDERING_BASELINE.md`

## Stable Regression Matrix

These scenarios should remain easy to rerun and should never be left unowned:

1. Desktop opens old Agent, then Web UI attaches.
2. App restart restores an old Agent, and first input keeps prior content visible.
3. `cmd+w` close and reopen matches restart semantics.
4. Desktop and Web alternate input on the same session.
5. Desktop and Web alternate explicit resize commit on the same node.
6. Another client opens while Codex or OpenCode is actively streaming output.
7. WebGL or canvas degradation rebuilds the local renderer without killing interactivity.
8. Hidden or backgrounded client resumes and converges through resync.

Each item should have at least one durable asset:

- a test file
- a script
- a case study
- or a documented manual repro procedure

If an item has none of these, it is not sustainably covered.

## Real Repro Discipline

Use real repro validation when any of these are true:

- behavior depends on real CLI output or provider auth
- the bug is timing-sensitive or long-running
- WebGL or canvas backend behavior is involved
- the user explicitly reported the bug from a real interactive session

Rules:

- prefer existing scripts under `scripts/` when available
- preserve real auth and environment when reproducing agent issues
- record the exact command or script used
- note whether the repro used Desktop only, Web only, or dual attach

Current high-value script bundle:

- `pnpm test:terminal:presentation`
- `OPENCOVE_REPRO_ITERATIONS=1 OPENCOVE_REPRO_CLOSE_MODE=cmd-w ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/debug-repro-restored-agent-input.mjs`
- `OPENCOVE_REPRO_ITERATIONS=1 OPENCOVE_REPRO_CLOSE_MODE=cold-restart ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/debug-repro-restored-agent-input.mjs`
- `OPENCOVE_E2E_SKIP_BUILD=1 node scripts/test-e2e-web-canvas.mjs -- tests/e2e-web-canvas/workerWebCanvas.spec.ts --grep "reconnects terminal sessions after a page reload|allows controlling a shared terminal session from multiple web clients"`
- `OPENCOVE_E2E_SKIP_BUILD=1 node scripts/test-e2e-web-canvas.mjs -- tests/e2e-web-canvas/workerWebCanvas.agent-resume.spec.ts tests/e2e-web-canvas/workerWebCanvas.view-state.spec.ts`

Latest verified on `2026-04-25` for the current Desktop restore/hydration slice:

- `pnpm exec tsc -p tsconfig.json --noEmit`
- `pnpm build`
- `NODE_OPTIONS=--experimental-require-module pnpm test -- --run tests/integration/recovery/useHydrateAppState.workerPrepare.spec.tsx tests/integration/recovery/useHydrateAppState.merge.spec.tsx tests/integration/recovery/useHydrateAppState.scrollback-ownership.spec.tsx`
- `OPENCOVE_REPRO_ITERATIONS=1 OPENCOVE_REPRO_CLOSE_MODE=cmd-w ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/debug-repro-restored-agent-input.mjs`
- `OPENCOVE_REPRO_ITERATIONS=1 OPENCOVE_REPRO_CLOSE_MODE=cold-restart ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/debug-repro-restored-agent-input.mjs`

Latest verified on `2026-04-28` for restored Agent first-input stability:

- `pnpm build`
- `pnpm check`
- `pnpm test -- --run tests/unit/contexts/terminalInputClassification.spec.ts tests/unit/terminalNode/hydrationRouter.spec.ts tests/unit/terminalNode/hydrationRouter.sequence.spec.ts tests/unit/terminalNode/runtimeHydrationStarter.spec.ts tests/unit/terminalNode/useTerminalRuntimeSession.support.spec.ts tests/unit/terminalNode/hydrateFromSnapshot.spec.ts tests/contract/ipc/ptyRuntimeSubscriptions.spec.ts tests/unit/app/remotePtyStreamMessageHandler.spec.ts`
- `pnpm test:terminal:presentation`
- `ELECTRON_RUN_AS_NODE=1 OPENCOVE_REPRO_PROVIDER=codex OPENCOVE_REPRO_ITERATIONS=8 OPENCOVE_REPRO_CLOSE_MODE=cold-restart ./node_modules/.bin/electron scripts/debug-repro-restored-agent-input.mjs`
- `ELECTRON_RUN_AS_NODE=1 OPENCOVE_REPRO_PROVIDER=opencode OPENCOVE_REPRO_ITERATIONS=5 OPENCOVE_REPRO_CLOSE_MODE=cold-restart ./node_modules/.bin/electron scripts/debug-repro-restored-agent-input.mjs`
- `ELECTRON_RUN_AS_NODE=1 OPENCOVE_REPRO_PROVIDER=codex OPENCOVE_REPRO_ITERATIONS=3 OPENCOVE_REPRO_CLOSE_MODE=cmd-w ./node_modules/.bin/electron scripts/debug-repro-restored-agent-input.mjs`
- `OPENCOVE_E2E_SKIP_BUILD=1 pnpm test:e2e:web-canvas`
- Diagnostic check: Codex/OpenCode both reached visible worker output before input, stayed interactive after typing/backspace/enter, and reported converged renderer/worker geometry (`64x44`) in `restored-ready-before-input.json`.

Latest targeted validation on `2026-04-25` for inactive terminal scrollback durability:

- `NODE_OPTIONS=--experimental-require-module pnpm test -- --run tests/unit/contexts/ptyTaskCompletion.spec.ts`
- `NODE_OPTIONS=--experimental-require-module pnpm exec tsc -p tsconfig.json --noEmit`
- `NODE_OPTIONS=--experimental-require-module pnpm test:e2e tests/e2e/workspace-canvas.persistence.spec.ts --project electron --reporter=line -g "arrow-key history recall"`
- `NODE_OPTIONS=--experimental-require-module pnpm test:e2e tests/e2e/recovery.agent-placeholder-handoff-interaction.spec.ts --project electron --reporter=line`

Current deferred Web UI-specific validation:

- Opening Web UI can still perturb Desktop Agent node size and confuse WebGL-heavy TUIs such as OpenCode.
- That issue remains tracked under Phase 3 geometry authority / dual-client renderer behavior, not under Desktop restore correctness.
- Do not mark Phase 3 complete until a dual-client real script proves Web UI attach does not resize or poison the Desktop renderer.

Local validation note:

- On the current local `node v22.5.1`, Vitest 4 needs `NODE_OPTIONS=--experimental-require-module` to load its config because a dependency is ESM-only. This is an environment launcher issue observed before test execution, not a product regression.

Previously verified on `2026-04-24`:

- recovery Playwright suite passed, including `tests/e2e/recovery.agent-placeholder-click-preserves-history.spec.ts`
- worker web-canvas shared-session checks passed: `tests/e2e-web-canvas/workerWebCanvas.spec.ts` (`reconnects terminal sessions after a page reload|allows controlling a shared terminal session from multiple web clients`)

## Update Record Policy

Every terminal architecture change should update records at three layers.

### Layer A: Canonical Rule

If ownership, contract, geometry policy, revive semantics, or renderer correctness boundaries changed:

- update `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`

### Layer B: Execution Plan

If the implementation sequence, active phase, or acceptance target changed:

- update `docs/terminal/MIGRATION_PLAN.md`

### Layer C: Concrete Evidence

If a real bug, regression, or debugging technique was discovered:

- update `docs/cases/...` for case-specific learnings
- update `docs/DEBUGGING.md` for reusable methods
- if public terminal architecture guidance changed, also update `docs/terminal/CURRENT_MAIN_AUDIT.md`

### Release Record

If the behavior is user-visible and will ship:

- add an entry to `CHANGELOG.md` after the PR exists, following the repo workflow in `DEVELOPMENT.md`

## Change Record Template

When we complete a terminal slice, record it in this shape:

```md
## YYYY-MM-DD - <slice name>

Decision:
- What changed in terminal ownership, contract, or behavior?

Verification:
- Unit:
- Contract:
- Integration:
- E2E:
- Real repro:

Acceptance:
- Which rollout phase gate is now satisfied?
- What is still intentionally deferred?

Docs updated:
- docs/terminal/MULTI_CLIENT_ARCHITECTURE.md
- docs/terminal/MIGRATION_PLAN.md
- docs/DEBUGGING.md / docs/cases/... / CHANGELOG.md
```

This template can live in the PR description, a public docs update, or a case-study note. The important part is that the evidence is recorded in one of the canonical locations above.

## Review Cadence

Review this plan whenever one of these happens:

- a new terminal phase starts
- a regression escapes the current test set
- a renderer backend failure mode appears more than once
- a new client form is introduced, such as Mobile
- the team changes how release notes or case studies are recorded

## Minimum Definition Of Done

A terminal architecture slice is not done unless all of these are true:

- the target invariant is written down
- the lowest meaningful verification layer is green
- at least one user-facing or real-repro path confirms the behavior when the change is user-visible
- the right canonical docs were updated
- deferred risks are named explicitly instead of being silently carried forward
