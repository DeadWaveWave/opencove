# Case Study: Agent Input Lost After Full App Restart

Date: 2026-04-13
Scope: restored `Agent` nodes that looked alive after app restart but could not accept interactive input.

## Problem Statement

Observed symptom:

- After a full app restart, a restored agent window could show prior history but not accept input.
- The same agent could appear fine when switching projects during the same app runtime.

Important distinction:

- **Runtime project switching** mostly reuses cache.
- **Full app restart** re-enters cold-start recovery and session reattachment.

Treating these as the same bug delayed the diagnosis.

## Reproduction That Finally Worked

The bug was only trustworthy when reproduced through a real restart path:

- `Cmd+Q` then reopen
- or stop `pnpm dev` with `Ctrl+C`, then start `pnpm dev` again

For repeatable validation, the most useful command was:

```bash
pnpm build
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/debug-repro-restored-agent-input.mjs
```

That script:

- launches real Electron rather than a `NODE_ENV=test` stub path
- seeds a recoverable Codex agent
- restarts the app
- clicks the restored node
- types into the node
- prints terminal diagnostics around session ids, focus, and PTY writes

## Why Earlier Debugging Was Misleading

Three things obscured the root cause:

1. **Workspace switching looked healthy**
   - cache-backed switching could hide the cold-start bug entirely

2. **Source changes without `pnpm build`**
   - recovery and worker paths could still execute stale `out/` artifacts

3. **Looking at focus before session ownership**
   - the UI could look focused while input was still being routed to a dead runtime session

## Diagnostic Signals That Mattered

The useful signals were:

- `sessionId`
  - on correct cold start, the node should first mount as a placeholder with `sessionId: ""`
  - then later switch to a new restored runtime session id
- `focus-in` and `xtermHelperTextareaFocused=true`
  - proves the helper textarea has focus
- `xterm-onData`
  - proves xterm received keyboard input
- `pty-write`
  - proves renderer tried to forward input to PTY
- `write-to-inactive-session`
  - proves input was sent to an invalid or dead session

The key lesson was: **focus alone was not enough evidence**.

## Root Cause

Cold-start protection already existed conceptually:

- on full restart, stale runtime `sessionId`s should be dropped
- durable history / placeholder should render first
- then a fresh restored runtime session should attach

But that protection depended on identifying whether the current renderer belonged to a new main process.

The implementation used `process.ppid` in preload as a proxy for main-process identity. In real Electron runtime, that was not reliable enough for this decision.

Result:

- some cold starts failed to drop stale runtime session ids
- a restored node could briefly mount against the old dead session id
- user input during that window could route to a terminated PTY

The bug therefore presented as “restored agent cannot input”, even though the deeper problem was **wrong session ownership during restart recovery**.

## Fix Pattern

The fix had two parts.

### 1) Make cold-start identity explicit

Main process now passes its pid into preload explicitly, and preload reads that value instead of relying on raw `process.ppid`.

This stabilized the cold-start decision:

- cold start drops stale runtime `sessionId`s
- durable placeholder history remains visible
- restored runtime attaches with a fresh session id

### 2) Preserve terminal focus across placeholder -> runtime swap

Even with correct session ownership, a user could click the placeholder before the real runtime finished mounting.

When the placeholder xterm unmounted and the real runtime xterm mounted, focus needed to be handed over explicitly. Without that, the user would need an extra click and could still perceive the node as “not interactive”.

## Verification

The final verification stack was:

- targeted unit test for explicit main-process pid parsing
- targeted unit test for dropping runtime `sessionId`s on cold start while preserving placeholder history
- real Electron repro script with simulated click and keyboard input
- Playwright Electron E2E that clicks a restored agent, waits through recovery, and verifies typing still works

Most important real-runtime evidence:

- second launch first showed placeholder with `sessionId: ""`
- node later switched to a fresh restored session id
- after restore, typing produced `xterm-onData` and `pty-write`
- helper textarea remained focused across the swap

## Assets Left Behind

- Repro script: `scripts/debug-repro-restored-agent-input.mjs`
- Unit:
  - `tests/unit/app/mainProcessPid.spec.ts`
  - `tests/unit/app/useHydrateAppState.helpers.spec.ts`
- E2E:
  - `tests/e2e/recovery.agent-focus-after-restart.spec.ts`

## Reusable Lessons

- If a bug only happens after restart, do not trust runtime-switch reproductions.
- For recovery bugs, inspect session ownership before UI focus.
- If a recovery decision depends on process identity, pass that identity explicitly.
- Placeholder rendering and restored runtime attachment are separate phases; test the handoff, not just each phase in isolation.
