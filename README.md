简体中文 | [English](./README_EN.md)

![Cove_Header](./assets/images/cove_header.jpg)

# Cove 🌌

> **AI 时代的无限画布工程台 | The Infinite Canvas for AI Engineering**

![License](https://img.shields.io/badge/license-MIT-blue.svg) ![Status](https://img.shields.io/badge/status-alpha-orange.svg) ![Electron](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

**Cove 是一个为了“后 Chat 时代”而生的 AI 编码工作区。**

当 AI 编码不再仅仅是“对话”，而变成复杂的“任务编排”时，传统的 IDE 终端和聊天窗口已捉襟见肘。Cove 提供了一个**无限的深空画布**，让你在一个视图中指挥多个 AI Agent，管理任务流转，并将破碎的上下文重新通过空间组织起来。

告别混乱的 Tab 切换，拥抱**可视化、空间化**的 AI 协作新范式。

---

## ✨ 核心特性

### 🌌 无限深空画布 (Infinite Canvas)
在一个近乎无限的二维平面上组织你的工作。将终端、Agent 会话、任务卡片像思维导图一样自由摆放。
- **空间记忆**：利用人类的空间记忆能力，将左上角设为“后端服务”，右下角设为“前端调试”。
- **全局概览**：通过缩放（Zoom）瞬间从宏观视角俯瞰整个项目，或潜入微观细节。
- **持久化视口**：你的每一次拖拽和缩放都会被保存，下次打开即是上次的“案发现场”。

### 🤖 多 Agent 协同编排 (Agent Orchestration)
不要让你的 Agent 局限在单一的侧边栏里。在 Cove 中，你可以同时运行多个 Agent 实例。
- **并行执行**：左侧运行 **Claude Code** 进行架构重构，右侧运行 **Codex** 编写单元测试。
- **可视化状态**：直观看到每个 Agent 目前是正在思考、执行命令，还是等待确认。
- **统一协议**：无论底层是 Claude 还是 OpenAI，Cove 用统一的协议管理它们的 PTY 生命周期。

### 🔮 Cyber-Glass 沉浸式 UI
专为开发者打造的 **Deep Space Cyber-Glass** 设计语言。
- **深空美学**：极暗背景 + 霓虹微光，专注编码不刺眼。
- **毛玻璃质感**：现代化的半透明容器，层级分明，极具呼吸感。
- **交互细节**：碰撞检测、平滑动画、磁吸对齐，每一个交互都经过精心打磨。

---

## 🚀 为什么选择 Cove？

| 传统模式 | Cove 模式 |
| :--- | :--- |
| **线性对话**：上下文随聊天记录被顶走，回溯困难。 | **空间节点**：关键信息永久驻留在画布上，所见即所得。 |
| **单任务**：一次只能和一个 Agent 聊一件事。 | **多线程**：同时指挥多个 Agent 处理不同模块，并行不悖。 |
| **黑盒运行**：不知道 Agent 在终端里偷偷干了什么。 | **透明监管**：Agent 的每一次终端操作都实时呈现在 PTY 节点中。 |

---

## 🛠️ 快速开始

Cove 目前处于 Alpha 阶段，建议开发者尝鲜。

## 📦 下载与安装（macOS）

建议从 GitHub Releases 下载 `.dmg` / `.zip`。

> 当前 Release 构建**未做 Apple Developer ID 签名/公证**。首次打开若被 Gatekeeper 拦截，可用以下方式处理：
>
> - Finder：右键 `cove.app` → **打开** → 再次确认
> - 或终端（拷贝到 Applications 后）：`xattr -dr com.apple.quarantine /Applications/cove.app`

### 前置要求
- Node.js `>= 22`
- pnpm `>= 9`
- 建议安装 `claude` 或 `codex` CLI 以体验完整 Agent 功能

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/your-username/cove.git

# 安装依赖
pnpm install

# 启动开发环境
pnpm dev
```

更多发布/打包说明见 `docs/RELEASING.md`。

---

## 🏗️ 技术栈

建立在现代 Web 标准与 Electron 之上：
- **Electron + React + TypeScript** (`electron-vite`)
- **@xyflow/react** (原 ReactFlow) 驱动无限画布
- **xterm.js + node-pty** 提供工业级终端能力
- **Vitest + Playwright** 确保稳如磐石的质量

## 🤝 参与贡献

Cove 是一个开源项目，我们需要你的帮助来定义 AI 时代的 IDE 形态。
详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

---

<div align="center">
  <sub>Built with ❤️ by the Cove Team. MIT License.</sub>
</div>
