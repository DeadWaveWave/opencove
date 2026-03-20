# Changelog

All notable changes to **OpenCove** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🚀 Added
- Settings: UI theme selector (system/light/dark) with system follow. (#40)
- UI: App header with primary sidebar toggle + top-right settings (macOS uses unified title bar chrome).
- UI: Command Center in header (search + project/space switcher) with Cmd/Ctrl+K and Cmd/Ctrl+P shortcuts.

### 💅 Changed
- Workspace pane context menu: “Run Agent” can expand to pick an installed agent CLI.
- Settings: reorganized into per-tab pages; added an Agent tab for provider defaults, menu order, and model overrides.
- Settings: panel typography (including model overrides) now follows the Interface Font Size setting. (#40)
- UI: refined light theme palette across canvas, nodes, and settings; minimap becomes subtle when idle and clearer on hover. (#40)

### 🐞 Fixed
- Light theme: fix white text in Settings > Custom Model overrides. (#40)

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
