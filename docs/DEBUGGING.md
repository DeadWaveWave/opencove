# Debugging Guide

## 规则

- 凡遇到 `pnpm pre-commit`、`pnpm test -- --run`、`pnpm test:e2e` 或单独 `Playwright` 用例失败，**继续排查前先读本文件**。
- 先缩小复现范围，再改代码；不要一上来跑全量。
- 若 UI 表现与代码不一致，先怀疑是否跑到了旧构建产物。
- Web UI（Worker Web Canvas / Debug Shell）常见问题速查见：`docs/WEB_UI_TROUBLESHOOTING.md`。

## 失败后的首轮动作

1. 记录**原始失败命令**与**首个失败用例/报错**。
2. 判断失败类型：`format/lint`、`typecheck`、`unit`、`E2E`、运行时崩溃。
3. 若是单独跑 `Playwright`，先执行 `pnpm build`。
4. 只重跑目标失败项，确认是否稳定复现。
5. 若是 E2E，优先看 `screenshot`、`trace`、`console` 与持久化状态。

## 测试层级选择（策略）

目标：用 **最低成本** 的测试层级先定位问题；确认根因后再补足能防回归的覆盖。

### Unit（最快）

适用场景：

- 纯函数/协议解析/颜色转换等“无 IO、无时序”的逻辑
- 需要快速验证边界条件（例如 escape sequence/解析分片）

运行：

```bash
pnpm test -- --run tests/unit/<target>.spec.ts
```

### Contract（边界正确性）

适用场景：

- IPC/DTO 校验、approved workspace guard、主进程 handler 的输入/输出契约
- 需要验证“错误 code/debugMessage/guard 行为”是否符合约定

运行：

```bash
pnpm test -- --run tests/contract/<target>.spec.ts
```

### E2E（用户可见/跨边界）

适用场景：

- 主题切换、拖拽/缩放、focus、持久化/恢复、外部 CLI（OpenCode/Codex）行为
- 任何“只有把 Main/Renderer/PTY/外部进程串起来才会出现”的问题

运行：

```bash
pnpm test:e2e tests/e2e/<target>.spec.ts --project electron --reporter=line
```

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

## 真实 Agent / 外部 CLI 复现

默认 `NODE_ENV=test` 下，OpenCove 会用测试 stub 避免真的启动外部 Agent CLI。调试 OpenCode 这类“真实 TUI 行为”（例如主题切换、alternate screen、颜色查询）时，需要禁用 stub：

```bash
OPENCOVE_TEST_USE_REAL_AGENTS=1 pnpm test:e2e tests/e2e/workspace-canvas.opencode-embedded-theme.spec.ts --project electron --reporter=line
```

补充：

- 该开关会让测试直接 spawn 本机安装的 CLI（如 `opencode`），可能触发真实网络请求/账号权限；仅建议用于本地调试。
- 产物在 `test-results/**`：优先看 `trace.zip`、失败截图与控制台日志。

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

### 4) React Flow：元素“可见但不在 viewport”

现象：

- Playwright 日志提示 `element is outside of the viewport`
- 但 `await expect(locator).toBeVisible()` 仍然通过

原因：

- React Flow 画布使用 `transform`（viewport 缩放/平移）。元素在 DOM 上“可见”，但实际绘制区域可能在屏幕外。
- `scrollIntoViewIfNeeded()` 对 transform 场景不一定有效。

处理：

- 先把目标节点带回视口（最简单：点击 `Fit View` 控制按钮 `.react-flow__controls-fitview`），再执行 click/drag。
- 对“节点创建后立即点击 close/resize”等操作，建议先做一次 `Fit View` 或 focus 到该节点，避免视口偏移造成误判。

### 5) 缩放/transform 场景避免依赖 `locator.boundingBox()` 做像素命中与断言

在 React Flow 缩放（viewport transform）场景下，尤其是 CI 里的 `inactive/offscreen` 窗口模式，`locator.boundingBox()` 偶发返回不稳定坐标，导致鼠标按下点不到目标元素，进而出现“mouse 走完了但 resize/drag 根本没发生”的假操作。

