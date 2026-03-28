# Win10 Codex Scroll Diagnostics

Date: 2026-03-28
Scope: Windows 10 only, focused on Codex running inside an OpenCove agent/terminal window.

## Problem Statement

Observed user report:

- On Windows 10, when Codex is launched inside OpenCove's embedded terminal/agent window, the Codex UI can lose normal scrollback behavior.
- The same Codex workflow behaves correctly in:
  - VS Code's integrated terminal
  - a native local terminal outside OpenCove
- The symptom is not "all wheel input is broken". The narrower symptom is:
  - the Codex TUI does not expose a normal vertical scrollbar / scrollback path inside OpenCove on Win10

## Current Working Theory

The strongest current explanation is a three-way interaction:

1. Codex switches into a full-screen TUI / alternate-screen workflow.
2. Windows 10 ConPTY has weaker scrollback/reflow behavior than newer Windows builds.
3. OpenCove currently uses the xterm.js + node-pty baseline, but not VS Code's deeper Windows terminal compatibility stack.

This means the likely failing boundary is not basic shell launch anymore. It is:

- ConPTY buffer semantics
- alternate-screen / mouse mode behavior
- xterm viewport / scrollbar state inside OpenCove's embedded terminal

## Why VS Code Can Behave Better

OpenCove already aligned one important part with VS Code:

- agent launch now goes through one terminal-profile normalization path
- Windows PTY metadata is propagated into xterm's `windowsPty`

But VS Code still has a much larger Windows terminal stack on top of that:

- PTY host orchestration
- Windows backend heuristics
- shell integration
- more mature ConPTY behavior handling

References:

- VS Code terminal profiles:
  - https://code.visualstudio.com/docs/terminal/profiles
- VS Code advanced terminal docs:
  - https://code.visualstudio.com/docs/terminal/advanced
- VS Code terminal troubleshooting:
  - https://code.visualstudio.com/docs/supporting/troubleshoot-terminal-launch
- xterm `windowsPty` option:
  - https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
- node-pty README:
  - https://github.com/microsoft/node-pty

## What This Branch Adds

This branch adds an opt-in diagnostics path for terminal nodes.

When enabled, OpenCove writes structured JSON lines to the process stdout with:

- `init`
- `hydrated`
- `resize`
- `wheel`
- `scroll`

Each line includes:

- node/session identity
- terminal kind (`terminal` / `agent`)
- xterm buffer mode:
  - `normal`
  - `alternate`
  - `unknown`
- active buffer values:
  - `activeBaseY`
  - `activeViewportY`
  - `activeLength`
- DOM viewport facts:
  - `hasViewport`
  - `hasVerticalScrollbar`
  - `viewportScrollTop`
  - `viewportScrollHeight`
  - `viewportClientHeight`

Log prefix:

```text
[opencove-terminal-diagnostics]
```

## How To Run On Windows 10

Use a terminal, not a desktop icon, so stdout remains visible.

PowerShell:

```powershell
$env:OPENCOVE_TERMINAL_DIAGNOSTICS='1'
pnpm dev
```

If testing a production build from terminal, launch the built executable from the same shell with `OPENCOVE_TERMINAL_DIAGNOSTICS=1` set first.

## What To Look For

### Case A: Wheel never reaches the xterm viewport

Expected signal:

- no `wheel` logs appear while scrolling over the Codex window

Interpretation:

- event routing is wrong before xterm receives the gesture
- likely a DOM/event capture issue rather than ConPTY scrollback

### Case B: Wheel arrives, but buffer stays `alternate` with no meaningful scrollback

Expected signal:

- `wheel` logs appear
- `bufferKind` remains `alternate`
- `activeBaseY` / `activeViewportY` do not move meaningfully
- `hasVerticalScrollbar` stays `false`

Interpretation:

- Codex is running in an alternate-screen mode where normal scrollback is not materialized
- Win10 ConPTY compatibility is the more likely bottleneck

### Case C: Scrollbar exists but viewport never scrolls

Expected signal:

- `hasVerticalScrollbar` is `true`
- `wheel` logs appear
- `scroll` logs never appear

Interpretation:

- wheel reaches the terminal surface
- viewport scrolling is not being converted into actual xterm viewport movement

## Expected Next Step After Win10 Manual Test

After collecting logs from a real Windows 10 machine, the next change should be chosen from evidence, not guesswork:

1. If wheel never arrives:
   - fix event routing / capture path
2. If wheel arrives but alternate buffer never exposes scrollback:
   - compare against VS Code's Windows terminal behavior more directly
   - evaluate whether Codex needs a different Windows launch/runtime mode inside OpenCove
3. If scrollbar exists but viewport does not move:
   - inspect xterm viewport state and mouse/wheel integration on Win10 specifically

## Non-Goals Of This Document

This document does not claim the root cause is fully proven yet.

It documents:

- the narrowed hypothesis
- the instrumentation added in this branch
- the exact evidence we need from a real Windows 10 machine
