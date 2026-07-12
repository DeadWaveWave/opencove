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

另一个容易被忽略的边界是：应用 shell 的 light/dark 不一定等于 terminal/TUI 的
light/dark。命名主题可以显式选择不同的 `terminalScheme`；例如 `ember-light` 的应用
shell 是 light，但终端与 OpenCode 必须保持 dark。若各桥接点分别读取 base UI scheme，
就会再次出现 palette、CSI mode 与 xterm frame 不一致。

## Fix

- **以 applied terminal appearance 为 single source of truth**。`UiThemeDescriptor` 先解析
  `baseScheme` 与独立的 `terminalScheme`；终端节点跟随 resolved terminal scheme（而不是
  直接跟随 OS 或应用 shell）。`ember-light` 因而发送 dark TUI 语义。
  - `src/contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.tsx`
  - `src/contexts/workspace/presentation/renderer/components/terminalNode/terminalAppearance.ts`
  - `src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalThemeApplier.ts`
- **final-wins 统一应用**：每个 xterm 实例只有一个 revisioned appearance owner；快速切换
  合并到最新 snapshot，每帧至多一次 apply/refresh。只有 `markApplied` 后的 snapshot 才能
  驱动 OSC replies、CSI `?997` 与 Find decorations，同 scheme 但 palette 改变也按 appearance
  revision 处理。
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
- 不要把 app shell scheme 当成 terminal scheme；命名主题必须通过 descriptor 明确两者。
- palette、CSI mode 和 xterm frame 必须来自同一 applied appearance revision。只按
  light/dark 去重会漏掉同 scheme 的 palette 更新。
- Terminal identity 可以跨 placeholder/DOM replacement 复用；theme apply 必须在执行时读取 live
  container scope，不能让 coordinator closure 绑定已经 detached 的节点。
- 向 PTY 写控制序列要考虑 **时机**：TUI 未 ready（未进入 alt-screen）时，很容易被渲染为普通文本。
- embedded 外部 CLI 一旦有 durable state（配置/锁/缓存），优先为“内嵌模式”做隔离，避免用户全局状态反向影响应用内行为。
