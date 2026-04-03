# Case Study: Canvas Jitter & Terminal Durability

Date: 2026-04-03
Scope: macOS trackpad canvas pan, terminal/agent output durability across background/sleep/workspace switches.

## Problem Statement

Observed user reports (macOS, full-screen TUI usage):

- Canvas pan (two-finger trackpad) can “snap back” / jitter on a feature branch, while `main` remains smooth.
- When the display is asleep / the app is backgrounded, terminal content appears to stop updating; on wake it “catches up” in a burst.
- After switching project/workspace for a long time, returning can lose scrollback/output for running terminals and agents.

At first glance these symptoms look unrelated (canvas vs terminal). The key lesson is that they can share the same **structural cause**.

## Structural Root-Cause Pattern (Reusable)

This incident was ultimately explained by a combination of patterns that are high-risk in any app:

1. **Multiple writers for the same truth**
   - Example class: “viewport”, “session binding”, “scrollback buffer”.
   - If a value can be written by both **user interaction** and **sync/hydration/persistence replay**, it needs explicit override rules (authority windows, priority, conflict resolution).

2. **Input → durable write → replay feedback loop**
   - A common failure mode is: user input updates state → state is persisted/synced → replay path re-applies it → overwrites/competes with the in-flight interaction state.
   - The symptom often shows up as “snap back”, “jitter”, “flicker”, or “randomly undoing what I just did”.

3. **Durability owned by a throttled lifecycle**
   - If “durable truth” (snapshots, mirrors, persistence writes) is owned by a layer that can be throttled/suspended (typically a renderer/UI process), then background/sleep/visibility changes can create gaps, backlog bursts, or data loss.

4. **Cross-boundary work on hot paths**
   - When high-frequency paths (wheel/pan/drag/resize/output streaming) do IPC, persistence, sync hydration, or heavy serialization, it increases variance and creates emergent regressions (a change in one subsystem shows up as a bug in another).

## Fix Strategy That Worked (Reusable)

The refactor that resolved these issues followed a few principles that generalize well:

- **Make “durable truth” have a single owner** with the most stable lifecycle (typically `Main`), and let `Renderer` be a view/controller.
- **Separate interactive state from durable state**:
  - interactive path: apply immediately for UX
  - durable path: write at idle / batch / debounce, and never overwrite the in-flight interaction state
- **Define explicit override rules** whenever a value can be updated from multiple sources.
- **Assetize the bug**: leave behind a regression test (unit/contract/integration/E2E) that proves the invariant.

## OpenCove-Specific References (This Case)

Key implementation artifacts added/changed by the fix (for future readers):

- Main durable scrollback mirror: `src/app/main/ipc/ptyScrollbackMirror.ts`
- Renderer → Main binding sync: `src/app/renderer/shell/hooks/usePtySessionBindingsSync.ts`
- Canvas gesture path and viewport write isolation:
  - `src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useTrackpadGestures.ts`
  - `src/app/renderer/shell/hooks/useWorkerSyncStateUpdates.ts`

Regression assets:

- Unit: `tests/unit/app/ptyScrollbackMirror.spec.ts`
- E2E: `tests/e2e/workspace-canvas.persistence.spec.ts`

## Why Refactoring Was Required (Not Patch)

Patch attempts can reduce frequency (e.g. “delay a write”, “add a guard”), but they cannot remove structural causes like:

- multi-writer truth without conflict resolution
- undefined ownership across boundaries
- durability owned by a throttled process
- hot-path side effects competing for the same runtime budget

When these patterns are present, the most time-efficient path is usually to **stop chasing symptoms** and refactor toward:

- single owner + explicit invariants
- isolated hot paths
- durable truth in the correct lifecycle
