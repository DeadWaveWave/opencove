# Agent Input Lost After Full App Restart

Date: 2026-04-13
Scope: restored `Agent` nodes that showed prior history after a full app restart but could not accept interactive input.

## Symptoms

- After `Cmd+Q` reopen, or `Ctrl+C` the dev app and relaunch, a restored agent could look alive but refuse input.
- The same node could behave correctly when only switching projects inside one runtime.
- Focus indicators alone were misleading: the helper textarea could be focused while input still routed to a dead PTY.

## Repro

The bug was only trustworthy through a real restart path:

- `Cmd+Q` then reopen
- or stop `pnpm dev` with `Ctrl+C`, then start it again

Reusable command:

```bash
pnpm build
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/debug-repro-restored-agent-input.mjs
```

That script seeds a recoverable Codex agent, restarts the app, clicks the restored node, types into it, and prints session/focus/PTy-write diagnostics.

## Investigation

The useful evidence chain was:

- `sessionId`: on a correct cold start the node should first mount as a placeholder with `sessionId: ""`, then later switch to a fresh restored runtime session id
- `focus-in` and `xtermHelperTextareaFocused=true`: proves the textarea received focus
- `xterm-onData`: proves xterm saw keyboard input
- `pty-write`: proves renderer attempted to write to PTY
- `write-to-inactive-session`: proves renderer wrote to an invalid or dead runtime session

The winning debugging pattern was: inspect **session ownership first**, then focus.

## Root Cause

Cold-start recovery already intended to:

- drop stale runtime `sessionId`s after a full restart
- keep durable placeholder history visible
- attach a fresh restored runtime later

But the cold-start decision relied on `process.ppid` in preload as a proxy for main-process identity. In real Electron runtime that signal was not reliable enough.

Result:

- some cold starts failed to clear stale runtime `sessionId`s
- restored nodes could briefly mount against dead PTYs
- user input during that window went to an inactive session

## Fix

Two changes closed the gap:

1. Main process now passes its pid into preload explicitly, so the renderer can reliably detect a new main process during full restart recovery.
2. Placeholder -> runtime session swap now preserves focus, so a user who clicks during restoration does not lose the input target when the real xterm mounts.

## Verification

- Unit:
  - `tests/unit/app/mainProcessPid.spec.ts`
  - `tests/unit/app/useHydrateAppState.helpers.spec.ts`
- Real Electron repro:
  - `scripts/debug-repro-restored-agent-input.mjs`
- E2E:
  - `tests/e2e/recovery.agent-focus-after-restart.spec.ts`

## Lessons

- Restart recovery and runtime workspace switching are different code paths; do not treat one as proof for the other.
- For restored-terminal input bugs, validate `sessionId` ownership before chasing focus.
- If restart logic depends on process identity, pass that identity explicitly instead of inferring it indirectly.
- Placeholder rendering and restored runtime attachment must be verified as a handoff, not as isolated phases.
