# Terminal TUI Rendering Baseline

This document records the renderer-side TUI baseline we can fall back to when Codex/OpenCode rendering regresses.

Canonical architecture:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`

This file is tactical. It does not redefine terminal ownership, revive semantics, or multi-client correctness.

## Background

- `codex` is more sensitive than `claude-code` to resize timing, redraw cadence, and renderer churn.
- once resize logic becomes layered or state-machine-heavy, Codex tends to show garbled text, blank areas, or delayed redraws faster than other providers.
- current renderer stability still depends on keeping the local fit/refresh path simple until the worker-owned presentation contract fully lands.

## Sensitive Path On Latest Main

Key files:

- `src/contexts/workspace/presentation/renderer/components/TerminalNode.tsx`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalAppearanceSync.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/xtermSession.ts`
- `src/app/renderer/styles/terminal-node.css`

Current tactical baseline:

1. `syncTerminalSize()` stays direct:
   - `fitAddon.fit()`
   - `terminal.refresh(0, terminal.rows - 1)`
   - optional `window.opencoveApi.pty.resize(...)`
2. `ResizeObserver` and layout-sync triggers call `syncTerminalSize()` directly.
3. width/height changes use `requestAnimationFrame(syncTerminalSize)` instead of layered debounce state.
4. drag-resize stays as `preview while dragging -> single commit after release`.
5. viewport zoom clarity work must refresh the renderer without remounting the terminal.

## Constraints To Preserve

1. keep drag-resize lightweight:
   - dragging updates the node draft frame
   - release performs the actual terminal sync
2. keep scrollback publishing deferred during drag-resize and flush after release
3. do not turn renderer refresh into an implicit correctness path

## High-Risk Changes

These changes tend to reintroduce Codex/OpenCode TUI regressions:

1. stacking multiple fit/refresh/resize schedulers on top of each other
2. writing large amounts of node or layout state during high-frequency resize
3. splitting `syncTerminalNodeSize()` into several competing branches or effects
4. remounting terminal DOM or replacing renderer DOM to “fix” blur or redraw
5. using high-frequency mutation observers as the primary redraw mechanism

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
pnpm test -- --run
pnpm test:e2e
```

## Minimum E2E Coverage

Run the user-visible terminal stability cases first:

- `tests/e2e/workspace-canvas.spec.ts`
- `tests/e2e/workspace-canvas.terminal-theme.spec.ts`
- the current terminal multi-client / recovery cases once they land

When a TUI regression is timing-sensitive, add a real repro run alongside the E2E result instead of trusting canvas-only tests.
