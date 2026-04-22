# Terminal Zoom Clarity 设计说明

日期：2026-04-22
状态：待评审（Spec Review）
范围：在不改变产品既有 zoom 语义的前提下，重做 terminal zoom 后的清晰度方案；本次只讨论 renderer 级设计，不进入实现细节。

## 1. 问题类别

这不是一个以 CSS 样式为主的问题，而是一个发生在变换中的画布（transformed canvas）里的 renderer 重栅格化（re-rasterization）问题。

OpenCove 当前的产品行为是：

- terminal / agent 节点在视觉上会跟随 canvas zoom；
- 画布放大后，terminal 窗口和字形在屏幕上看起来会更大；
- 这是既有产品语义，不是 bug，不能被本次优化改变。

真正的问题更窄：

- 当 canvas zoom 之后，terminal 的 screen-space 呈现变大了，但 xterm 的 backing raster 没有在合适时机做匹配的清晰度刷新（clarity refresh），所以终端会变糊；
- 之前几轮尝试虽然提升了清晰度，但把刷新路径错误地和 scroll 状态、是否在底部、DOM 拓扑或布局路径绑在了一起，最终破坏了 scroll / focus 稳定性。

因此，本设计的目标是：

- 保持既有 zoom 语义不变；
- 在 zoom 之后恢复 terminal 的清晰呈现；
- 不能破坏 scroll、focus、selection、click、IME 或 session ownership 语义。

## 2. 参考与已有证据

### 2.1 行业 / Upstream 信号

这个问题在 canvas / WebGL terminal renderer 中有清晰的先例：

- xterm 的 DPR 处理属于 renderer 路径，不是普通的 `fit/resize` 问题；
- xterm 会在浏览器 DPR 变化时，通过 renderer 的 measurement 和 redraw 路径来更新呈现；
- 这意味着 OpenCove 应把 terminal zoom 清晰度视为 renderer refresh 问题，而不是布局 owner、terminal lifecycle 或 scroll ownership 问题。

本地依赖源码中的直接证据：

- `node_modules/@xterm/xterm/src/browser/services/CoreBrowserService.ts`
  - `dpr` 来自浏览器 window 的 device pixel ratio。
- `node_modules/@xterm/xterm/src/browser/services/RenderService.ts`
  - DPR 变化通过 `handleDevicePixelRatioChange()` 进入 renderer 链路。
- `node_modules/@xterm/addon-webgl/src/WebglRenderer.ts`
  - WebGL DPR 更新会触发 renderer 尺寸更新、atlas 刷新与重绘。

### 2.2 OpenCove 既有尝试

近期仓库内的直接证据：

- `task.md`
  - `T-035` 已证明 `effectiveDpr = window.devicePixelRatio × viewportZoom` 这一方向在清晰度上是有效的；
  - `T-037`、`T-038` 记录了首轮接法触发了 scroll 状态回归；
  - `T-040` 记录了后续“安全版”把清晰度刷新延迟到 terminal 回到底部后才做，这保护了行为稳定性，但产生了错误的产品结果。
- `docs/TERMINAL_TUI_RENDERING_BASELINE.md`
  - 更早的 overlay / portal / DOM 层方案引入了 hit-test、focus 或拖拽回归。

## 3. 为什么这个问题会这么难

从用户角度看，它像是“放大后变糊了，再变清楚就行”。  
但结构上它困难，是因为四件事叠在一起：

- canvas zoom 会改变 screen-space presentation；
- xterm 自己拥有 renderer 和 backing raster；
- terminal 节点是活的交互面，不是静态图片；
- scroll 和 focus 都是有状态的，不只是视觉效果。

因此，一次“为了变清晰而做的刷新”，很容易意外变成：

- 一次布局刷新；
- 一次 session 刷新；
- 一次 scroll reset；
- 或一次 focus reset。

所以真正的难点不是“怎么让它更清楚”，而是：

`如何在不碰错 state owner 的前提下，触发一次更清晰的 renderer pass。`

