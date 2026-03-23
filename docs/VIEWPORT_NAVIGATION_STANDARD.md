# Viewport Navigation Standard

本规范定义 OpenCove 画布中“定位 + 目标缩放”的统一行为，确保从不同入口进入目标窗口时体验一致、可预期。

> 关联全局 UI 规范：`docs/UI_STANDARD.md`

## 1. 标准动作

当触发“定位导航”时，统一执行：

1. 将目标节点中心作为视口中心；
2. 将画布缩放切换到目标缩放（默认 `zoom = 1`，可配置）；
3. 使用平滑动画过渡。

## 2. 触发入口

### 2.1 点击左侧 `Agents` 列表项

- 必须执行“定位 + 目标缩放”；
- 不受设置开关影响（始终生效）；
- 目标节点为被点击的 Agent 节点。

### 2.2 点击节点窗口本体

- 默认执行“定位 + 目标缩放”；
- 受设置项控制：`focusNodeOnClick`。

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
5. `trackpad` 模式下，不按 Shift 左键拖动可框选；
6. `mouse` 模式下，仍需 `Shift + 左键拖动` 才可框选；
7. `auto` 模式下，仅高置信手势输入可切换为触控板框选行为；单次普通滚轮不会切换。
8. 已选中节点在平移画布时不被清空，空白单击可清空；
9. 连续触控板平移中，指针掠过终端节点不应打断画布平移目标。

## 7. 参考实现位置

- `src/contexts/workspace/presentation/renderer/components/WorkspaceCanvas.tsx`
- `src/contexts/workspace/presentation/renderer/components/TerminalNode.tsx`
- `src/contexts/settings/domain/agentSettings.ts`
- `src/contexts/settings/presentation/renderer/SettingsPanel.tsx`