建议：

- 计算鼠标命中点时，优先用 `locator.evaluate(el => el.getBoundingClientRect())` 获取可视坐标，再用其中心点进行 `mouse.move/down/up`。
- 对像素级对齐断言留出容差（例如降低 `toBeCloseTo` precision，或用自定义 tolerance），避免被平台舍入差/动画 settle 影响。
- 断言 resize/drag 结果时，优先读持久化状态确认是否真的提交，而不是只看 UI 像素位置。

示例（命中点计算）：

```ts
const rect = await locator.evaluate(el => el.getBoundingClientRect())
const x = rect.x + rect.width / 2
const y = rect.y + rect.height / 2
await page.mouse.move(x, y)
```

## 持久化与状态污染排查

### 1) 测试优先使用 seed 状态

交互回归应尽量通过测试 helper 直接 seed workspace 状态，而不是依赖多步 UI 创建流程。

这样更容易排除：

- 右键菜单被遮挡
- 初始节点布局随机变化
- 前序步骤失败掩盖真实问题

### 2) 检查状态是否被前一个用例污染

重点确认：

- `opencove:m0:workspace-state`（旧版本可能是 `cove:m0:workspace-state`）是否已清理或重建
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

### OpenCode 内嵌：主题切换不完整 / 不即时更新

适用场景：

- OpenCove UI theme 已切换（黑↔白），但只有 OpenCode TUI 没完全更新（残留深色块/不变/闪一下又回去）

排查顺序：

1. **先确保复现链路可重复**：优先用可复现资产跑真实 OpenCode（见下方“真实 Agent / 外部 CLI 复现”）。
2. **确认主题真相来源**：OpenCode 侧 `theme: "system"` 通常依赖终端协议（OSC/CSI）而不是直接读 OS theme。
3. **确认 embedded state 是否隔离**：若出现“被锁住”的主题行为，优先怀疑 durable state（例如 `theme_mode_lock`），并检查是否为 embedded 注入了独立的 `XDG_STATE_HOME`。

参考案例：

- `docs/cases/opencode-embedded-theme-sync.md`

### Terminal（xterm）：cursor 闪烁 / 命中穿透 / 残影观感

适用场景：

- 鼠标在终端输入区/正文上 `text/default` 闪烁切换
- 偶发点击/滚轮像是“穿透”到底层画布

方法要点：

- 固定点连续采样 `document.elementFromPoint(x, y)`（200~500 次）来确认是否 hit-test 偶发漏命中
- 在漏命中那一帧同步采集关键层的 `getBoundingClientRect()` 与 `pointer-events`，用证据证明“几何正确但命中错误”
- 避免默认用 overlay 盖一层（容易引入 TUI 鼠标/选择/链接点击回归）

参考案例：

- `docs/cases/xterm-hit-test-cursor-flicker.md`

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

### 测试：Vitest 的 `electron` mock 导出缺失导致运行时报错

适用场景：

- 报错里出现 `No "app" export is defined on the "electron" mock`（或类似信息）
- 代码侧看起来用了 optional chaining，但仍在访问 `electron.app` 时爆炸

排查顺序：

1. 优先看 `debugMessage`（或直接临时把 envelope error 打出来）
2. 检查测试中 `vi.doMock('electron', ...)` 是否遗漏了 `app` 等导出
3. 若确实需要在代码侧读取 `electron.app.getPath`，建议用 `try/catch` 护住（mock 可能在访问缺失导出时 throw）

参考案例：

- `docs/cases/vitest-electron-mock-missing-exports.md`

## 案例库

当你需要“同类问题的完整复盘 + 证据链 + 落地修法”，从这里开始：

- `docs/cases/README.md`

## 一句话原则

- **先确认是不是旧构建，再怀疑代码。**
- **先看 trace 和持久化状态，再猜 UI。**
- **复杂拖拽先信真实鼠标事件，不要先信 `dragTo()`。**
