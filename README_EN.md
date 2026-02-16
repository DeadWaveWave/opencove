
[简体中文](./README.md) | English

![Cove_Header](./assets/images/cove_header.jpg)

# Cove 🌌

> **The Infinite Canvas for AI Engineering | AI 时代的无限画布工程台**

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Status](https://img.shields.io/badge/status-alpha-orange.svg) ![Electron](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

**Cove is an AI coding workspace born for the "Post-Chat Era".**

When AI coding evolves from simple "chat" to complex "task orchestration," traditional IDE terminals and chat windows fall short. Cove provides an **Infinite Deep Space Canvas**, allowing you to orchestrate multiple AI agents, manage task flows, and reorganize fragmented context spatially within a single view.

Say goodbye to chaotic tab switching. Embrace a **visual, spatial** paradigm for AI collaboration.

---

## ✨ Key Features

### 🌌 Infinite Deep Space Canvas
Organize your work on a virtually infinite 2D plane. Arrange terminals, agent sessions, and task cards freely like a mind map.
- **Spatial Memory**: Leverage your spatial cognition—set top-left for "backend services" and bottom-right for "frontend debugging."
- **Global Overview**: Seamlessly zoom out for a macroscopic view of your project or dive into microscopic details.
- **Persistent Viewport**: Your every drag and zoom is saved. Next time you open it, you're right back at the "scene of the crime."

### 🤖 Multi-Agent Orchestration
Don't limit your agents to a single sidebar. In Cove, you can run multiple agent instances simultaneously.
- **Parallel Execution**: Run **Claude Code** on the left for architectural refactoring, while **Codex** on the right writes unit tests.
- **Visualized State**: Intuitively see whether each agent is thinking, executing commands, or waiting for confirmation.
- **Unified Protocol**: Whether it's Claude or OpenAI under the hood, Cove manages their PTY lifecycle with a unified protocol.

### 🔮 Cyber-Glass Immersive UI
A **Deep Space Cyber-Glass** design language crafted for developers.
- **Deep Space Aesthetics**: Deep dark background + neon glow, focused coding without eye strain.
- **Frosted Glass Texture**: Modern translucent containers with clear hierarchy and a breathing feel.
- **Interaction Details**: Collision detection, smooth animations, magnetic alignment—every interaction is polished.

---

## 🚀 Why Cove?

| Traditional Mode | Cove Mode |
| :--- | :--- |
| **Linear Chat**: Context is pushed away by chat history, hard to backtrack. | **Spatial Nodes**: Key information stays permanently on the canvas, WYSIWYG. |
| **Single Task**: Chat with one agent about one thing at a time. | **Multi-Threaded**: Command multiple agents on different modules in parallel. |
| **Black Box**: Unsure what the agent is secretly doing in the terminal. | **Transparent Oversight**: Every terminal operation by the agent is shown in real-time PTY nodes. |

---

## 🛠️ Quick Start

Cove is currently in Alpha. Developers are welcome to try it out.

## 📦 Downloads (macOS)

Download `.dmg` / `.zip` from GitHub Releases.

> Current releases are **NOT signed or notarized** with Apple Developer ID. If Gatekeeper blocks the app on first launch:
>
> - Finder: right-click `cove.app` → **Open** → confirm again
> - Or in Terminal (after copying to Applications): `xattr -dr com.apple.quarantine /Applications/cove.app`

### Prerequisites
- Node.js `>= 22`
- pnpm `>= 9`
- `claude` or `codex` CLI recommended for full agent features

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/cove.git

# Install dependencies
pnpm install

# Start development environment
pnpm dev
```

See `docs/RELEASING.md` for release/packaging notes.

---

## 🏗️ Tech Stack

Built on modern Web standards and Electron:
- **Electron + React + TypeScript** (`electron-vite`)
- **@xyflow/react** (formerly ReactFlow) driving the infinite canvas
- **xterm.js + node-pty** providing industrial-grade terminal capabilities
- **Vitest + Playwright** ensuring rock-solid quality

## 🤝 Contributing

Cove is an open-source project. We need your help to define the IDE form factor of the AI era.
See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

---

<div align="center">
  <sub>Built with ❤️ by the Cove Team. MIT License.</sub>
</div>
