# Window UI Standard

本规范定义 Cove 中所有“悬浮窗口/弹窗/面板”的统一视觉语言。

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
- 推荐：`rgba(5,10,20,0.58)` + `backdrop-filter: blur(4px)`

### 2.2 Surface
- 16px 圆角
- 蓝色半透明边框
- 顶部径向高光 + 深色纵向渐变
- 双层阴影（外投影 + 内高光）

### 2.3 Input
- 10px 圆角
- 深色底 + 蓝色边框
- Focus 有外发光 ring（3px）

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
- `workspace-task-creator-backdrop`
- `workspace-task-creator`
- `workspace-task-creator__field-row`
- `workspace-task-creator__actions`
- `workspace-task-creator__action`
- `workspace-task-creator__action--ghost|secondary|primary|danger`
- `workspace-task-creator__error`

### 4.2 各窗口复用策略
- Agent Launcher / Delete Confirm 复用上面类，并保留自身语义类（便于测试和局部覆盖）。
- Settings 保持布局独立，但视觉 token 与上述窗口一致。

## 5) 新窗口开发 Checklist

- 是否使用统一 backdrop / surface token
- 是否使用统一按钮语义（ghost/secondary/primary/danger）
- 是否提供稳定 `data-testid`
- 是否保证键盘与关闭行为一致（Esc / blur / confirm）

