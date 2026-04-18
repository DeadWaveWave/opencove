# Case: Embedded OpenCode TUI 主题未跟随 OpenCove 主题（切换后半白半黑 / 不即时更新）

## Symptoms

- OpenCove 内嵌 OpenCode TUI（`terminalProvider=opencode`）在 **黑↔白切换**时：
  - 只部分变色、出现残留深色块，视觉上像“半白半黑”
  - 或者只有 OpenCode 不即时更新，其它窗口都已切换
- 当 OpenCove 的 UI theme 设为“跟随系统”时，OpenCode 看起来会更“即时更新”，但仍可能伴随渲染异常。

## Environment

- OpenCove：Electron + xterm
- OpenCode CLI：本机安装（当时版本 `opencode 1.3.13`）
- 触发条件：OpenCode TUI 使用 `theme: "system"`（见 `OPENCODE_TUI_CONFIG`）

## Repro

推荐用可复现资产跑“真实 OpenCode”：

```bash
OPENCOVE_TEST_USE_REAL_AGENTS=1 pnpm test:e2e tests/e2e/workspace-canvas.opencode-embedded-theme.spec.ts --project electron --reporter=line
```

该用例会：

- 种入 `uiTheme=dark`
- 启动一个 OpenCode agent node
- 切换到 `uiTheme=light`
- 在 `test-results/**` 输出切换前后的截图，便于对比“是否完全变白/黑”

## Investigation

关键结论：

1. OpenCode 的 `theme: "system"` **不等价于“读 OS 主题”**。它会通过终端协议去查询调色板与 special colors，再生成 “system theme”。
2. OpenCode 会发起 `OSC 4`（palette）以及 `OSC 10/11/...`（special colors）查询；若终端侧不响应，它无法重算配色。
3. OpenCode TUI 的主题切换事件使用 `CSI ?997;1n`(dark) / `CSI ?997;2n`(light)。
   - 如果在 TUI 未进入 alt-screen 前写入，上述序列可能被当作普通文本输出到屏幕上。
4. OpenCode state 里可能存在 `theme_mode_lock`（例如 `kv.json`），会锁定主题模式，导致“看似切换了但 TUI 不变”。

## Root Cause

- OpenCove 的 xterm 主题切换只是更新了 xterm 自己的 `Terminal.options.theme`，但 **没有补齐 OpenCode 的终端协议链路**：
  - 未响应 OpenCode 的 OSC 颜色查询
  - 未在正确时机向 PTY 上报 `CSI ?997;…n`
  - embedded session 可能复用/污染了用户全局 OpenCode state，触发 `theme_mode_lock`

## Fix

- **以 OpenCove `uiTheme` 为 single source of truth**，终端节点默认跟随应用主题（而不是 OS）。
  - `src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.tsx`
  - `src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalThemeApplier.ts`
- **补齐 OpenCode “system theme” 协议能力**（Renderer 侧）：
  - 响应 `OSC 4/10/11/...`：`src/contexts/workspace/presentation/renderer/components/terminalNode/opencodeOscColorQueryResponder.ts`
  - 监听 alt-screen 进入后再上报 `CSI ?997;…n`，并处理分片序列与 alt-screen 退出：`src/contexts/workspace/presentation/renderer/components/terminalNode/opencodeTuiThemeBridge.ts`
- **隔离 embedded OpenCode 的持久 state**（Main 侧）：
  - 注入 `XDG_STATE_HOME=<app userData>`，避免读取用户全局 `kv.json` 锁：`src/contexts/agent/presentation/main-ipc/register.ts`、`src/app/main/controlSurface/handlers/sessionHandlers.ts`

## Verification

- Unit
  - `tests/unit/terminalNode/opencodeOscColorQueryResponder.spec.ts`
  - `tests/unit/terminalNode/opencodeTuiThemeBridge.spec.ts`
- E2E（可选，真实 CLI）
  - `tests/e2e/workspace-canvas.opencode-embedded-theme.spec.ts`

## Lessons

- 遇到 “`theme: system` 行为不符合直觉” 时，先确认它依赖哪类协议/查询（OSC/CSI），不要默认等同 OS theme。
- 向 PTY 写控制序列要考虑 **时机**：TUI 未 ready（未进入 alt-screen）时，很容易被渲染为普通文本。
- embedded 外部 CLI 一旦有 durable state（配置/锁/缓存），优先为“内嵌模式”做隔离，避免用户全局状态反向影响应用内行为。

