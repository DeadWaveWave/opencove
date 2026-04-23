# 项目任务追踪

**焦点变更**：（无）

## 活跃任务

> **格式规则**：任务用 `- [ ] T-NNN 标题`，按变更分组 `### CHG-ID: 标题`。
> `<!-- APPROVED -->` 放在 CHG 标题下方、任务列表上方；`<!-- VERIFIED -->` 放在 APPROVED 下方。
> **禁止**表格格式和 emoji 状态标记。

**状态说明**: `[ ]` 未开始 | `[/]` 进行中 | `[x]` 完成 | `[!]` 阻塞 | `[-]` 跳过

（无活跃任务）

<!-- ARCHIVE -->

### CHG-20260420-04: Fix Console-Open Drag Lag
<!-- APPROVED -->
- [-] T-034 禁用 registerWebglPixelSnappingMutationObserver — 已测试：HEAD 原始代码（DOM 渲染器）打开控制台也卡，卡顿非 WebGL/observer 引入，是 React Flow + DevTools 的既有问题

### CHG-20260420-05: Dynamic Terminal DPR on Canvas Zoom
<!-- APPROVED -->
- [x] T-035 终端随画布 zoom 动态提升 effective DPR — 注入 xterm renderer 的 effective DPR（window.devicePixelRatio × viewport zoom），放大后提升 WebGL backing canvas 分辨率
- [x] T-036 补终端 zoom 清晰度回归用例 — E2E 断言 canvas zoom 后 terminal effectiveDpr 与 device canvas 尺寸同步变大

### CHG-20260421-01: Stabilize Terminal Zoom Scroll
<!-- APPROVED -->
- [x] T-037 暂时回退终端 zoom 清晰度增强 — 缩放画布时 terminal backing resolution 保持稳定，避免再次触发滚动状态回归
- [x] T-038 保持 terminal 相对滚动位置 — 缩放前记录距底部偏移，zoom 后继续有输出时恢复 user-scrolled 状态而不是吸到底部
- [x] T-039 验证 zoom + 输出 + theme 回归 — 已跑 `pnpm build`、`pnpm check`、专项 Playwright 用例，确认 scroll / theme 行为稳定
- [x] T-040 重做安全版 terminal zoom 清晰度方案 — 改为 zoom settled 后统一做 renderer-level clarity refresh；仍按 viewport zoom 提升 backing resolution，但 user-scrolled 状态下也会恢复清晰，且不替换 terminal 实例/DOM、不走 fit/PTY resize

### CHG-20260420-03: Fix React Flow error015 Drag Warning
<!-- APPROVED -->
- [x] T-033 在 ReactFlow 组件上加 onError 过滤 error015（node 未测量时的无害 warning）

### CHG-20260420-02: Investigate React Flow Drag Warning
<!-- APPROVED -->
- [x] T-032 排查 React Flow 拖动 warning 根因 — @xyflow/react 内部 node.measured 为 undefined 时触发 error015，node 挂载时序问题，不影响功能

### CHG-20260420-01: Reapply DPI Fixes
<!-- APPROVED -->
- [x] T-031 加回所有有效改动（preferredRenderer WebGL + customGlyphs, containerRef null 检查, useViewportDprSnapping onMoveEnd 版）

### CHG-20260419-14: Optimized Viewport DPR Snapping
<!-- APPROVED -->
- [-] T-029 重写 useViewportDprSnapping — 误判：HEAD 原始代码也报 React Flow 拖动错误，不是我们的改动引入的
- [x] T-030 排查拖动报错根因 — 已确认：HEAD 原始代码就存在，非本次改动引入

### CHG-20260419-13: Clean Up Unnecessary DPI Code
<!-- APPROVED -->
- [x] T-025 删除 useViewportDprSnapping（导致拖动卡顿和 React Flow 报错）
- [x] T-026 恢复 webglPixelSnapping.ts 为原始版本
- [x] T-027 删除废弃文件 useTerminalCanvasOverlay.ts、useTerminalPortal.ts
- [x] T-028 丢弃 stash 中已废弃的 overlay/portal 代码

