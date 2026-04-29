# Terminal Docs

This directory is the repo entry point for terminal runtime, rendering, recovery, and multi-client behavior.

## Read Order

- `MULTI_CLIENT_ARCHITECTURE.md`: canonical target architecture and owner model.
- `CURRENT_MAIN_AUDIT.md`: what latest `origin/main` actually does today, and where it still diverges.
- `MIGRATION_PLAN.md`: public phase plan for moving current main to the target architecture.
- `VERIFICATION_AND_RECORDS_PLAN.md`: long-term verification, acceptance, and update-record policy.
- `TUI_RENDERING_BASELINE.md`: tactical renderer baseline for current regressions; not the correctness architecture.
- `ANSI_SCREEN_PERSISTENCE.md`: historical note for renderer-cache ANSI persistence workarounds.

## Related Docs

- `../RECOVERY_MODEL.md`: durable recovery ownership model.
- `../DEBUGGING.md`: debugging workflow and reusable repro methods.
- `../cases/WIN10_CODEX_SCROLL_DIAGNOSTICS.md`: Windows Codex terminal diagnostics.
- `../cases/CASE_STUDY_CANVAS_JITTER_AND_TERMINAL_DURABILITY.md`: canvas jitter and terminal durability case study.
- `../cases/terminal-no-color-visual-debug.md`: visual debugging checklist for no-color output.
- `../cases/xterm-hit-test-cursor-flicker.md`: xterm cursor and hit-test flicker case study.

## Maintenance Rules

- Change `MULTI_CLIENT_ARCHITECTURE.md` first when ownership, revive semantics, geometry policy, or multi-client contracts change.
- Change `CURRENT_MAIN_AUDIT.md` when the current-main gap analysis changes materially.
- Change `MIGRATION_PLAN.md` when phase order, scope, or current execution strategy changes.
- Change `VERIFICATION_AND_RECORDS_PLAN.md` when the active phase order or acceptance gates change.
- Keep tactical notes tactical: baseline docs and case studies should link back to the canonical architecture instead of redefining terminal truth locally.
