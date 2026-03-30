# Terminal ANSI Screen Persistence (Workspace Switch)

Date: 2026-03-30
Scope: renderer xterm persistence for full-screen TUI / alternate-screen content when switching workspaces.

## Symptom

Ubuntu CI consistently fails the E2E:

- `tests/e2e/workspace-canvas.persistence.ansi-screen.spec.ts`
- Assertion fails after a workspace switch:
  - expected: terminal contains `FRAME_29999_TOKEN`
  - actual: terminal often only shows `ROW_*_STATIC` + prompt, but not the final `FRAME_*` line

## Why This Is Tricky

This test intentionally produces a large amount of output:

- Enters alternate screen (`ESC[?1049h`)
- Draws static rows using absolute cursor positioning
- Writes 30,000 frames to the same absolute row (`ESC[20;1H...`)

OpenCove maintains a PTY snapshot and a persisted scrollback snapshot, but both are capped:

- cap: `400_000` chars (see `src/platform/process/pty/snapshot.ts` and terminal scrollback constants)

When output exceeds the cap:

- raw snapshots skew toward the most recent data (tail)
- the initial "enter alt screen" sequence and early static draw can fall out of the snapshot window

So restoring from raw snapshot alone can lose the "full-screen" semantics. This is why OpenCove also
caches an xterm SerializeAddon-based "committed screen state" on unmount.

## Restore Pipeline (Current)

1. On unmount:
   - cache `{ serializedScreen, rawSnapshotBase, cols, rows }` per `nodeId/sessionId`
2. On mount:
   - write cached `serializedScreen`
   - fetch `pty.snapshot` and append only the delta (computed via suffix/prefix overlap)
   - this catches up the screen to the latest PTY state without relying on full raw replay

## Failure Mode

During high-volume output, xterm writes are chunked and can still be draining while the user (or E2E)
switches workspaces.

If we drop the cached committed screen state during that window, the remount path may fall back to
persisted scrollback, which can be:

- stale (publish is debounced)
- or trimmed (cap) such that the expected final frame token is missing

## Fix

Keep the latest committed screen cache even when there are pending writes.

The cache is allowed to be slightly behind; the remount path will still fetch `pty.snapshot` and
apply the delta to catch up. Deleting the cache entirely is worse because it removes the only
representation that can preserve alternate-screen semantics when the raw snapshot cap is exceeded.

## Verification

Local:

```powershell
pnpm build
$env:OPENCOVE_E2E_WINDOW_MODE='inactive'
pnpm exec playwright test tests/e2e/workspace-canvas.persistence.ansi-screen.spec.ts --project electron --reporter=line
```

CI:

- `ci (ubuntu-latest)` should pass the `Workspace Canvas - Persistence ANSI screen restore` E2E.

## Follow-ups (If We Need Stronger Guarantees)

- Add bounded "drain pending writes before caching" logic on unmount (avoid UI jank).
- Extend `OPENCOVE_TERMINAL_DIAGNOSTICS=1` to log cache/hydrate decision points (cache hit/miss,
  pending writes, raw snapshot lengths, alt/normal buffer kind).

