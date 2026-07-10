# Terminal TUI Rendering Baseline

This document records the renderer-side TUI baseline used when Codex/OpenCode rendering regresses.

Canonical architecture:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`

This file is tactical. It does not redefine terminal ownership, revive semantics, or multi-client correctness.

## Background

- `codex` is more sensitive than `claude-code` to resize timing, redraw cadence, and renderer churn.
- layered resize logic tends to show garbled text, blank areas, or delayed redraws faster in Codex than in other providers.
- renderer stability depends on keeping the local fit/refresh path simple while preserving worker-owned presentation truth.
- progress bars and TUIs depend on raw VT semantics: carriage return and cursor-control output redraws
  the current screen; it is not evidence that terminal geometry changed.

## Sensitive Path On Latest Main

Key files:

- `src/contexts/workspace/presentation/renderer/components/TerminalNode.tsx`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/terminalGeometryCoordinator.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/outputScheduler.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalAppearanceSync.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/xtermSession.ts`
- `src/app/renderer/styles/terminal-node.css`

Current tactical baseline:

1. Stable PTY measurement is side-effect free:
   - `fitAddon.proposeDimensions()` samples the terminal body
   - repeated animation-frame samples must settle before a commit
   - sampling must not resize xterm or the PTY
2. A geometry commit is one correlated transaction:
   - send `operationId + baseGeometryRevision + authorityEpoch`
   - await typed `resize_result`
   - apply the returned canonical rows/columns locally
3. `ResizeObserver` and layout-sync triggers schedule that single measurement/commit path; they must
   not layer independent resize writers.
4. drag-resize stays as `preview while dragging -> single commit after release`.
5. viewport zoom clarity work must refresh the renderer without remounting the terminal.
6. stale operation ids, authority epochs and base revisions must not overwrite newer local refs.
   Attach/detach/control/write/resize share one per-session FIFO; runtime ACK completion must
   revalidate the exact presentation identity plus session/controller/authority lease and correct the
   PTY if the lease changed during `await`.
7. terminal output scheduler must pause writes while a geometry revision is pending.
8. PTY output is forwarded to xterm in byte order and lets xterm coalesce dirty-row rendering. Output
   callbacks, visible row bounds and glyph footprints are not geometry inputs and must not schedule
   fit, resize or full-screen refresh work.
9. A live session never has a local-only row/column correction. After a commit settles, local xterm,
   Worker presentation and PTY runtime use the same canonical geometry. Visual overflow belongs to
   CSS or the selected renderer and must not be converted into content-dependent columns.
10. old Windows ConPTY resize uses a renderer-only xterm reflow compatibility path so scrollback
   rows follow the accepted geometry when users scroll into history after a horizontal resize.
11. Find is an absolute overlay inside the terminal body. Opening/closing it does not reduce the
    xterm container height and must not trigger PTY geometry.
12. terminal appearance changes use one final-wins applied snapshot; xterm, OpenCode OSC/CSI and Find
    decorations refresh from the same revision.
13. geometry CAS counters are authority-local. Home/Remote and Renderer/Worker revisions must not be
    forwarded across a boundary as though they were the same counter.
14. a disconnected transport clears its cached authority epoch to unknown until a new attach/control
    acknowledgement establishes the connection-local epoch.
15. durable dirty follows every actual presentation change. Shutdown must drain the complete session
    FIFO before its final recovery flush, not only the first in-flight geometry promise.

## Constraints To Preserve

1. keep drag-resize lightweight:
   - dragging updates the node draft frame
   - release performs the actual terminal sync
2. keep scrollback publishing deferred during drag-resize and flush after release
3. do not turn renderer refresh into an implicit correctness path
4. keep Worker geometry transaction as the canonical writer; PTY runtime success precedes
   `TerminalPresentationSession` commit/broadcast
5. settle the renderer output gate on accepted, rejected, superseded, failed and timeout paths
6. keep old clients compatible: legacy `revision` remains accepted, but cannot provide modern
   operation correlation or authority fencing