## 4. 正确的问题表述

正确的问题表述应是：

`当 viewport zoom 已经稳定（settled）后，renderer 可以按最终的 screen-space presentation 提升 backing density，以恢复清晰度；但这个过程不能改变 terminal 的布局语义、world-space 语义，也不能改变交互语义。`

这里需要明确区分：

- 允许提升 backing density；
- 不允许改变产品的 zoom 语义；
- 允许把 screen-space zoom 当作 renderer oversampling 的输入；
- 不允许要求用户“先回到底部，terminal 才有资格变清晰”。

## 5. 产品约束

以下约束已经和用户明确对齐，属于非协商项：

- terminal / agent 节点必须继续在视觉上跟随 canvas；
- zoom in 后，terminal 在屏幕上看起来继续可以更大；
- 这次重做不能把 terminal 窗口或字形切换到另一套大小模型；
- 不能引入“点击一下 terminal 才恢复默认大小”这类新行为；
- 不能修改现有 viewport zoom 语义。

## 6. State Owner

- `viewport zoom`
  - Owner：canvas / React Flow
  - 规则：不变
- terminal 节点的 `world-space position / size`
  - Owner：现有 node model
  - 规则：不变
- `clarity refresh`
  - Owner：新增的 renderer-level controller
  - 规则：只负责清晰度刷新时机与 renderer 刷新行为
- `scroll state`
  - Owner：xterm buffer / viewport
  - 规则：clarity refresh 前后必须保持
- `focus state`
  - Owner：live xterm instance + helper textarea
  - 规则：clarity refresh 前后必须保持

## 7. 不变量（Invariants）

1. canvas zoom 语义必须保持不变。
2. clarity refresh 不能导致 live terminal instance remount。
3. clarity refresh 不能改变 terminal DOM 的所属层或真实渲染拓扑。
4. clarity refresh 不能再依赖“terminal 当前在底部”。
5. clarity refresh 不能通过 `fitAddon.fit()` 或 PTY resize 实现。
6. user-scrolled 状态必须在 refresh 前后保持。
7. focus、selection、click、wheel、IME 行为必须在 refresh 前后保持。

## 8. 方案选项

### 方案 A：Commit-Only Clarity Refresh

行为：

- 用户正在连续 zoom 时，允许出现短暂的过渡性模糊；
- 当 zoom settled 后，只触发一次 renderer-level clarity refresh。

优点：

- 对 scroll / focus 的风险最低；
- 与已确认需求一致：`B 是必须达成，A 是后续增强目标`；
- 修复边界正确，问题被收在 renderer 层。

缺点：

- 手势进行中不是连续锐利。

### 方案 B：Throttled Progressive Refresh

行为：

- zoom 过程中按节流频率做有限次数刷新，结束后再补一次 final settle refresh。

优点：

- 更接近理想目标 A，即缩放过程中也尽量保持清晰。

缺点：

- 更容易引入 flicker、atlas churn、scroll / focus 回归；
- 不适合作为第一版交付目标。

### 方案 C：Gesture Snapshot / Overlay Surrogate

行为：

- zoom 手势期间先冻结或镜像当前 visual surface，结束后再切回 live terminal。

优点：

- 可能压住手势中的视觉抖动。

缺点：

- 抽象边界错误；
- 容易制造双真相（double truth），影响 focus、caret、selection、hit-testing。

## 9. 推荐方案

本次 Required 交付选择方案 A：`Commit-Only Clarity Refresh`。

原因：

- 它解决的是正确的边界问题：在最终 screen-space 状态已确定之后，做 renderer 重栅格化；
- 它不会改变产品语义；
- 它天然避免“只有到底部才刷新”这种错误 gating；
- 它让第一版交付专注于正确性和行为稳定性，而不是追求手势过程中每一帧都锐利。

Stretch 目标：

- 方案 B 可以在方案 A 稳定且回归覆盖充分之后再评估；
- 但不能把方案 B 和首个稳定交付绑在一起。

## 10. 设计机制

