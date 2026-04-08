# Contributing to OpenCove 🤝

First off, thank you for considering contributing to OpenCove! 🎉

OpenCove is an ambitious open-source project aimed at redefining how we interact with AI agents in a spatial workspace. Building a high-performance, complex desktop OS-like environment requires discipline. To ensure we can iterate rapidly without breaking the core experience, we maintain strict engineering and architectural standards.

> **🚨 CRITICAL FIRST STEP:**
> Before you write any code, you **MUST** read [DEVELOPMENT.md](./DEVELOPMENT.md). 
> It contains our architectural boundaries, state ownership rules, and execution workflows. **All PRs are expected to strictly adhere to the guidelines outlined there.**

---

## 🧭 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Contributor License Agreement (CLA)](#-contributor-license-agreement-cla)
- [Development Workflow](#-development-workflow)
- [The Golden Rules of Engineering](#-the-golden-rules-of-engineering)
- [Pull Request Process](#-pull-request-process)

---

## Code of Conduct

This project and everyone participating in it is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## 📄 Contributor License Agreement (CLA)

To keep the Project healthy and to preserve future distribution options (including commercial licensing), we require most contributions to be covered by our Contributor License Agreement (CLA).

- Read the agreement: [CLA.md](./CLA.md)
- **Signing flow**: When you open a PR, an automated CLA check may ask you to sign/confirm the CLA before we can merge.
- **No retroactive chasing**: We do not require retroactive signatures for contributions merged before the CLA check was enabled.
- **Contributing on behalf of an employer**: Make sure you have permission to contribute under the CLA terms. If your company requires a corporate CLA, contact the Steward listed in `CLA.md`.
  - Maintainers: see `docs/CLA_SETUP.md`.

## 💻 Development Workflow

### Prerequisites

- **Node.js**: `>= 22`
- **pnpm**: `>= 9`
- **OS**: macOS, Windows, or Linux

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/DeadWaveWave/opencove.git
cd opencove

# 2. Install dependencies
pnpm install

# 3. Start the dev environment
pnpm dev
```

### Verification & CI

Before submitting a Pull Request, you must ensure your code meets our quality bar.

| Command | Description |
| :--- | :--- |
| `pnpm pre-commit` | **The ultimate gatekeeper.** Runs type checks, linting, formatting, and tests. |
| `pnpm test -- --run` | Runs the unit test suite natively. |
| `pnpm test:e2e` | Runs Playwright end-to-end tests (requires `pnpm build` first). |

---

## 📐 The Golden Rules of Engineering

To get your PR merged quickly, your contribution must reflect the values detailed in `DEVELOPMENT.md`:

1. **Zero Failing CI**: Your PR **MUST pass all CI checks** (`pnpm pre-commit` must be completely green). We do not merge code with failing tests, type errors, or lint warnings.
2. **Lock Behavior with Tests**: Every meaningful code change (especially bug fixes and new features) **MUST** include corresponding tests to lock down the behavior. Do not just fix the bug; write the test that proves the bug can never return.
3. **Respect State Ownership**: If your PR touches persistence, IPC boundary, or recovery state, explicitly document who the "owner" of that state is. Multiple writers to the same source of truth will be rejected.
4. **Clean Architecture**: Never mix IO/IPC concerns with UI rendering. Keep the `Main`, `Preload`, and `Renderer` boundaries mathematically clean.

---

## 📥 Pull Request Process

1. **Keep it Focused**: A PR should do one thing well. If you are fixing a bug and refactoring a module, split them into two separate PRs.
2. **Conventional Commits**: Use conventional prefixes for your PR titles (e.g., `feat: spatial task layout`, `fix: terminal resize panic`, `chore: update deps`).
3. **Prove Your Work**: 
   - If it's a UI change, **attach screenshots or a screen recording**.
   - If it's a runtime-risk change, explain the invariants you considered and the test layer you chose to prove them.
4. **Self-Review**: Review your own diff before submitting. Make sure no console logs, `any` types, or commented-out code slipped through.

---

<div align="center">

**Happy Coding! 🚀 Let's build the future of AI IDEs together.**

</div>
