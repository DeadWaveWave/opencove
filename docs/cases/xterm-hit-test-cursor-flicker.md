# Case: OpenCode / xterm 命中穿透导致 cursor 闪烁、残影、交互不稳定

## Symptoms

在 `Electron + xterm + React Flow + canvas transform` 组合下，用户可能遇到：

- 鼠标在终端输入区/正文上 `text/default` 闪烁切换
- TUI 画面出现“百叶窗/断层/残影”式的观感问题
- 偶发点击/滚轮事件像是“穿透”到底层画布

## Environment

- Electron 渲染进程
- xterm（canvas / webgl renderer 均可能出现，表现不同）
- React Flow（viewport transform / overlay 叠层）

## Repro（建议）

这类问题常依赖“恢复后的真实负载”（多节点、多 agent、持续输出），优先用共享 userData 复现：

```bash
OPENCOVE_DEV_USE_SHARED_USER_DATA=1 pnpm dev
```

## Investigation

核心是区分两类问题：**命中层/hit-test 异常** vs **渲染器残影**。

### 1) 不要只采一次命中：固定点连续采样

选择用户真正停留的点位（通常在 `.xterm-helper-textarea` 光标附近），连续采样 `200~500` 次：

- `document.elementFromPoint(x, y)`
- `document.activeElement`
- `.xterm` 的 class（尤其 `focus` / `enable-mouse-events` / `xterm-cursor-pointer`）
- 终端 body / pane 的 computed `cursor`

如果命中在 `xterm-*` 与 `.react-flow__pane` 之间切换，就说明不是“简单 z-index 写错”，而是更底层的 hit-test/合成层问题。

### 2) 命中异常时同步采集几何，证明“几何正确但命中错误”

在命中落到 `.react-flow__pane` 的那一帧，同时采：

- `.terminal-node__terminal`
- `.xterm`
- `.xterm-screen`
- `.xterm-viewport`
- `.xterm-screen canvas`

的 `getBoundingClientRect()`、`display`、`opacity`、`pointer-events`。

如果这些层几何上仍覆盖命中点，而 `elementFromPoint` 依旧落到 pane，说明应把排查重心从 CSS 转到 Chromium/Electron hit-test 行为。

### 3) 先把“用户可见跳变”消掉，再追求完美命中

当确认是偶发漏命中时，优先做 **受控兜底**：

- 以“终端确实 focus 且鼠标仍在该终端矩形内”为条件
- 将底层画布命中层同步相同的 cursor/交互语义（避免 cursor 跳变）
- 观察是否引入 TUI 鼠标事件/选择/链接点击回归

### 4) 避免默认用 overlay 盖一层

overlay 很容易“看起来修好闪烁”，但会破坏：

- TUI 鼠标事件
- 文本选择
- 链接点击
- React Flow 的交互一致性

## Lessons

- “几何正确但命中错误” 是一个强信号：不要继续在 `z-index/pointer-events` 上耗时间。
- 先分清是 **渲染残影**（renderer）还是 **命中异常**（hit-test），修法完全不同。

