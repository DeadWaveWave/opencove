# Window UI Standard

本规范定义 OpenCove 中所有“悬浮窗口/弹窗/面板”的统一视觉语言。

> 关联全局 UI 规范：`docs/ui/README.md`

目标：
- 一眼识别为同一系统；
- 操作层级一致（取消 / 辅助 / 主动作）；
- 复用样式，降低维护成本。

## 1) 适用范围

- Task Create / Edit / Assign
- Task Delete Confirm
- Agent Launcher
- Settings Panel（作为大型窗口面板）
- 由右键菜单、工具栏按钮触发的上下文操作浮层

### 1.1 先选择正确的容器

- **上下文操作浮层（Popover）**：重命名、创建 Worktree、归档、挂载选择、删除确认等短流程，应锚定触发项附近；提交前点击外部或按 Esc 关闭，不遮挡整个应用。
- **局部异步状态**：提交后立即收起浮层；由操作所属的 Space 投射轻量磨砂忙碌状态，只锁定目标 Space，其余 Space 和应用区域保持可操作。
- **模态窗口（Modal）**：仅用于必须打断全局流程的决策，或无法在小浮层中清晰完成的复杂管理任务。

状态所有权不得放在会因点击外部而卸载的 Popover 内。异步操作必须由更长生命周期的 owner 持有，并保证：同一操作只能完成一次、错误可以重新进入上下文修复、卸载后不提交过期 UI 状态。

Popover 内的 Select、日期选择等 Portal 子层必须登记为同一 transient layer owner：点击子层不得关闭父层，Esc 只关闭最上层。两个完整 surface 之间应使用状态接力，禁止在同一锚点重叠显示。

## 2) 统一视觉 Token

### 2.1 Backdrop
- 深色遮罩 + 轻微模糊
- 推荐：`background: var(--cove-backdrop)` + `backdrop-filter: blur(4px)`

### 2.2 Surface
- 16px 圆角
- 边框/底色/阴影必须跟随主题 token（例如 `--cove-window-surface`、`--cove-surface*`、`--cove-border*`、`--cove-shadow-color-*`）
- 上下文操作浮层使用更紧凑的圆角、内边距与菜单同源的材质，避免呈现为缩小版模态框。

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

- 模态窗口点击遮罩关闭；上下文操作浮层点击外部或按 Esc 关闭（提交进行中除外）
- 主按钮始终放最右
- 错误信息用统一 error block 样式
- 小窗优先简洁，复杂编辑由完整弹窗承载
- 动效应短促且只表达空间关系；必须支持 `prefers-reduced-motion`，不得用动效延迟可操作状态

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
- 是否根据任务范围正确选择 Popover、局部忙碌状态或 Modal
- 是否让异步 owner 独立于浮层生命周期，并将忙碌状态限制在目标 Space
- 是否验证亮色、暗色与减少动态效果模式
