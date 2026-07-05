# Project Space Sidebar UI 对标进度

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 记录差距 | verified | 已根据用户截图和参考模式记录 gap report。 |
| 展开态左对齐与分组线 | verified | `SpaceGroup` 容器负责分组线，Space/Agent 共享内容列，active Space 使用与 rail 一致的实色底。 |
| Agent 默认透明 | verified | Sidebar 和 rail Agent 默认透明，hover/显式 label color 才有底色。 |
| 收起态 rail 视觉 | verified | Project/Space/Agent 使用 28px item 基准和更小 icon 尺寸，Space 只显示分组箭头，分组线从 Space group 开始；rail 分组线到 item 的距离与展开态一致，Space/Agent rail item 回到 rail 中心。 |
| 展开/收起状态一致性 | verified | Rail 读取同一份 Project/Space collapsed state，所有 Project 在 rail 中按自身状态保留展开/收起。 |
| hover reveal 过渡 | verified | Sidebar width/content 有过渡，E2E 断言非零 transition duration；单独设置项已移除，pin 状态控制常驻/收起。 |
| Sidebar 顶部操作区 | verified | pin/add icon button 移入 sidebar 顶部，header 中旧 sidebar/add 控件已移除。 |
| 右键菜单颜色与关闭 | verified | Space/Agent 右键菜单复用 `LABEL_COLORS`；点击 workspace context menu 外部会关闭，capture 阶段覆盖画布阻止冒泡的情况。 |
| Space 默认/标色底色 | verified | 未标色 Space 使用主题默认 accent，标色 Space 使用 label color；展开 sidebar 和 rail 中常显底色，不依赖 active 状态。 |
| Space 分组竖线颜色 | verified | 默认/标色 Space 的 sidebar/rail 分组竖线与 Space 颜色一致，并有 E2E `::before` 背景测量。 |
| Agent 状态 ring | verified | Agent 可见状态改为 provider icon 外圈 ring，expanded/rail 使用一致视觉；旧 statusline 已移除，仅保留隐藏状态文本供测试/无障碍。 |
| Space 菜单颜色位置 | verified | Sidebar Space 右键菜单顶部显示名称输入和横向颜色点；Space `...` 菜单颜色点移动到分隔线以上。 |
| Space 菜单密度 | verified | Sidebar Space 右键菜单与 Space `...` 菜单进一步收紧宽度，减少右侧空白；色点按钮为 20px 正方形，横向 gap 为 2px，selected check 在中心，并由 E2E bounding box/垂直居中断言覆盖。 |
| Project 分区 | verified | active Project group 增加轻量 outline/底色，展开态和 rail 态都用于区分不同 Project；Project item/rail folder 自身保持透明，避免框中框。 |
| 实心三角与命中区 | verified | Project/Space 右侧展开控制改为 10px 实心三角，按钮命中区保持 24px，视觉更接近浏览器垂直标签页密度。 |
| 展开/收起尺寸测量 | verified | E2E 使用 `getBoundingClientRect()` 比较 Project/Space/Agent item 高度、active project group 总高度、rail item 居中、rail/peek 分组线到 item 的距离、菜单宽度以及颜色按钮正方形/垂直居中尺寸；展开态 sidebar list 禁止横向 overflow。 |
| Sidebar/Canvas 菜单复用 | deferred | Sidebar 右键菜单属于 shell 层，canvas Space `...` 菜单归 `WorkspaceSpaceActionMenu`/canvas hooks 拥有；归档/worktree/二级菜单需要 Large 方案收口 action owner，未在本轮小改中复制假按钮。 |
| 自动化验证 | verified | Targeted unit/E2E/build 已通过；新增高度、背景、竖线、状态 ring 一致性断言；上一轮完整 `pnpm pre-commit` 已通过，本轮菜单密度增量跑 targeted 验证。 |
