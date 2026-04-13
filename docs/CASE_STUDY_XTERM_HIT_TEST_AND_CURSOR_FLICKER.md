# Case Study: xterm Hit-Test Leakage, Cursor Flicker, and OpenCode Artifacts

Date: 2026-04-13
Scope: OpenCode / xterm inside Electron + React Flow, with cursor flicker, residual artifacts, and occasional pointer hit leakage to the canvas.

## Problem Statement

Observed symptoms:

- mouse cursor flickered between `text` and `default`
- OpenCode terminal showed shutter-like artifacts / visual tearing
- interactions sometimes appeared to hit the canvas behind the terminal

At first glance this looked like a CSS or stacking issue. It was not that simple.

## What Made This Tricky

The terminal layers could look geometrically correct:

- `.terminal-node__terminal`
- `.xterm`
- `.xterm-screen`
- `.xterm-viewport`
- `.xterm-screen canvas`

Yet `document.elementFromPoint(...)` could still occasionally resolve to `.react-flow__pane`.

The key lesson was: **geometry and hit-test are not the same thing**.

## Reproduction Strategy That Worked

The issue was easiest to observe when using:

- real user data
- real restored terminals / agents
- a visible window with real focus
- latest build artifacts

Useful setup:

```bash
pnpm build
OPENCOVE_DEV_USE_SHARED_USER_DATA=1 pnpm dev
```

`inactive/offscreen` window modes remained useful for regression tests, but were not ideal for capturing this class of hit-test anomaly.

## Sampling Method That Produced Evidence

A single hit-test sample was not enough. The useful method was:

1. choose one real interaction point near the terminal input area
2. sample repeatedly at that fixed point
3. log:
   - `document.elementFromPoint(x, y)`
   - `document.activeElement`
   - `.xterm` classes such as `focus`, `enable-mouse-events`, `xterm-cursor-pointer`
   - computed cursors for terminal layers and the pane

When the hit target oscillated between terminal layers and `.react-flow__pane`, the issue was no longer explainable as a simple focus bug.

## Geometry vs Hit-Test Check

When hit-test resolved to the pane, the next step was to capture geometry at the same time:

- `getBoundingClientRect()`
- `display`
- `opacity`
- `pointer-events`

for the terminal wrapper and xterm inner layers.

If geometry still covered the point but hit-test fell through, the problem had to be treated as a browser/compositor hit-test issue, not a plain CSS stacking mistake.

## Root-Cause Categories

Two different problem classes had to be separated:

### 1) DOM renderer repaint / artifact issue

Symptoms:

- visual tearing
- blank stripes
- stale repaint fragments

Best next move:

- prefer WebGL renderer as the main path for heavy TUI workloads

### 2) WebGL path still leaks hit-test intermittently

Symptoms:

- cursor flicker
- hit occasionally resolving to the canvas beneath the terminal

Best next move:

- stop trying to fully eliminate the leak with normal CSS tricks
- use a controlled fallback that keeps user-visible interaction semantics stable

## Important Design Constraint

“Just add an overlay on top” looked tempting but was too destructive:

- it could break TUI mouse events
- it could break text selection
- it could break link clicks
- it could interfere with React Flow interactions

The safer pattern was:

- detect that the terminal is genuinely focused
- confirm the pointer is still inside the terminal rect
- synchronize cursor / interaction semantics on the underlying canvas hit layer

That reduced visible flicker without bluntly blocking terminal behavior.

## Reusable Lessons

- Validate hit-test separately from geometry.
- Use repeated sampling, not a single `elementFromPoint`.
- Prefer real focused windows for compositor/input anomalies.
- Distinguish renderer artifact bugs from hit-test leakage bugs before choosing a fix.
- Avoid overlay-first fixes for TUI surfaces.
