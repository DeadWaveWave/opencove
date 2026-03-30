# Terminal TUI Rendering Baseline（Codex）

本文档记录当前已验证稳定的终端渲染基线，用于后续出现回归时快速恢复。

## 背景与结论

- 现象：`codex` 的 TUI 在窗口拖动/resize 场景下，比 `claude-code` 更容易出现排版错位、花屏、局部空白。
- 经验结论：`codex` 对终端尺寸变化与渲染节奏更敏感，越复杂的 resize 调度逻辑越容易诱发问题。
- 稳定基线：
  - 参考提交：`21383c9f3905af891acecaabf538003636e10441`（当时体感稳定）
  - 当前恢复提交：`364cf19`（已恢复该渲染主路径）

## 稳定渲染主路径（必须保持）

关键文件：`src/renderer/src/features/workspace/components/TerminalNode.tsx`

1. `syncTerminalSize()` 采用直接链路：
   - `fitAddon.fit()`
   - `terminal.refresh(0, terminal.rows - 1)`
   - `window.opencoveApi.pty.resize(...)`
2. `ResizeObserver` 直接调用 `syncTerminalSize()`，不引入额外状态机。
3. `width/height` 变化通过 `requestAnimationFrame(syncTerminalSize)` 触发。
4. `visibility/focus/layout-sync` 事件都直接调用 `syncTerminalSize()`。
5. resize 交互采用“拖动预览 + 放手提交”：
   - 拖动中只更新节点草稿尺寸；
   - 松手后调用一次 `syncTerminalSize()`。

## 当前功能约束（在稳定基础上保留）

1. 单方向 resize：
   - 右侧把手只改宽度（`terminal-resizer-right`）
   - 底部把手只改高度（`terminal-resizer-bottom`）
2. scrollback 持久化继续保留，但 resize 期间不立刻发布；放手后再 flush。

## 禁止项（高风险改法）

以下改动容易重新引入 Codex TUI 渲染问题：

1. 在 resize 过程中频繁触发多重调度（`fit/refresh/resize` 的多层去抖、合流、强制触发）。
2. 在拖动/resize 高频期同步写入大量节点状态（尤其会触发画布级布局重算的更新）。
3. 将 `syncTerminalSize` 拆成复杂分支并在多个 effect 内交叉调用。

## 回归时快速恢复步骤

### 1) 对照基线

```bash
git diff 364cf19 -- src/renderer/src/features/workspace/components/TerminalNode.tsx
git diff 364cf19 -- src/renderer/src/styles.css
```

### 2) 一键恢复关键文件

```bash
git checkout 364cf19 -- src/renderer/src/features/workspace/components/TerminalNode.tsx
git checkout 364cf19 -- src/renderer/src/styles.css
```

### 3) 回归验证

```bash
pnpm format:check
pnpm lint
pnpm check
pnpm test -- --run
pnpm test:e2e
```

## 必跑的 E2E 用例（终端稳定性）

文件：`tests/e2e/workspace-canvas.spec.ts`

- `keeps terminal visible after drag, resize, and node interactions`
- `keeps agent tui visible while dragging window`
- `wheel over terminal scrolls terminal viewport`
- `wheel over a hydrated agent node scrolls the viewport instead of the canvas`
- `preserves terminal history after app reload`

推荐快速执行：

```bash
pnpm test:e2e -- tests/e2e/workspace-canvas.spec.ts -g "keeps terminal visible after drag, resize, and node interactions|keeps agent tui visible while dragging window|wheel over terminal scrolls terminal viewport|wheel over a hydrated agent node scrolls the viewport instead of the canvas|preserves terminal history after app reload"
```
