# Terminal ANSI Screen Persistence (Workspace Switch)

Date: 2026-03-30
Updated: 2026-07-10
Scope: renderer xterm persistence for full-screen TUI / alternate-screen content when switching workspaces.

Canonical architecture:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`

Case note:

- This document captures a renderer-cache workaround used for a specific alternate-screen restore failure.
- Correctness changes should preserve worker-owned presentation snapshots and fail-closed resync, not deepen renderer cache ownership.
- Since SQLite schema v11, plain-terminal restart recovery is Worker-owned through
  `terminal_recovery_records`. Renderer screen cache remains a hot workspace-switch optimization;
  agent placeholder scrollback remains a Renderer UX cache and does not replace provider/CLI recovery.

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

OpenCove keeps a bounded raw PTY tail for compatibility/fallback:

- cap: `400_000` chars (see terminal recovery and persistence constants)

When output exceeds the cap:

- raw snapshots skew toward the most recent data (tail)
- the initial "enter alt screen" sequence and early static draw can fall out of the snapshot window

So restoring from raw tail alone can lose the "full-screen" semantics. The Worker therefore reduces
output through headless xterm and durably checkpoints a SerializeAddon screen with buffer kind,
geometry, cursor and `appliedSeq`. A Renderer SerializeAddon cache still avoids visible churn during a
hot unmount/remount, but it is not the restart source of truth.

Archived epochs have a separate strict `400_000`-character budget across complete persisted ANSI
envelopes. The archive evicts whole oldest epochs, and omits a single oversized epoch with
`historyTruncated=true`; it never slices an envelope in the middle of an escape sequence.

## Restore Pipeline (Current)

1. Worker output path:
   - apply sequenced PTY output to `TerminalPresentationSession`
   - trailing-debounce a v11 current-epoch checkpoint and bounded raw tail
   - mark the checkpoint dirty for output and for any actual geometry presentation change
   - on generation replacement, atomically archive the previous checkpoint and clear current state
   - retire exit/replaced sessions with output cutoff -> drain/join in-flight flush -> forget; a
     degraded retire keeps ingress closed and retries single-flight
2. Hot workspace switch:
   - cache `{ serializedScreen, cols, rows }` per `nodeId/sessionId`
   - remount from the accepted Worker snapshot; use the cache only to avoid a blank transition
3. Reattach to a surviving runtime epoch (for example, a live remote runtime):
   - treat Home Worker identity as transport locality only; fence the durable remote epoch with
     endpoint + remote session + target Worker identity
   - preserve the binding when route observation is transiently unavailable
   - read the durable current-only serialized presentation and its correlated downstream replay cursor
   - keep archived display prefix out of current checkpoints/raw tail, then attach from the downstream
     cursor; a cursorless legacy checkpoint rebuilds instead of merging uncorrelated history
4. Cold app restart with a new local shell epoch:
   - compose every retained previous-epoch static preview with the current serialized snapshot
   - staticize an unmatched alternate buffer, emit alternate-buffer exit + xterm DECSTR + explicit
     mode resets, and scroll it into normal history
   - never replay the new prompt into the old TUI as though the process continued
5. Remote overflow or exited-session recovery:
   - run one snapshot reset per session, buffering live WS data/exit while the authoritative Remote Hub
     presentation is fetched and applied
   - publish the downstream cursor only after reset commit, dedupe buffered events by sequence, replay
     the uncovered suffix once, and fence stale/cursorless Home clients behind the new baseline
   - on reset failure, reconnect from the unchanged cursor; do not commit a gap
   - for an exited remote runtime, commit its authoritative final frame on the old generation before a
     replacement may archive it; if that snapshot is unavailable, block destructive replacement

## Failure Mode

During high-volume output, xterm writes are chunked and can still be draining while the user (or E2E)
switches workspaces.

Historically, dropping the cached committed screen state during that window made hot remount fall
back to persisted raw scrollback, which could be:

- stale (publish is debounced)
- or trimmed (cap) such that the expected final frame token is missing

Even when a serialized screen contains the expected frame token, replaying an uncorrelated raw delta
on top can clobber the last full-screen line. On a cold shell replacement this is worse: the new prompt
can appear inside a previous process's alternate screen, falsely implying TUI continuation.

## Fix

Keep the latest committed Renderer screen cache even when hot-switch writes are pending, but treat it
only as a view cache. Restart correctness comes from the Worker-owned v11 recovery checkpoint.

The cache is allowed to be slightly behind; the remount path will still fetch `pty.snapshot` and
apply the delta to catch up. Deleting it worsens hot-switch visual continuity, while restart
correctness still falls back to the Worker serialized checkpoint. Raw tail alone remains insufficient
when its cap has removed the alternate-screen entry sequence.

In addition, treat alternate-screen and epoch restores as explicit cases:

- For the same epoch, prefer the correlated serialized presentation and attach from `appliedSeq`;
  bounded raw tail is fallback/compatibility data, not an unconditional overlay.
- For a new shell epoch, preserve prior history/preview, explicitly exit the previous alternate
  buffer, apply DECSTR and explicit cursor/keypad/paste/insert/origin/wrap/mouse/focus/synchronized
  output/cursor/SGR resets, and then render the new presentation. Do not manufacture an active old TUI.
- Geometry hydration applies canonical checkpoint geometry. Restore-time local refresh must not emit
  an unrelated PTY resize/SIGWINCH. A later actual geometry commit is a presentation mutation and must
  make recovery dirty even when no output bytes arrive.
- Worker shutdown orders `freeze client ingress -> drain complete per-session queues -> start flush
  without awaiting a continuously dirty drain -> drain/stop presentation resets and re-drain queues
  -> runtime-event cutoff -> await the in-flight flush -> flush post-cutoff dirtiness -> close
  runtime/persistence`, so queued commands, reset output and output arriving during the first capture
  are not silently truncated or allowed to starve shutdown.

## Verification

Local:

```powershell
pnpm build
$env:OPENCOVE_E2E_WINDOW_MODE='inactive'
pnpm exec playwright test tests/e2e/workspace-canvas.persistence.ansi-screen.spec.ts --project electron --reporter=line
```

CI:

- `ci (ubuntu-latest)` should pass the `Workspace Canvas - Persistence ANSI screen restore` E2E.
- SQLite terminal recovery contracts load `better-sqlite3` with Electron's native ABI. Run
  `pnpm test:terminal-recovery:native`; ordinary Node Vitest intentionally skips these suites, so CI
  executes the native gate separately.

## Additional Diagnostics

- Add bounded "drain pending writes before caching" logic on unmount (avoid UI jank).
- `OPENCOVE_TERMINAL_DIAGNOSTICS=1` should distinguish durable checkpoint, hot cache, raw-tail fallback,
  generation/runtime epoch and alt/normal buffer decisions.
