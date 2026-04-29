# Terminal ANSI Screen Persistence (Workspace Switch)

Date: 2026-03-30
Scope: renderer xterm persistence for full-screen TUI / alternate-screen content when switching workspaces.

Canonical architecture:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`

Historical note:

- This document captures an earlier renderer-cache workaround.
- New correctness changes should move toward worker-owned presentation snapshots and fail-closed resync, not deepen renderer cache ownership.
- The old main-side PTY snapshot mirror has since been removed from the production path; terminal durable scrollback now comes from mounted renderer publish plus app-shell inactive PTY stream sync, while agent placeholder scrollback remains renderer-published UX cache.

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
   - cache `{ serializedScreen, cols, rows }` per `nodeId/sessionId`
2. On mount:
   - write cached `serializedScreen`
   - fetch `pty.snapshot` and reconcile from persisted scrollback truth
   - for normal-buffer restores: replace the placeholder with the merged live snapshot
   - for alternate-buffer restores: only append the delta when it contains an explicit alt-buffer exit (`ESC[?1049l`)
     otherwise, skip the delta to avoid clobbering the committed full-screen snapshot with prompt/redraw output

## Failure Mode

During high-volume output, xterm writes are chunked and can still be draining while the user (or E2E)
switches workspaces.

If we drop the cached committed screen state during that window, the remount path may fall back to
persisted scrollback, which can be:

- stale (publish is debounced)
- or trimmed (cap) such that the expected final frame token is missing

Even when the cache contains the expected frame token, restoring can still fail if we immediately
replay the raw PTY delta on top of the committed serialized snapshot. In CI we observed the delta
containing the shell prompt/redraw output that happened while the workspace was inactive, which can
overwrite the last full-screen frame line.

## Fix

Keep the latest committed screen cache even when there are pending writes.

The cache is allowed to be slightly behind; the remount path will still fetch `pty.snapshot` and
apply the delta to catch up. Deleting the cache entirely is worse because it removes the only
representation that can preserve alternate-screen semantics when the raw snapshot cap is exceeded.

In addition, treat alternate-screen restores as a special case:

- Skip replaying the raw PTY delta unless it contains an explicit alt-buffer exit (`ESC[?1049l`).
  This keeps "what the user last saw" stable and prevents prompt/redraw output from clobbering the
  cached full-screen snapshot.
- Suppress PTY resizes (SIGWINCH) during alternate-screen restore until the user types again, so a
  shell redraw cannot wipe the cached frame before it is visible.

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
