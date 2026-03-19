# Debugging Guide

## 规则

- 凡遇到 `pnpm pre-commit`、`pnpm test -- --run`、`pnpm test:e2e` 或单独 `Playwright` 用例失败，**继续排查前先读本文件**。
- 先缩小复现范围，再改代码；不要一上来跑全量。
- 若 UI 表现与代码不一致，先怀疑是否跑到了旧构建产物。

## 失败后的首轮动作

1. 记录**原始失败命令**与**首个失败用例/报错**。
2. 判断失败类型：`format/lint`、`typecheck`、`unit`、`E2E`、运行时崩溃。
3. 若是单独跑 `Playwright`，先执行 `pnpm build`。
4. 只重跑目标失败项，确认是否稳定复现。
5. 若是 E2E，优先看 `screenshot`、`trace`、`console` 与持久化状态。

## E2E 稳定运行原则

### 优先使用仓库脚本

运行：

```bash
pnpm test:e2e
```

该命令会先执行 `pnpm build`，再通过 `scripts/test-e2e-with-window-fallback.mjs` 启动 Playwright。

### 默认窗口模式与自动降级

- 默认窗口模式：`OPENCOVE_E2E_WINDOW_MODE=offscreen`
- 这是后台运行模式，通常比 `hidden` 更稳定。
- 若日志命中 Electron/Chromium 崩溃特征（如 `SIGSEGV`、`Target page, context or browser has been closed`），脚本会按更稳模式自动重试失败用例。

常用控制项：

```bash
OPENCOVE_E2E_WINDOW_MODE=inactive|offscreen|hidden pnpm test:e2e
OPENCOVE_E2E_DISABLE_CRASH_FALLBACK=1 pnpm test:e2e
```

### 单独跑 Playwright 时必须先构建

```bash
pnpm build
pnpm exec playwright test tests/e2e/<target>.spec.ts
```

否则 Playwright 可能继续使用旧的 `out/` 产物，造成“代码已改、现象没变”的假失败。

## E2E 调试流程

### 1) 先跑目标用例

```bash
pnpm exec playwright test tests/e2e/<target>.spec.ts --project electron --reporter=line
```

### 2) 失败时看 trace

```bash
pnpm exec playwright show-trace test-results/<failed-case>/trace.zip
```

优先检查：

- `console` / `pageerror`
- Electron 窗口是否真的完成加载
- 关键节点数量、选中态、空间框选态是否符合预期
- 截图中的点击/拖拽命中点是否正确
- UI 与持久化状态是否一致

### 3) 再决定是否回到全量回归

```bash
pnpm test:e2e
```

## Playwright 交互排查重点

### 1) 复杂拖拽优先使用真实鼠标事件

在 Electron `offscreen` + React Flow 场景中，`locator.dragTo()` 可能出现“看起来拖了，但状态没变化”的假成功。

结论：

- 节点拖拽、space 拖拽、多选框拖拽，优先使用 `page.mouse.move/down/up`
- 仓库内已有稳定 helper 时，优先复用 helper，而不是重新写 `dragTo()`

### 2) 多选后再拖，先给选择框一个极短 settle 时间

`nodesselection-rect` 刚出现时立刻拖动，可能命中还没稳定，导致多选拖拽偶发失败。

建议：

- 先确认 `.react-flow__nodesselection-rect` 可见
- 视情况等待一个很短的稳定时间，再开始拖拽

### 3) 避免被 minimap 或 overlay 误拦截

如果点击/拖拽看似命中目标但事件没生效，优先检查：

- minimap 是否覆盖了目标区域
- space overlay / drag handle / label 区域是否抢占事件
- 点击点是否过于贴边

## 持久化与状态污染排查

### 1) 测试优先使用 seed 状态

交互回归应尽量通过测试 helper 直接 seed workspace 状态，而不是依赖多步 UI 创建流程。

这样更容易排除：

- 右键菜单被遮挡
- 初始节点布局随机变化
- 前序步骤失败掩盖真实问题

### 2) 检查状态是否被前一个用例污染

重点确认：

- `cove:m0:workspace-state` 是否已清理或重建
- `reload` 后是否真的读到了当前种入的数据
- workspace / nodes / spaces 数量是否与预期一致

### 3) 当 UI 与断言不一致时，直接读持久化状态

如果画面像是成功了，但断言仍失败，或反过来，优先直接读取持久化状态确认真实结果。

这通常能快速区分：

- 是事件根本没触发
- 是 UI 更新了但没持久化
- 是持久化已更新但断言时机不对

## 高频症状速查

### 终端交互后空白 / 整块重渲染

优先检查：

- `WorkspaceCanvas` 的 `nodeTypes` 是否保持稳定引用
- `TerminalNode` 是否只在必要时重建 xterm 实例
- 拖拽/缩放是否仅更新位置与尺寸，而不是替换节点身份
- 当前 E2E 是否使用了最新 `out/` 产物

### 切换 workspace 或重启应用后终端历史丢失

优先检查：

- 主进程是否维护 PTY 输出快照
- 是否提供并使用 `pty:snapshot`
- 渲染层是否持久化 `scrollback`
- 挂载时是否合并 `persisted scrollback` 与 `pty snapshot`
- 输出回写是否做了节流，且回调引用是否稳定

### 终端滚轮既没缩放画布，也没滚动终端

优先检查：

- 是否错误使用了 `onWheelCapture + stopPropagation`
- 是否应改为冒泡阶段的 `onWheel`
- 是否阻断了 React Flow，同时保留了 xterm 默认滚动

## 一句话原则

- **先确认是不是旧构建，再怀疑代码。**
- **先看 trace 和持久化状态，再猜 UI。**
- **复杂拖拽先信真实鼠标事件，不要先信 `dragTo()`。**
