# Viewport Navigation Standard

本规范定义 Cove 画布中“定位 + 归一缩放”的统一行为，确保从不同入口进入目标窗口时体验一致、可预期。

## 1. 标准动作

当触发“定位导航”时，统一执行：

1. 将目标节点中心作为视口中心；
2. 将画布缩放归一到 `zoom = 1`；
3. 使用平滑动画过渡。

## 2. 触发入口

### 2.1 点击左侧 `Agents` 列表项

- 必须执行“定位 + 归一缩放”；
- 不受设置开关影响（始终生效）；
- 目标节点为被点击的 Agent 节点。

### 2.2 点击终端/Agent 窗口本体

- 默认执行“定位 + 归一缩放”；
- 受设置项控制：`normalizeZoomOnTerminalClick`。

## 3. 参数约定

- 归一缩放目标：`zoom = 1`。
- 动画时长：`duration = 120~220ms`（当前实现：
  - 侧栏 Agent 导航：`220ms`
  - 终端点击归一：`120ms`
  ）

## 4. 设置项

- Key: `normalizeZoomOnTerminalClick`
- 默认值：`true`
- UI 位置：`Settings > Canvas > Click terminal auto-zooms canvas to 100%`

说明：此开关仅控制“终端点击”入口；不影响左侧 `Agents` 导航。

## 5. 回归验收

至少覆盖以下场景：

1. 先缩放画布（非 1x），点击左侧 `Agents` 项，视口归一并居中到对应 Agent；
2. 先缩放画布（非 1x），点击终端窗口，视口归一并居中（开关开启）；
3. 关闭开关后，点击终端窗口不再强制归一；
4. 切换 workspace 后，上述行为仍一致。

## 6. 参考实现位置

- `src/renderer/src/features/workspace/components/WorkspaceCanvas.tsx`
- `src/renderer/src/features/workspace/components/TerminalNode.tsx`
- `src/renderer/src/features/settings/agentConfig.ts`
- `src/renderer/src/features/settings/components/SettingsPanel.tsx`
