# Viewport Navigation Standard

本规范定义 OpenCove 画布中的定位导航行为，确保从不同入口进入目标区域时体验一致、可预期。

> 关联全局 UI 规范：`docs/ui/README.md`

## 1. 标准动作

当触发“节点定位导航”时，统一执行：

1. 将目标节点中心作为视口中心；
2. 将画布缩放切换到目标缩放（默认 `zoom = 1`，可配置）；
3. 使用用户选择的视口转移效果；系统减少动态效果开启时直接定位。

当触发“区域定位导航”时，统一执行：

1. 将目标 flow 坐标作为视口中心；
2. 保持当前画布缩放不变；
3. 使用用户选择的视口转移效果；系统减少动态效果开启时直接定位。

## 2. 触发入口

### 2.1 点击左侧 `Agents` 列表项

- 必须执行“定位 + 目标缩放”；
- 不受设置开关影响（始终生效）；
- 目标节点为被点击的 Agent 节点。

### 2.2 点击节点窗口本体

- 默认执行“定位 + 目标缩放”；
- 受设置项控制：`focusNodeOnClick`。

### 2.3 双击右下角 MiniMap

- 必须执行“定位 + 保持当前缩放”；
- 不受 `focusNodeTargetZoom` 影响；
- 目标位置为双击点对应的 flow 坐标。

## 3. 参数约定

- 目标缩放：`zoom = focusNodeTargetZoom`（默认 `1`）。
- 允许值：`0.1 ~ 2.0`（与画布缩放范围保持一致，步进 `0.01`）。
- 动画时长：`duration = 120~220ms`（当前实现：
  - 侧栏 Agent 导航：`220ms`
  - 终端点击归一：`120ms`
  ）

## 4. 设置项

- Key: `focusNodeOnClick`
- 默认值：`true`
- UI 位置：`Settings > Canvas > Auto-focus on Click`

- Key: `focusNodeTargetZoom`
- 默认值：`1`
- UI 位置：`Settings > Canvas > Target Zoom`

说明：`focusNodeOnClick` 只控制“节点点击”入口；不影响左侧 `Agents` 导航。`focusNodeTargetZoom` 对两个入口都生效。

### 4.1 视口转移效果

- Key：`viewportTransition`；可选 `fly`（缩放飞行，默认）与 `slide`（平滑移动）。
- 设置位置：`Settings > Canvas & Windows > Node Focus > Viewport Transition`。
- 节点点击、侧栏定位、方向快捷键、Space 与全部 Space 定位共用同一策略；MiniMap
  区域定位也遵循该策略。原有目标位置、目标缩放和 120–220ms 时长保持各入口的语义。
- `fly` 使用 React Flow 的 `smooth` 插值，保留远距离时先拉远再靠近的效果。
- `slide` 使用 `linear` 空间插值与框架默认 cubic-in-out 时间缓动；同倍率移动保持倍率，
  变倍率时缩放只在起止范围内变化，不额外拉远。
- 系统 `prefers-reduced-motion: reduce` 优先于效果偏好，下一次导航直接定位。
- 切换设置不触发导航，下次导航读取最新值；缺失/非法值归一为 `fly`，重启恢复已保存值。

| 状态 | Owner | 写入入口 | 重启来源 |
| --- | --- | --- | --- |
| 效果偏好 | settings domain 定义，AppStore 持有 Renderer 设置投影 | 现有设置 updater、归一化与持久化链路 | 已保存的 settings |
| 当前位置与动画 | React Flow / D3 | 共用导航 helper、Space 定位与用户手势 | 现有 workspace view state |
| 导航请求 | 现有节点/Space 导航 owner | 点击、侧栏与快捷键 | 不恢复未完成动画 |

路由：用户入口 → 现有目标计算 → 共用动画策略 → React Flow → move-end → 现有视口保存。
只把策略收口，不创建另一套逐帧状态或动画引擎，不在主进程执行动画。

不变量：

1. 效果只改变路径，不能改变目标位置、选择语义或最终缩放。
2. 新导航与手动手势接管旧动画；画布卸载/切换工作区在 layout cleanup 中以即时定位停止旧动画。
3. 设置与视口使用各自已有 owner；动画帧不写入偏好。被打断的 React Flow Promise 可能
   不结束，必要清理不得依赖它完成。

