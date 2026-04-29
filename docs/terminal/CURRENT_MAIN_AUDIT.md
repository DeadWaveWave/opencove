# Terminal Current Main Audit

> Status: Public rebaseline record
> Scope: latest `origin/main` terminal/runtime/recovery architecture
> Last updated: 2026-04-24

## Purpose

This document records what latest `origin/main` actually does today, so our migration plan stays anchored to the real codebase instead of an abandoned refactor branch.

Use this file for:

- current-gap review
- owner and authority audit
- phase-order justification

Use `MULTI_CLIENT_ARCHITECTURE.md` for the target architecture.

## Summary

Latest `origin/main` already has a workable multi-client transport baseline:

- Home Worker exists
- Desktop and Web UI can attach the same PTY stream
- controller/viewer roles exist
- worker runtime processes already exist

But it is still structurally earlier than the target architecture:

1. worker does not yet own canonical terminal presentation truth
2. renderer still owns correctness-level restore logic
3. geometry authority is still too close to controller authority
4. main still retains standalone production runtime ownership

That means the right next move is not another renderer timing patch. The right next move is to establish the worker presentation contract first.

## Current Architecture Findings

## 1. Startup Ownership Is Still Split

Main startup still branches between worker-client mode and standalone local runtime mode.

Key files:

- `src/app/main/index.ts`
- `src/app/main/controlSurface/standaloneMountAwarePtyRuntime.ts`

Current behavior:

- when Home Worker is available, Desktop acts as a worker client
- when effective mode is `standalone`, main still creates a local PTY runtime
- standalone runtime can coexist with remote routing logic

Implication:

- production ownership is still split between worker and main
- “host = worker, main = orchestration only” is not true yet

## 2. Restore Decisions Still Happen In Renderer

Cold restore and old Agent recovery still pass through renderer-side decisions.

Key files:

- `src/app/renderer/shell/hooks/useHydrateAppState.helpers.ts`
- `src/contexts/agent/presentation/renderer/hydrateAgentNode.ts`

Current behavior:

- renderer inspects existing `sessionId` and calls `pty.snapshot`
- renderer decides whether to resume an Agent, relaunch it, or fall back to a plain terminal
- renderer still constructs part of the recovery truth during hydration

Implication:

- restart restore and reopen do not yet share one worker-owned revive path
- renderer is still more than a view/input client

## 3. Renderer Still Owns Correctness-Level Screen State

Renderer still carries its own screen baseline and replacement logic.

Key files:

- `src/contexts/workspace/presentation/renderer/components/terminalNode/screenStateCache.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalPlaceholderSession.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter.ts`

Current behavior:

- cached committed screen state can be restored locally
- placeholder xterm sessions can stand in for runtime state
- post-hydration chunks can still reset and replace what the user sees

Implication:

- restored content is still treated like a provisional baseline
- this is the structural reason content can appear correct and then disappear after input or redraw

## 4. Multi-Client Sync Is Raw-Stream Sync, Not Presentation Sync

Desktop and Web already share a transport, but they do not yet share a worker-owned logical screen state.

Key files:

- `src/app/main/controlSurface/ptyStream/ptyStreamHub.ts`
- `src/app/main/controlSurface/ptyStream/ptyStreamService.ts`
- `src/app/renderer/browser/BrowserPtyClient.ts`

Current behavior:

- the hub replays bounded raw VT chunks with `afterSeq`
- overflow is already first-class
- Web reconnect reattaches sessions as `controller`
- fallback recovery still relies on raw scrollback snapshot semantics

Implication:

- current sync is “shared raw stream”
- target sync must become “shared worker-owned presentation truth”

## 5. Geometry Authority Is Only Partially Constrained

The current geometry model is improved, but still not final.

Key files:

- `src/contexts/workspace/presentation/renderer/components/terminalNode/syncTerminalNodeSize.ts`
- `src/app/main/controlSurface/ptyStream/ptyStreamHub.ts`
- `src/app/renderer/browser/BrowserPtyClient.ts`

Current behavior:

- renderer still measures locally with `fitAddon.fit()`
- controller clients can resize through the hub
- reconnect paths can still bias who becomes the size writer

Implication:

- canonical geometry is not yet a worker-owned contract
- controller authority and resize authority are still too tightly coupled

## Why The Phase Order Changed

Because latest `origin/main` does not yet have worker-owned presentation truth, the correct order is:

1. add worker presentation contract
2. switch renderer to consume that contract
3. then clean geometry authority
4. then unify revive/prewarm
5. then add renderer health/resync
6. then remove old owners

If we try to start from renderer patching again, we keep deepening a design where renderer still owns correctness.

## Decision

Treat latest `origin/main` as the real baseline.

Do not resume the abandoned implementation branch as code.

Preserve only the useful public design conclusions:

- target architecture
- audit summary
- migration plan
- verification policy