### CHG-20260419-12: A/B Test — Disable webglPixelSnapping
<!-- APPROVED -->
- [x] T-024 将 applyWebglPixelSnapping 变为 no-op，对比禁用前后终端清晰度 — 结论：无差别，pixel snapping 无实际效果

### CHG-20260419-11: Use localStorage for Overlay Toggle
<!-- APPROVED -->
- [x] T-023 改用 localStorage 持久化 overlay 开关

### CHG-20260419-10: Add Overlay Runtime Toggle
<!-- APPROVED -->
- [x] T-022 添加 window.__disableCanvasOverlay 运行时开关

### CHG-20260419-09: Fix Overlay Grabbing Wrong Canvas
<!-- APPROVED -->
- [x] T-021 selector 改为 canvas:not(.xterm-link-layer)，修复 overlay 抓取 link layer 而非主 WebGL canvas

### CHG-20260419-08: Canvas Overlay Zoom + Clarity Fix
<!-- APPROVED -->
- [x] T-020 scale 放 overlay div（非 canvas），修复缩放 + 保持 WebGL 渲染正确

### CHG-20260419-07: Canvas Overlay Precision Fix
<!-- APPROVED -->
- [x] T-019 placeholder rect 定位 + 移除 canvas scale + position:fixed

### CHG-20260419-06: Canvas Overlay Observer Loop Fix
<!-- APPROVED -->
- [x] T-018 修复 canvasObserver 无限循环 — observer 只在发现新 canvas 时 activate，移除 else-if-activeCanvas 分支

### CHG-20260419-05: Canvas Overlay pointer-events:none Fix
<!-- APPROVED -->
- [x] T-017 overlay canvas 设 pointer-events:none — 移除 canvas.style.pointerEvents='auto'，overlay 纯渲染镜像不拦截交互

### CHG-20260419-04: Fix Canvas Overlay Pointer Events
<!-- APPROVED -->
- [x] T-016 修复 canvas overlay pointer-events 阻挡全应用点击的问题 — 用 withObserverDisconnected 替代 isMutating 标志，在 DOM 变更前 disconnect observer，变更后 reconnect，彻底消除无限循环

### CHG-20260419-03: WebGL Fractional DPI Blur Fix (全部归档)
<!-- APPROVED -->
- [-] T-012 translate3d + will-change 方案 — 已测试，效果不足
- [-] T-014 方案A: canvas overlay — 已禁用：z-index:10000 阻挡全应用点击事件
- [-] T-015 验证 canvas 移出后交互 — 依赖 T-014，已跳过

### CHG-20260419-02: Canvas Sub-pixel Compensation Fix
<!-- APPROVED -->
<!-- VERIFIED -->
- [x] T-010 修复 viewport scale 未参与计算的 bug — webglPixelSnapping.ts 提取 viewport scale，修正 currentTranslate 屏幕空间贡献，将 offset 除以 scale 转为本地空间
- [x] T-011 在 fractional DPR 环境下验证终端清晰度 — 用户确认有改善但仍有模糊

### CHG-20260419-01: Revert Portal Approach
<!-- APPROVED -->
<!-- VERIFIED -->
- [x] T-007 回滚 Portal 方案 — TerminalNode.tsx/nodeTypes.tsx 移除 Portal，恢复直接渲染；DPI 模糊由 useViewportDprSnapping 处理
- [x] T-008 验证回滚后功能正常 — 确认终端可拖动/关闭/缩放、便签可选、右键菜单正常
- [-] T-009 Portal pointer-events 修复 — 已否决：Portal 方案与 React Flow 交互模型不兼容，完全回滚

## 已完成任务

### CHG-20260418-02: containerReady Bundler Bug Fix
<!-- APPROVED -->
<!-- VERIFIED -->
- [x] T-003 containerReady bundler tree-shaking 修复 — 从 hooks 调用中移除 containerReady 参数，改为只依赖 containerRef.current 检查

### CHG-20260418-01: Terminal Portal Bug Fix
<!-- APPROVED -->
<!-- VERIFIED -->
- [x] T-001 React Flow node wrapper 尺寸修复 — nodeTypes.tsx wrapper div 添加显式 width/height
- [x] T-002 containerReady 时序修复 — useTerminalPortal/useTerminalRuntimeSession/useTerminalPlaceholderSession 修复初始化顺序
