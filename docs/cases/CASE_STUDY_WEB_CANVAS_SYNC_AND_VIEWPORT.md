# Web Canvas E2E Diagnostics: Sync + Viewport

Date: 2026-04-08
Scope: Worker Web Canvas (browser runtime), Playwright E2E stability.

## Problem Statement

While validating PR #155, we additionally ran the Web UI E2E suites:

- `pnpm test:e2e:web-canvas`
- `pnpm test:e2e:web-shell`

We hit three related failures/regressions that are useful as a debugging reference for future work:

1. **React Flow viewport transform**: Playwright could resolve a locator as “visible”, but clicks failed (or timed out) because the target was outside the actual viewport.
2. **Multi-client sync drift**: Closing a terminal node updated the persisted sync state, but a second browser client did not remove the node.
3. **Close-path latency**: In a full suite run, closing a terminal node could be blocked long enough to fail E2E timeouts.

## Fast Repro Commands

Run the smallest reproductions first:

```bash
# Viewport / out-of-viewport click failure
OPENCOVE_E2E_SKIP_BUILD=1 pnpm test:e2e:web-canvas -- \
  tests/e2e-web-canvas/workerWebCanvas.agent-resume.spec.ts --reporter=line

# Multi-client close sync failure
OPENCOVE_E2E_SKIP_BUILD=1 pnpm test:e2e:web-canvas -- \
  tests/e2e-web-canvas/workerWebCanvas.sync-between-clients.spec.ts -g "syncs node closes" --reporter=line

# Close-path latency (often shows up only in full-suite context)
OPENCOVE_E2E_SKIP_BUILD=1 pnpm test:e2e:web-canvas -- \
  tests/e2e-web-canvas/workerWebCanvas.sync-resilience.spec.ts -g "keeps closed terminal nodes closed" --reporter=line
```

If you changed source, run `pnpm build` once first (or omit `OPENCOVE_E2E_SKIP_BUILD=1`).

## Diagnosis Notes

### 1) React Flow: “visible” but outside viewport

Symptoms:

- Playwright logs mention `element is outside of the viewport`
- `await expect(locator).toBeVisible()` still passes

Why:

- React Flow renders nodes under a transformed viewport (pan/zoom). DOM visibility is not sufficient to prove “in screen”.

What worked:

- Bring the canvas back to a sane view (`Fit View`) before clicking close/resize controls.
- In E2E, using `.react-flow__controls-fitview` is the simplest cross-platform fix.

### 2) Multi-client: persisted state updates but second client UI stays stale

Symptoms:

- Primary client closes a terminal node.
- `sync.state` shows the terminal node is removed.
- Secondary client still renders the terminal node.

Working theory (validated by code inspection + E2E behavior):

- The Worker Web UI uses SSE `/events` (`sync.onStateUpdated`) + periodic refresh logic (`useWorkerSyncStateUpdates`) to apply persisted state changes.
- A “local write suppression” heuristic treated **all** `sync.writeState` events with `revision <= lastLocalWriteRevision` as local echoes, which can incorrectly drop remote revisions that are delivered later relative to local writes.
- Once dropped, the UI can remain stale indefinitely because no further refresh is scheduled.

Fix direction:

- Track the exact local write revisions to ignore (bounded set/queue).
- Ignore only matching revisions; schedule refresh for other `sync.writeState` revisions.

### 3) Close-path latency: closing a terminal node can block UI removal

Symptoms:

- Clicking the close button succeeds, but `.terminal-node` remains for long enough to fail E2E timeouts.

Why:

- `closeNode()` awaited `pty.kill()` before removing the node from UI state.
- In long-running suites (many PTY sessions), `session.kill` can occasionally take long enough to block node removal.

Fix direction:

- Treat `pty.kill` as best-effort and do not block UI removal on it (`fire-and-forget` + `catch`).

## Fix Summary (What Changed)

- E2E: Ensure nodes are in viewport before clicking close (`Fit View`).
- Web UI: Apply `sync.writeState` events reliably under multi-client timing.
- Workspace UX: Close nodes immediately; do not await session kill.

## Verification

- `pnpm test:e2e:web-canvas` (23 tests) passes.
- `pnpm test:e2e:web-shell` (7 tests) passes.

