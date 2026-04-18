# Terminal No-Color / All-White Output Requires Visual Debugging

Date: 2026-04-13
Scope: terminal or agent sessions that looked visually colorless even when recovery, scrollback, or ANSI handling otherwise seemed healthy.

## Symptoms

- Terminal or agent output looked all white.
- Recovery could still look correct: placeholder visible, restored session attached, and `pty:snapshot` contained ANSI sequences.
- Protocol-level success did not prove visible color.

## Repro

This class of issue required a real visual check:

1. `pnpm build`
2. Run the real app runtime (`pnpm dev` or equivalent packaged runtime)
3. Open a real terminal node
4. Either print an explicit colored token, or launch the real CLI TUI the user reported
5. Inspect the rendered result or screenshot

If the report is specifically about Codex startup colors, the only trustworthy validation is to launch real `codex` inside the terminal node and inspect the screenshot.

## Investigation

The first split that mattered was:

- **ANSI absent**
  - likely spawn env / `TERM` / `NO_COLOR` / `FORCE_COLOR` / attach-hydration issues
- **ANSI present but still not visible**
  - likely xterm palette/theme, UI theme sync, or DOM/WebGL renderer differences

One especially misleading variable was `FORCE_COLOR`: some test runners inject it, which can hide or invent behavior that the real app runtime does not have.

## Root Cause Pattern

This was not one single root cause but a debugging failure mode:

- protocol checks alone were treated as sufficient evidence
- `NODE_ENV=test` / stubbed E2E runs were trusted for a real CLI visual issue
- visible color, which is a UI contract, was never verified directly

## Fix Strategy

- Always do a minimum visual check first for color regressions.
- Then use data checks to decide whether the failure is “ANSI never produced” or “ANSI produced but not rendered”.
- When validating real CLI color, prefer real runtime + real CLI over test stubs.

## Verification

- Real terminal node screenshot after printing explicit colored output
- Real CLI launch in terminal node (for example `codex`) with screenshot comparison
- Environment inspection for `TERM`, `NO_COLOR`, `FORCE_COLOR`, and related color flags

## Lessons

- Treat visible color as a user-facing contract, not a protocol side effect.
- Separate “ANSI missing” from “ANSI present but not rendered” before changing code.
- Recovery correctness does not imply color correctness.
