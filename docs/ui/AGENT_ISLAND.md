# Agent Island

> 关联：提醒的路由与通道开关见 [Agent attention](../agent/ATTENTION.md)；像素几何、节奏与减弱动态见
> [Spatial Pixel](./SPATIAL_PIXEL_THEME.md)。

顶栏右侧的 Agent 胶囊、它打开的列表，以及 Agent 开始等你时从胶囊里长出来的卡片，合起来叫
Agent island。三者读同一份 Agent 模型（`summarizeAgentActivity`，与侧栏一致），点哪里都走同一个
聚焦跳转。

## 胶囊

- 有 Agent 等你时是琥珀色，叠放最多 3 个等待中 Agent 的标记和数量；只有 Agent 在工作时是中性色，
  带三个像素点；没有 Agent 等待或工作时隐藏。
- 「等你」包括两种：卡在提示上的 Agent（运行状态 `waiting`），以及结束了一轮、卡片出过但你还没回应的
  Agent（`useAgentAttentionStore`，见 [Agent attention](../agent/ATTENTION.md#unanswered-agents)）。
  单个 Agent 的状态分别显示「需要你回复」（或「需要批准 / 有问题想问你 / 计划待审阅」）与「已完成」；聚合显示「需要你」，计数不变。
  后者的等待时长从卡片出现算起。侧栏的收件箱、项目角标、Agent 行和 Space 计数与小地图都读同一份。
- 悬停 150ms 预览列表，离开留 300ms 余量；单击或 Enter 固定打开，ArrowDown 打开并聚焦第一行。
  悬停预览不抢焦点，也不替换顶栏里已经打开的其他面板。列表与控制中心共用右上角，打开一个会关闭另一个。

## 列表

- 像素游戏窗口（`.cove-pixel-window`）：先列等你的 Agent，再列工作中的，每行是窗口图标（AI 底色上的
  provider 标记，右下角是项目图标）、标题和所在位置。
- 方向键、Home、End 在行间移动并循环，Escape 关闭并把焦点还给胶囊；指针或焦点所在行有闪烁的像素光标。

## 卡片

一个 Agent 结束一轮时，路由（`createAgentAttentionRouter`）决定是否出卡片；卡片仍是每个 Agent 一张，
同一个 Agent 再结束一轮是一张新卡片（`islandCardKey` = id + 出现时间）。

- **位置**：像素窗口，右边缘与胶囊对齐，在胶囊下方 8px，离窗口边缘至少 12px。胶囊未测量到时
  （隐藏或零宽）退回顶栏下方右侧。层级用 `--cove-z-popover`，对话框会盖住它。
- **内容**：40px 窗口图标（24px provider 标记，右下角 20px 项目图标）、标题、闪烁的琥珀像素和
  「已完成」（若已进入新的阻塞，则显示对应阻塞状态）、上下文标签（项目，以及设置里打开的任务、Space、分支、PR），右上角 ✕。
  标题取自提醒快照；provider 与项目图标实时读 Agent 模型。
- **倒计时**：底部 12 格像素，6 秒内从右往左每 500ms 熄灭一格，熄完卡片在 150ms 的三帧里收回胶囊，
  Agent 留在胶囊里继续等你。
  指针停在卡片堆上、焦点在卡片堆内，或 OpenCove 不在前台时，所有卡片暂停计时；暂停保留剩余时间。
  前台状态由 main 按窗口判断（`window-chrome:get-focus` / `window-chrome:focus-changed`），
  渲染层不自己猜。
- **堆叠**：最多 3 张，新的在前；旧卡收在后面，每张向下多露 8px、缩小 4%，只画窗口外框。
  指针或焦点进入时按各自高度展开，间距 8px。被新卡挤到第 4 张的直接收回胶囊，前面的卡收回后
  不会再冒出来。
- **结束**：分「收回」和「回应」两种，参照 macOS 横幅进通知中心。
  - 收回：倒计时结束、被挤出前 3 张、打开胶囊列表（列表里本来就有它们，列表开着时新到的也直接收回）。
    卡片三帧折回胶囊，Agent 仍算等你。
  - 回应：✕（三帧折起后移除），或从任何入口跳到该 Agent（卡片、列表、侧栏、命令中心、系统通知，
    都走 `handleSelectAgentNode`）。Agent 重新工作时也会清除。
- **粒子**：新卡片出现在最前时，约 18 粒 3–4px 的像素火花从胶囊飞进它的窗口图标：在 140ms 内
  错开出发、寿命 560–760ms，沿弧线飞行（拱高 28px），位移用画布火花的阻尼曲线
  `(1 - e^(-2.4t)) / 2.4`，透明度 `(1 - t)^1.2`，颜色取 `--cove-kind-ai-glyph` 与
  `--cove-status-waiting`。画布只在火花飞行时挂载，最后一粒消失即卸载，平时没有画布也没有
  动画帧循环；同一张卡片重渲染不会再发火花。
- **动效**：所有位移与尺寸变化都是 `steps(3)` 的硬帧；减弱动态下没有入场、收回、闪烁和粒子，
  倒计时照常计时。

## 不变式

- 一次状态变化最多一张卡片、一次声音、一条系统通知（见 [Agent attention](../agent/ATTENTION.md)）。
- 卡片、列表、侧栏、命令中心、系统通知点击都用同一个聚焦函数，跳过去就算回应。
- 收回从不回应：胶囊里等你的 Agent 只在 ✕、跳转或它重新工作时离开。
- 没有动画时不存在粒子画布和 rAF 循环。

## 测试

- 卡片堆、倒计时与暂停、收回与回应、列表并入、粒子挂载与卸载、减弱动态：`AgentIsland.spec.tsx`。
- 未回应的 Agent：`useAgentAttentionStore.spec.ts`、`agentActivitySummary.spec.ts`；项目角标：
  `Sidebar.navigation.spec.tsx`。
- 倒计时剩余时间：`useIslandCountdown.spec.tsx`；火花轨迹：`islandSparks.spec.ts`。
- 窗口前台状态：`useWindowFocused.spec.tsx`、`tests/unit/app/windowFocus.spec.ts`。
- 胶囊与列表：`AppHeaderAgentActivity.spec.tsx`。
- 端到端：`tests/e2e/workspace-canvas.agent-island.spec.ts`（卡片在胶囊下、粒子画布出现后卸载、
  不在前台时不收回、在前台 6 秒后收回而胶囊仍显示等你、从列表跳过去后胶囊消失、减弱动态无粒子）。E2E 的窗口是 `inactive` 模式，从不获得焦点，
  所以卡片默认一直暂停；测试用 `BrowserWindow.emit('focus')` 模拟回到前台。
