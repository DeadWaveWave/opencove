# Case Study: Terminal No-Color / All-White Output Needs Visual Debugging

Date: 2026-04-13
Scope: terminal or agent sessions that looked visually colorless even when recovery, scrollback, or ANSI handling seemed otherwise correct.

## Problem Statement

Observed symptom:

- terminal or agent output looked all white / colorless
- but protocol-level checks could still suggest that the session was otherwise healthy

The key lesson was that **ANSI presence and visible color are different validation layers**.

## Why This Was Misleading

A recovery pipeline can look correct in multiple ways while the user-visible result is still wrong:

- placeholder history shows up
- restored session attaches
- `pty:snapshot` contains ANSI escape sequences

None of that proves the user can actually see color on screen.

## What Had To Change In The Debug Approach

This class of issue required **visual debugging**, not just protocol inspection.

The lowest-cost visual checks were:

1. print an explicit colored token in a terminal node, for example green text
2. or launch the real CLI TUI that the user reported, such as `codex`
3. then inspect the actual rendered result or screenshot

If the user report is specifically about “Codex startup indicator should be green”, then the only trustworthy validation is to launch real `codex` in a real terminal node and compare screenshots.

## Why `NODE_ENV=test` Was Not Enough

`pnpm test:e2e` runs in `NODE_ENV=test`.

In that mode:

- test stubs may replace real CLI behavior
- protocol-level recovery checks can still pass
- visual conclusions about a real CLI can still be wrong

So for real CLI color problems, the reliable path was:

- `pnpm build`
- `pnpm dev` or equivalent real app runtime
- real terminal node
- real CLI launch
- visual comparison

## The Two Root-Cause Buckets

The first useful split was:

### 1) ANSI never produced

Evidence:

- very few or no color escape sequences in PTY output

Likely areas:

- spawn environment
- `TERM`
- `NO_COLOR`
- `NODE_DISABLE_COLORS`
- delayed or missing probe replies during attach/hydration

### 2) ANSI exists, but still renders as white/gray

Evidence:

- PTY output clearly contains color sequences
- rendered result still looks colorless

Likely areas:

- xterm palette/theme
- UI theme synchronization
- DOM/WebGL renderer differences

## Environment Pitfall

One especially misleading variable was `FORCE_COLOR`.

Some test runners inject it even when the shell does not. That can:

- force color when the real app would not have it
- or hide an auto-detection failure during debugging

When investigating no-color behavior, environment variables around color must be treated as evidence, not background noise.

## Reusable Lessons

- Treat visible color as a UI contract, not a protocol side effect.
- Use screenshots or direct observation for color regressions.
- Separate “ANSI absent” from “ANSI present but not rendered”.
- Do not declare success just because snapshot/placeholder/recovery looks correct.
