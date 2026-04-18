<div align="center">

# OpenCove 🌌

**An infinite canvas for Claude Code, Codex, terminals, tasks, and notes.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)]()
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)]()
[![简体中文](https://img.shields.io/badge/Language-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue)](./README_ZH.md)

Keep every agent, terminal, task, and note on one infinite canvas.

See parallel work at a glance, keep context visible, and resume exactly where you left off.

[Download the latest builds](https://github.com/DeadWaveWave/opencove/releases) · [Read the Chinese README](./README_ZH.md)

<img src="./assets/images/opencove_header_readme.jpg" alt="OpenCove Header" width="100%" />

</div>

## 📖 What is OpenCove?

OpenCove is a **spatial development workspace** for people who work with AI coding agents every day.

Instead of burying work inside tabs, sidebars, and long chat threads, OpenCove puts your **AI agents**, **terminals**, **tasks**, and **notes** on the same infinite 2D canvas, so the full state of your work stays visible.

It is built for workflows like:

- Running multiple `Claude Code` or `Codex` sessions side by side
- Keeping task plans, notes, and terminal output in one shared workspace
- Switching projects without losing layout, context, or execution history

<img src="./assets/images/opencove_app_preview_readme.jpg" alt="OpenCove App Preview" width="100%" />

## ✨ Highlights

- **🌌 Infinite spatial canvas**: Arrange terminals, notes, tasks, and agent sessions the way you actually think.
- **🤖 Built for CLI agents**: Optimized for `Claude Code`, `Codex`, and similar terminal-native agent workflows.
- **🧠 Context stays visible**: Planning, execution, and results live together instead of getting buried in linear chat history.
- **💾 Persistent workspaces**: Restore your viewport, layout, terminal output, and agent state after restarts.
- **🗂️ Space archives**: Snapshot and revisit previous workspace states when you need to jump back into old contexts.
- **🖼️ Rich media and smart layouts**: Paste images, multi-select nodes, use label colors, and tidy messy boards quickly.
- **🔍 Global search and control center**: Search across the canvas and terminal output, then manage active sessions from one place.
- **🗂️ Workspace isolation**: Separate projects cleanly with directories and git worktrees.

## 💡 Why OpenCove?

OpenCove is designed around a simple idea: **agent workflows are easier to reason about when context is spatial, not hidden**.

| Pain Point (Traditional) | The OpenCove Workspace |
| :--- | :--- |
| **Linear amnesia**: context disappears into long chat histories. | **Spatial context**: important tasks, notes, and execution stay visible on the canvas. |
| **Single-pane bottlenecks**: tabs and split panes force constant context switching. | **Parallel execution**: compare and monitor multiple agents without losing your place. |
| **Opaque automation**: background agent work feels like a black box. | **Transparent actions**: terminals and side effects stay visible while work is happening. |

## 🚀 Getting Started

*OpenCove is currently in Alpha. We recommend it for early adopters and power users who want to explore spatial AI workflows.*

### Download

Prebuilt binaries are available on the [GitHub Releases](https://github.com/DeadWaveWave/opencove/releases) page.

At the moment, most public builds are **nightly / prerelease builds**, which means:

- You get the newest features first
- You should expect rough edges
- Feedback and bug reports are especially valuable

Downloads are available for macOS, Windows, and Linux.

> **⚠️ macOS note**
> Current macOS builds are **not signed or notarized** with an Apple Developer ID. If Gatekeeper blocks the app, run this in your terminal:
> ```bash
> xattr -dr com.apple.quarantine /Applications/OpenCove.app
> ```

### Building from Source

#### Prerequisites
- Node.js `>= 22`
- pnpm `>= 9`
- (Recommended) Globally install `Claude Code` or `Codex` to experience full agent workflows.

#### Build Instructions

```bash
# 1. Clone the repository
git clone https://github.com/DeadWaveWave/opencove.git
cd opencove

# 2. Install dependencies
pnpm install

# 3. Start the dev environment
pnpm dev
```

> See [RELEASING.md](docs/RELEASING.md) for more packager and build documentation.

### Web UI (Experimental)

OpenCove includes an **experimental Worker-hosted Web UI** so you can open the canvas from a browser (including other devices on your LAN).

- In **Settings → Experimental → Worker Web UI**, turn on **Enable Web UI** (optionally set a fixed port), then start the Local Worker.
- By default it is loopback-only (`127.0.0.1`). For LAN access, enable **LAN Access** and set a Web UI password.
- Dev note: LAN access uses the built `out/renderer` bundle (no HMR). Run `pnpm build` after UI changes.

More details:
- `docs/CONTROL_SURFACE.md`
- `docs/WEB_UI_TROUBLESHOOTING.md`

## 🏗️ Technical Architecture

OpenCove is built with modern, high-performance web standards:

- **Framework**: Electron + React + TypeScript (via `electron-vite`)
- **Canvas Engine**: `@xyflow/react` for buttery smooth infinite canvas interactions.
- **Underlying Terminal**: `xterm.js` and `node-pty` powering full-fledged PTY runtimes.
- **Testing**: `Vitest` and `Playwright` for robust unit and E2E regression testing.

## 🤝 Contributing

OpenCove is open source. We need your help to define what the IDE of the AI intelligence era should look like.
Read our guidelines below:

- [Contributing Guidelines (CONTRIBUTING.md)](./CONTRIBUTING.md)
- [Code of Conduct (CODE_OF_CONDUCT.md)](./CODE_OF_CONDUCT.md)
- [Support (SUPPORT.md)](./SUPPORT.md)
- [Trademarks & Brand Guidelines (TRADEMARKS.md)](./TRADEMARKS.md)

## 💬 Community Group

Scan the QR code below to join the OpenCove community group and chat with other users.

<div align="center">
  <img src="./assets/images/opencove_qrcode.png" alt="OpenCove Community Group QR Code" width="320" />
</div>

---

<div align="center">

<p>Redefining dev environments for the modern web.<br>Built with ❤️ by the OpenCove Team.</p>

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

</div>