### 10.1 Zoom 生命周期拆分

把 zoom 处理拆成两段：

- `gesture active`
  - 不做重型 clarity refresh；
  - 不 remount xterm；
  - 不调用 `fitAddon.fit()`；
  - 不触发 PTY resize；
- `gesture settled`
  - 等待 viewport transform 稳定；
  - 通过 `requestAnimationFrame` 链路避开中间态布局；
  - 只做一次 renderer-level clarity refresh commit。

### 10.2 Refresh 边界

这次 clarity refresh 必须严格收在 renderer concern 内：

- 针对最终的 screen-space 呈现结果，更新 oversampling / backing density；
- 只重建或重绘 renderer 真正需要的部分；
- 不能引起 terminal lifecycle churn。

明确允许：

- 把 viewport zoom 作为 effective backing density 的输入。

明确禁止：

- 重定义 node size 语义；
- 重定义 glyph size 语义；
- 替换 live terminal instance；
- 把 terminal 渲染移到另一份 DOM 真相里。

### 10.3 Scroll / Focus Guard

在 clarity refresh 前：

- 记录 `viewportY`
- 记录 `isUserScrolling`
- 如有需要，记录 focus 状态用于事后验证

在 clarity refresh 后：

- 验证仍是同一个 terminal instance；
- 只有在 renderer refresh 意外扰动 scroll 时，才恢复或重申 scroll 状态；
- 验证 focus 语义不变。

这是一层防御式 guard，不是新的产品规则。  
它不能再演变成“只有 terminal 在底部才刷新”。

## 11. 明确否决的问题 framing 与方案

以下 framing / approach 明确否决：

- “这只是一个 CSS transform 微调问题。”
  - 否。CSS-only 无法凭空增加 backing pixels。
- “这主要是一个 scroll ownership 问题。”
  - 否。scroll 保护是需要的，但不是根因。
- “用户在历史里上滚时应该继续模糊，直到回到底部。”
  - 否。错误的产品语义。
- “portal / overlay / mirror rendering 才是正确方向。”
  - 否。owner 边界不对，交互风险过高。
- “可以安全复用 fit/resize 主路径解决。”
  - 否。这样会把清晰度问题错误地下沉到布局和 PTY concern。

## 12. 验收标准

- terminal / agent 节点继续按既有产品逻辑跟随 zoom；
- zoom settled 后 terminal 会恢复清晰；
- 用户处于上滚历史状态时，zoom settled 后 terminal 也会恢复清晰；
- clarity refresh 不会导致 terminal remount；
- 不会引入新的 click / focus 行为；
- wheel scroll、selection、IME、click 行为不回归；
- 实现不再依赖 bottom-of-buffer heuristics 来决定“是否有资格变清晰”。

## 13. 验证计划

### Unit

- `zoom settled` 判定
- controller 只在 settled 后触发 commit
- user-scrolled terminal 依然有资格刷新

### Integration

- refresh 前后保持 `viewportY`
- refresh 前后保持 `isUserScrolling`
- refresh 前后保持 terminal instance identity

### E2E

- zoom in 之后，settled refresh 能带来更清晰的 render metrics
- user-scrolled terminal 在 settle 后也会变清晰
- focus / click / selection 行为保持正常
- 有专项回归证明“只有到底部才清晰”已经被移除

## 14. 风险与取舍

- 方案 A 明确用“手势中的短暂过渡”换取“行为稳定性”；
- 方案仍依赖 xterm renderer 内部路径，未来升级 xterm 版本时需要重新验证；
- 设计必须持续防 scope creep，不能滑向 zoom 语义、布局语义或 node topology 重构。

## 15. 结论

安全的重做方向是：

- 保持既有 zoom 语义不变；
- 把清晰度问题明确收口为 renderer-only re-rasterization 问题；
- 在 zoom settled 后做一次 clarity refresh；
- 在 refresh 前后保持 scroll / focus 状态；
- 并明确否决 bottom-gated、overlay-based、fit/resize-based 作为主路径。