7. keep Find and appearance refresh outside the geometry writer set; appearance application has one
   final-wins owner and publishes a revision only after that revision is applied/refreshed
8. keep placeholder-only local fit explicit. Once a live session has canonical geometry, suppressed
   resize paths may refresh that geometry but must not call fit or mutate local rows/columns
9. solve DOM glyph clipping with stable CSS/renderer policy. Never inspect the current output and
   shrink xterm until a particular frame happens to fit

## High-Risk Changes

These changes tend to reintroduce Codex/OpenCode TUI regressions:

1. stacking multiple fit/refresh/resize schedulers on top of each other
2. writing large amounts of node or layout state during high-frequency resize
3. splitting `syncTerminalNodeSize()` into several competing branches or effects
4. remounting terminal DOM or replacing renderer DOM to “fix” blur or redraw
5. using high-frequency mutation observers as the primary redraw mechanism
6. writing PTY output while a new local geometry commit is unresolved
7. adding a second canonical PTY geometry writer outside the commit path
8. disabling or bypassing the old ConPTY scrollback reflow adapter on renderer resize
9. calling `fitAddon.fit()` while merely sampling a prospective geometry
10. placing Find in normal flex flow so it changes xterm height
11. refreshing xterm, OpenCode and Find from different theme revisions
12. reading `.xterm-rows`, descendant bounds or `scrollWidth` after output and using them to derive cols
13. resizing only local xterm, even temporarily, while the PTY still reports another geometry
14. calling full-terminal `refresh()` after ordinary progress or TUI output instead of letting xterm
    render its parser-owned dirty rows

## Fast Recovery Checklist

Compare the current branch against the known-sensitive renderer files:

```bash
git diff -- src/contexts/workspace/presentation/renderer/components/TerminalNode.tsx
git diff -- src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize.ts
git diff -- src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalAppearanceSync.ts
git diff -- src/contexts/workspace/presentation/renderer/components/terminalNode/xtermSession.ts
git diff -- src/app/renderer/styles/terminal-node.css
```

Validate with targeted checks:

```bash
pnpm exec vitest run tests/unit/platform/terminal/TerminalPresentationSession.spec.ts tests/unit/app/ptyStreamHub.attach.authority.spec.ts tests/unit/app/ptyStreamHub.resize.authority.spec.ts tests/unit/app/ptyStreamHub.resize.spec.ts tests/unit/app/ptyStreamService.recoveryBarrier.spec.ts tests/unit/app/BrowserPtyClient.spec.ts tests/contract/ipc/ptyRuntimeGeometry.spec.ts tests/unit/contexts/terminalNode.output-scheduler.spec.ts tests/unit/terminalNode/terminalGeometrySync.commit.spec.ts tests/unit/terminalNode/terminalGeometrySync.domOverhang.spec.ts tests/unit/terminalNode/useCommittedTerminalGeometry.spec.ts tests/unit/terminalNode/terminalNodeFrame.findOverlay.spec.tsx tests/unit/terminalNode/terminalAppearance.spec.ts
pnpm test:e2e
```

## Minimum E2E Coverage

Run the user-visible terminal stability cases first:

- `tests/e2e/workspace-canvas.spec.ts`
- `tests/e2e/workspace-canvas.terminal-resize-shrink.spec.ts` — after expansion and shrink, renderer
  accepted geometry, Worker presentation geometry and POSIX PTY `stty size` must match; shrink rows
  must strictly decrease
- `tests/e2e/workspace-canvas.terminal-theme.spec.ts`
- continuous carriage-return progress and Code/TUI redraw coverage: output alone must leave local xterm,
  Worker presentation and PTY geometry unchanged, with no wrap/unwrap oscillation
- terminal multi-client / recovery cases relevant to the changed path

When a TUI regression is timing-sensitive, add a real repro run alongside the E2E result instead of trusting canvas-only tests.