初始化恢复以 React Flow 的 `viewportInitialized` 为准，在 layout 阶段完成；不能通过延迟一帧
恢复旧位置，否则可能覆盖更新的节点定位。新建节点的定位意图在视口就绪前保留，就绪后在
恢复完成的 effect 阶段消费；连续创建只保留最新定位。

验证：归一化、策略与初始化顺序用 unit 覆盖；Electron E2E 安装 Playwright Clock 后重载页面，
让 D3 和 rAF 使用同一可控时钟，检查两种效果落点误差 ≤1px、平移倍率边界、双向导航、
快速切换、手动接管、减少动态效果及重启恢复。普通 E2E 仍跳过动画；专用动画用例设置
`document.documentElement.dataset.opencoveTestViewportAnimation = 'true'` 启用生产动画路径。
轨迹数据标记为 controlled，失败时也保留已采样结果；可控时钟与截图只用于行为验证，
真实流畅度、掉帧与 Long Animation Frame 必须另外在实时运行中观察，不能由虚拟帧间隔推断。
该测试标记不改变生产环境策略。

参考：[React Flow viewport API](https://reactflow.dev/api-reference/types/react-flow-instance)、
[D3 zoom 的插值与中断](https://d3js.org/d3-zoom)。

## 5. 触控板输入模式（新增）

- Key: `canvasInputMode`
- 可选值：
  - `auto`（默认）：仅根据高置信输入信号自动切换；普通 `wheel` 模糊时保持当前模式，不靠单次滚轮幅度翻转；
  - `mouse`：保持鼠标优先习惯（滚轮缩放，`Shift + 左键拖动`框选）；
  - `trackpad`：触控板优先习惯（双指滚动平移，左键拖动直接框选）。

在 `auto` 模式下，优先识别 `pinch / ctrlKey / 连续高频 gesture burst` 这类高置信信号；普通鼠标滚轮默认保持鼠标语义。若检测结果与设备体验不一致，用户可手动切换为固定模式。

### 5.1 交互建模（画布特化）

以下规则属于画布交互系统的领域特化约束，应写在专项文档中，不上升为全局开发守则：

- `gesture target owner`：连续手势一旦开始，就锁定本次手势的目标对象；中途掠过其他节点不应改写语义。
- `selection owner`：节点/space 的选中与反选由统一 selection 语义负责，输入框、标题编辑等子元素不得偷偷保留或改写隐形选中。
- `mode owner`：`mouse / trackpad / auto` 模式切换只能由高置信输入信号触发；单次模糊滚动不应翻转模式。
- `semantic exclusivity`：同一连续输入在同一时刻只能落入一种主语义，例如 `pan`、`zoom`、`selection toggle`、`marquee select` 之一，不能并发混用。
- `blank-space rule`：空白点击负责清空选择；节点命中负责节点语义；两者边界必须稳定且可预测。

补充交互语义：

- 空白单击：清空当前节点选中；
- Shift + 左键单击节点 / 已选中的 space：切换该对象的选中状态；
- 框选（不按 Shift）：以本次框选结果替换当前选中；
- 框选（按住 Shift）：对本次框选命中的节点/空间执行反选；未命中的保持原状；
- 触控板平移/捏合手势启用“目标锁定”：同一连续手势中，即使指针掠过节点，仍保持起始目标（例如画布）不变。

## 6. 回归验收

至少覆盖以下场景：

1. 先缩放画布（非 1x），点击左侧 `Agents` 项，视口切到目标缩放并居中到对应 Agent；
2. 先缩放画布（非 1x），点击任意节点窗口，视口切到目标缩放并居中（开关开启）；
3. 关闭开关后，点击节点窗口不再强制定位/缩放；
4. 切换 workspace 后，上述行为仍一致。
5. 先缩放画布（非 1x），双击右下角 MiniMap 某个区域，视口居中到该区域且缩放不变；
6. `trackpad` 模式下，不按 Shift 左键拖动可框选；
7. `mouse` 模式下，仍需 `Shift + 左键拖动` 才可框选；
8. `auto` 模式下，仅高置信手势输入可切换为触控板框选行为；单次普通滚轮不会切换。
9. 已选中节点在平移画布时不被清空，空白单击可清空；
10. 连续触控板平移中，指针掠过终端节点不应打断画布平移目标。

## 7. 参考实现位置

- `src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas.tsx`
- `src/contexts/workspace/presentation/renderer/components/TerminalNode.tsx`
- `src/contexts/settings/domain/agentSettings.ts`
- `src/contexts/settings/presentation/renderer/SettingsPanel.tsx`
