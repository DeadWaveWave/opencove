# Changelog

All notable changes to **OpenCove** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🚀 Added
- Workspace canvas: experimental website window nodes with opt-in settings, shared-session profile modes, snapshot-backed warm/cold lifecycle, and in-canvas navigation handling. (#141)
- Space Explorer: VS Code-like file and folder operations, including drag-move, context menu actions, cut/copy/paste, rename, delete, and copy path. (#123)
- Space Explorer: side-by-side quick preview with drag-to-materialize document nodes, line numbers, theme-aware styling, and stabilized formal open/close behavior. (#143)
- Sidebar: drag-to-reorder workspace projects with dnd-kit, persisted sort order, and migration backfill for existing databases. (#87)
- Workspace canvas: arrange all / arrange canvas / arrange in space actions. (#42)
- Workspace canvas: Arrange By menu (scope, ordering, space sizing, magnetic snapping). (#42)
- Workspace canvas: live magnetic snap guides for node dragging, aligned to the 24px canvas rhythm and enabled by default. (#42)
- Workspace canvas: unified tiled arrange layout with standard node ratios (terminal/task/agent/note) and balanced dense packing. (#42)
- Workspace canvas: paste/drag-drop images into the canvas as borderless image nodes with aspect-locked resize. (#74)
- Workspace: Cmd/Ctrl+F opens a right-side search panel for spaces/tasks/notes; terminal-focused Cmd/Ctrl+F opens in-terminal find. (#78)
- Settings: UI theme selector (system/light/dark) with system follow. (#40)
- UI: App header with primary sidebar toggle + top-right settings (macOS uses unified title bar chrome).
- UI: Command Center in header (search + project/space switcher) with Cmd/Ctrl+K and Cmd/Ctrl+P shortcuts.
- UI: Control Center + agent standby banner notifications (with configurable context chips). (#81)
- Spaces: Space Archives — archive Space snapshots + replay window (Command Center). (#80)
- In-canvas GitHub pull request chip for worktree-bound Spaces (opens on GitHub; requires `gh`).
- Settings → Integrations tab with a GitHub PR links toggle (default on).
- In-app update checker with stable/nightly tracking (nightly supports prompt only) plus a first-launch “What’s New” sheet after updates. (#49)
- Workspace canvas: Label colors for Spaces and windows, plus a single-color filter. (#54)
- Settings: configurable focus target zoom with slider-only live preview and neutral 100% marker. (#56)
- Settings: standard window size bucket (compact/regular/large) for node create/arrange sizing (replaces runtime auto-sizing). (#70)
- Settings: configurable canvas mouse-wheel behavior (zoom vs pan) with a configurable zoom modifier (Cmd/Ctrl+wheel by default). (#127)
- Task: prompt templates for task requirement prefix injection (Global + Project scopes). (#71)
- Sync-first: multi-client snapshot + revision + SSE `/events` for the worker control surface (Desktop/Web/CLI). (#122)
- Worker: PTY session streaming over the control surface (`WS /pty`) + ticket→cookie web auth for the Worker Web Shell. (#133)

### 💅 Changed
- Workspace canvas: context menus now stay near the pointer, only flip on real overflow, and reorder note/space actions for faster access. (#64)
- What's New: switched update notes from runtime GitHub compare fetching to release-manifest delivery embedded in each build. (#67)
- Workspace canvas: keep Arrange By menu open while tweaking options (dismiss on outside click). (#42)
- Workspace canvas: arrange spaces before root nodes during canvas/global arrange. (#42)
- Workspace canvas: default arrange now keeps standard-size alignment always on and resizes spaces to the fitted tiled result. (#42)
- Workspace canvas: tiled arrange now keeps an idea lane first, can open that lane into two note columns when space allows, then places task + linked agent groups before standalone agents / terminals. (#42)
- Workspace canvas: dense packing now favors balanced aspect ratios over ultra-tall stacks for more shelf-like results. (#42)
- Workspace canvas: drag now previews live snap guides continuously and only commits magnetic snapping on release for steadier pointer movement. (#42)
- Workspace canvas: show drag-surface overlays only for multi-select (Shift+click/marquee) and treat mixed selection with Spaces as space-dominant drag. (#82)
- Workspace canvas: Arrange By now simplifies Space sizing to `Tighten Space` / `Keep Space size`, defaults to `Tighten Space`, and moves magnetic snapping to the top-level context menu. (#42)
- Settings: default UI theme is now dark. (#69)
- Shortcuts: Yield app shortcuts to the terminal when it’s focused (configurable), and allow customizing keybindings in Settings → Shortcuts. (#59)
- Shortcuts: unify app and workspace-canvas keybindings under single-bind customization, make canvas shortcuts recordable, and switch Command Center to Cmd/Ctrl+P by default. (#68)
- Simplified GitHub PR integration to a link-only chip (removed in-canvas PR panel/actions/diff/checks UI for now).
- UI: Softened minimap node colors in light theme. (#47)
- UI: Made modal dialogs opaque for clearer readability. (#48)
- Spaces: dragging Terminal/Agent windows across directory-bound spaces now shows a compact confirmation, then moves with `DIR MISMATCH` labeling. (#51)
- Spaces: warn before closing the last node in a space when it would become empty and auto-close, using the shared warning dialog shell. (#66)

### 🐞 Fixed
- OpenCode: Stabilized embedded terminal rendering and cursor hit-testing to eliminate shutter-like artifacts and cursor flicker in restored canvas sessions. (#144)
- OpenCode: Embedded agent terminals now follow OpenCove UI theme and re-theme reliably when switching light/dark. (#155)
- Crash recovery: recover from renderer and child-process failures with a localized error boundary and lifecycle logging to prevent silent white screens. (#137)
- Website window: keep embedded pages clipped inside canvas nodes during zoom/occlusion, preserve stable 100% page scale, and route in-page/new-window navigation back into OpenCove. (#141)
- Startup + shortcuts: avoid non-packaged locale hydration stalls and stabilize `Cmd/Ctrl+G` space creation when selected terminal nodes are involved. (#141)
- Terminal: Added Linux terminal-node shortcuts for `Ctrl+Shift+C` copy and `Ctrl+Shift+V` paste while preserving plain `Ctrl+C` as `SIGINT`. (#142)
- Agent windows now inherit terminal profile runtime/env semantics during launch, recovery, and fallback; Windows raw-TUI wheel handling is covered by regression tests. (#110)
- UI: unified shared menu overlays to fix prompt template, task session, and related context-menu offset issues. (#121)
- Persistence: Repair cumulative SQLite schema upgrades and auto-heal mis-versioned local databases so workspace state saves no longer fail after upgrading from older installs. (#76)
- Spaces: New windows created from a crowded space now preserve existing window layout, expand the space only as needed, and keep the viewport centered on the final position. (#62)
- Settings: update status now summarizes updater feed parsing errors instead of dumping raw parser/CSP output. (#67)
- macOS: Disable in-app update checks for unsigned/ad-hoc builds and show actionable guidance instead of failing code signature validation. (#128)
- Workspace canvas: fix pane context menu rendering regression and harden right-click coordinates. (#42)
- Workspace canvas: align collision normalization with the 24px snap grid to avoid post-drag drift. (#42)
- Workspace canvas: clamp live snap-guide overlays to the viewport so vertical guides no longer trigger canvas scrollbars while dragging. (#42)
- Workspace canvas: note-to-task conversion now resizes to the standard task size and pushes away overlapping nodes. (#63)
- Workspace canvas: keep push-away projection live during drag while sync refreshes apply. (#133)
- Prevented canvas zoom/pan when scrolling inside overlay windows.
- Codex: Fixed agents getting stuck on `working` and missing standby notifications when switching projects or after restart. (#81)
- Restored packaged terminal rendering by allowing xterm's required inline style channels in production and ignoring invalid cached terminal dimensions during hydration.
- Terminal: Hydrate UTF-8 locale for GUI-launched terminals on macOS/Linux and enable Wayland IME integration on Linux. (#65)
- Terminal: Preserve shell history arrow keys after terminal restore by avoiding stale xterm mode replay. (#65)
- Windows: Fixed double header / mismatched chrome by switching to hidden title bar + titlebar overlay and syncing overlay theme with app theme. (#47)
- Windows: Fixed native select dropdown styling issues (notably dark mode) by using a custom select component across the UI. (#47)
- Terminal: Fixed theme glitches when switching light/dark by syncing xterm theme with CSS tokens and reacting to theme change events. (#47)
- OpenCode: Keep embedded agent terminals pinned to dark theme to avoid partial light/dark desynchronization. (#60)
- Canvas: Stabilized auto input-mode detection to default to mouse semantics until high-confidence trackpad gestures are observed. (#47)
- Worktree window: Fixed light theme text colors in the create/archive dialog. (#47)
- Worktree create: Detect repos without commits and show an actionable error instead of failing to create the worktree. (#120)
- Worktree create: Branch dropdown no longer jumps to the top while scrolling. (#126)
- Task: Typing in the Task Name input no longer collapses Advanced Settings. (#48)
- Improved canvas drag smoothness under heavy terminal output by throttling terminal screen writes during viewport interaction while keeping output live. (#50)
- Normalized node resize and terminal selection drags while the canvas is zoomed. (#56)
- Stabilized and optimized space-bounded push-away reflow during node dragging to prevent edge overlaps/stacking. (#57)
- Workspace canvas: arrange is now aspect-aware, avoids large empty gaps, and auto-fits the viewport after arranging; created-time ordering is deterministic across node types. (#72)
- Workspace canvas: arrange-in-space now focuses the space bounds and caps zoom at the configured focus target zoom. (#131)
- Terminal: Prevented `node-pty` native aborts from crashing the whole app by isolating PTY into a utility process. (#75)
- Terminal: Prevented terminal/agent nodes from clipping the last row/column and showing a black gutter around the embedded terminal. (#150)
- Spaces: Fixed Space pills truncating and made worktree branch/PR chips refresh without switching projects. (#129)
- Terminal: Prevent focus loss and font resets when submitting commands or after clicking header then terminal body. (#130)
- Workspace canvas: Keep node focus rings stable while typing in terminal/task inputs (reduces border “wink”). (#151)

---

## [0.2.0] - 2026-03-12

Welcome to OpenCove 0.2.0! This release focuses on unifying the workspace experience, hardening runtime stability for AI Agents, and introducing formal multi-platform release pipelines.

### ✨ Highlights
- **Unified Workspace Chrome**: Terminals, tasks, and notes now share a tighter, cohesive visual design (Node Chrome), making the infinite canvas feel like a single, seamless OS.
- **Enhanced Worktree Management**: Managing Git worktrees is now safer and more practical. Added clear archive states, deterministic confirmation flows, and space-aware worktree panels.
- **Agent & Runtime Stability**: Hardened the PTY lifecycle, background probe fallbacks, and Codex phase detection to ensure your agents never lose sync, even under heavy load.

### 🚀 Added
- **Unified Node Chrome**: Consistent UI across terminal, note, and task nodes on the canvas.
- **Space-Level Worktrees**: Expanded worktree management with clear archive status and panel integrations.
- **Multi-Platform Releases**: Added GitHub Release automation for macOS, Windows, and Linux artifacts.

### 💅 Changed
- **Refined UX/UI**: Improved space resize feedback, worktree dialogs, and default configurations for tasks/worktrees.
- **Deterministic Workflows**: Disabled AI-generated task/worktree naming by default to prevent unpredictable creation flows.
- **Brand Standardization**: Standardized project branding, metadata, and release preparation tooling under the `OpenCove` identity.

### 🐞 Fixed
- **Persistence & Data Integrity**: Fixed flush retry behavior and byte accounting to eliminate data loss risks during high save pressure.
- **Agent Sync**: Fixed `Codex` agent phase detection so AI commentary and final states correctly map to runtime statuses.
- **Terminal Lifecycle**: Resolved regressions involving scrollback invalidation, background probe fallback, and PTY cleanup.
- **Canvas Interactions**: Fixed edge cases related to active-agent task moves, action ref syncs before paint, and worktree archive entry flows.

---

## [0.1.0] - 2026-02-18

### 🎉 Initial Alpha Release: The Infinite Canvas

We are thrilled to unveil the first public alpha of OpenCove! This release lays the foundation for a spatial, agent-native workspace built on top of Electron, React, and TypeScript. 

### ✨ Features
- **Infinite Canvas Workspace**: A boundless 2D plane to organize your thoughts, planning, and tools. Pan, zoom, and explore your codebase spatially.
- **Spatial Terminals**: Full-fledged `xterm.js` terminals running directly on the canvas with support for `spawn`, `resize`, and `kill`.
- **Agent CLI Integration**: First-class, localized support for `Claude Code` and `Codex`. Visualize your AI agents as they work side-by-side.
- **Task Management**: Create, edit, and spatially link tasks directly to your agents, tracing the path from idea to implementation.
- **Contextual Workspaces**: Seamlessly switch between different project contexts without losing your spatial arrangement or terminal state.

### 🛠️ Architecture & Under the Hood
- **Local-First**: Your data and workspace state stay entirely on your machine.
- **Tech Stack**: Built on `Electron + React + TypeScript` for native desktop performance.
- **Reliability First**: Shipped with a comprehensive E2E test suite via `Vitest` and `Playwright` to ensure a stable alpha foundation.

---

*For historical changes and detailed commit logs, please refer to the [commit history](https://github.com/DeadWaveWave/opencove/commits/main).*
