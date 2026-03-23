# Window UI Standard

本规范定义 OpenCove 中所有“悬浮窗口/弹窗/面板”的统一视觉语言。

> 关联全局 UI 规范：`docs/UI_STANDARD.md`

目标：
- 一眼识别为同一系统；
- 操作层级一致（取消 / 辅助 / 主动作）；
- 复用样式，降低后续维护成本。

## 1) 适用范围

- Task Create / Edit / Assign
- Task Delete Confirm
- Agent Launcher
- Settings Panel（作为大型窗口面板）

## 2) 统一视觉 Token

### 2.1 Backdrop
- 深色遮罩 + 轻微模糊
- 推荐：`background: var(--cove-backdrop)` + `backdrop-filter: blur(4px)`

### 2.2 Surface
- 16px 圆角
- 边框/底色/阴影必须跟随主题 token（例如 `--cove-window-surface`、`--cove-surface*`、`--cove-border*`、`--cove-shadow-color-*`）

### 2.3 Input
- 10px 圆角
- `background: var(--cove-field)` + `border: 1px solid var(--cove-border)`
- Focus 用 `--cove-accent` 的描边 + ring（避免刺眼）

### 2.4 Action Buttons
- `ghost`：取消、关闭
- `secondary`：辅助动作（如 Generate by AI）
- `primary`：提交动作（Create / Save / Apply / Run）
- `danger`：不可逆动作（Delete）

## 3) 交互一致性

- 点击遮罩关闭窗口（危险动作弹窗除外时需二次确认）
- 主按钮始终放最右
- 错误信息用统一 error block 样式
- 小窗优先简洁，复杂编辑由完整弹窗承载

## 4) 实现约定（当前）

### 4.1 通用样式类
- `cove-window-backdrop`
- `cove-window`
- `cove-window__field-row`
- `cove-window__checkbox`
- `cove-window__actions`
- `cove-window__action`
- `cove-window__action--ghost|secondary|primary|danger`
- `cove-window__error`

### 4.2 各窗口复用策略
- Agent Launcher / Delete Confirm / Task dialogs 直接复用 `cove-window-*`。
- Settings 使用同一视觉 token（遮罩、玻璃面板、输入焦点），布局结构保持独立。

## 5) 新窗口开发 Checklist

- 是否使用统一 backdrop / surface token
- 是否使用统一按钮语义（ghost/secondary/primary/danger）
- 是否提供稳定 `data-testid`
- 是否保证键盘与关闭行为一致（Esc / blur / confirm）
