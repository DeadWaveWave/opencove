<div align="center">

> [!WARNING]  
> ## This is NOT the official OpenCove repository  
> **This is a third-party fork of the [official OpenCove project](https://github.com/DeadWaveWave/opencove).**  
> **Original author: [DeadWaveWave (Haojie Shi)](https://github.com/DeadWaveWave) • Upstream: [github.com/DeadWaveWave/opencove](https://github.com/DeadWaveWave/opencove)**  
> For official releases, downloads, or bug reports, please visit the upstream repository. This fork is maintained independently. Issues with this fork should be reported here.

---

# OpenCove 🌌 + Hermes

**An infinite canvas for Claude Code, Codex, Hermes, Gemini CLI, terminals, tasks, and notes.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)]()
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)]()
[![简体中文](https://img.shields.io/badge/Language-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-blue)](./README_ZH.md)
[![Hermes](https://img.shields.io/badge/Hermes-Integrated-teal.svg)](https://github.com/DeadWaveWave/hermes-agent)
[![Modified](https://img.shields.io/badge/Fork-Modified-red.svg)](https://github.com/DeadWaveWave/opencove)

</div>

---

## ⚡ About This Fork

This fork is maintained by **[@UbiStaff](https://github.com/UbiStaff)**. It adds [Hermes Agent](https://github.com/DeadWaveWave/hermes-agent) Provider integration on top of the [official OpenCove](https://github.com/DeadWaveWave/opencove) by [DeadWaveWave](https://github.com/DeadWaveWave).

### What's Changed

**Added Hermes CLI as a 5th native Agent engine**, usable alongside Claude Code, Codex, OpenCode, and Gemini CLI on the opencove canvas.

| Layer | Details |
|-------|---------|
| Settings panel | New Hermes provider option with configurable executable path |
| Agent nodes | Create Hermes agent nodes on canvas, launching interactive terminals |
| Command modes | `hermes chat` (interactive) / `hermes chat -q <prompt>` / `--resume <id>` |
| Session management | Auto-discover and resume sessions from `~/.hermes/sessions/sessions.json` |
| Type system | Extended `AgentProviderId`, `AgentModelCatalogSource`, and all related unions |
| IPC validation | All provider validation gates updated (normalizeProvider, normalizeAgentProviderId, managedAgentProvider) |
| Frontend UI | Layered diamond SVG icon + teal accent color + EN/ZH labels |
| Tests | Updated 3 unit test suites for provider order and defaults |

### Screenshots

#### Settings — Enable Hermes Provider

![Hermes Settings](https://raw.githubusercontent.com/UbiStaff/opencove/main/assets/screenshots/hermes-settings.png)

#### Canvas — Hermes Agent in Action

![Hermes Canvas](https://raw.githubusercontent.com/UbiStaff/opencove/main/assets/screenshots/hermes-canvas.png)

### Upstream PR

Changes submitted to upstream: **[#277 feat: add Hermes agent provider integration](https://github.com/DeadWaveWave/opencove/pull/277)**

### Install This Fork

```bash
git clone https://github.com/UbiStaff/opencove-hermes.git
cd opencove-hermes
pnpm install
pnpm dev
```

> [!NOTE]
> Requires [Hermes CLI](https://github.com/DeadWaveWave/hermes-agent) to be pre-installed. Enable Hermes in opencove Settings → Agent Providers.

---

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

### CLI and Server Install

You now have two supported ways to install the `opencove` CLI:

- From the Desktop app: open **Settings → Worker → CLI** and click **Install CLI**.
- Without Desktop: use a GitHub Release that includes standalone runtime bundles
  (`opencove-server-*`) plus release-specific installer assets such as
  `opencove-install-v<tag>.sh` / `opencove-install-v<tag>.ps1`. Stable releases also
  publish the generic `opencove-install.sh` / `opencove-install.ps1` aliases, which
  always target the latest stable release.

If `releases/latest/download/opencove-install.sh` returns `404`, the latest stable release
has not published the standalone installer yet. In that case, use the Desktop installer for
now or wait for a release that includes those assets.

For the latest stable release, install on macOS / Linux with:

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh | sh
```

On Windows, use PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.ps1 | Invoke-Expression"
```

For a nightly or any specific tagged release, use the versioned installer asset from that
release page:

```bash
curl -fsSL https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.sh | sh
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://github.com/DeadWaveWave/opencove/releases/download/v<version>/opencove-install-v<version>.ps1 | Invoke-Expression"
```

For a headless server that hosts the Web UI, start the worker directly after install:

```bash
opencove worker start --hostname 0.0.0.0 --web-ui-password 'change-me'
```

This prints the Web UI URL and enables password login for browser access. Keep the password set whenever you expose the Web UI beyond localhost.

### Building from Source

#### Prerequisites
- Node.js `>= 22.12.0`
- pnpm `9.6.0`
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

> See [RELEASING.md](docs/runtime/RELEASING.md) for more packager and build documentation.

### Web UI (Experimental)

OpenCove includes an **experimental Worker-hosted Web UI** so you can open the canvas from a browser (including other devices on your LAN).

- In **Settings → Experimental → Worker Web UI**, turn on **Enable Web UI** (optionally set a fixed port), then start the Local Worker.
- By default it is loopback-only (`127.0.0.1`). For LAN access, enable **LAN Access** and set a Web UI password.
- Dev note: LAN access uses the built `out/renderer` bundle (no HMR). Run `pnpm build` after UI changes.

More details:
- `docs/architecture/CONTROL_SURFACE.md`
- `docs/runtime/WEB_UI_TROUBLESHOOTING.md`

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
