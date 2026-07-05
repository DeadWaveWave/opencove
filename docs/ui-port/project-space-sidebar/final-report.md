# Project Space Sidebar UI 对标最终报告

## 结果

已完成本轮侧边栏 UI 对齐：

- 去掉展开态 sidebar 内的 `项目` 标题和文字添加按钮。
- Sidebar 顶部新增 pin/add icon button；header 中旧 sidebar toggle/add project 控件已移除；rail 收起态不显示 add。
- 单独的 sidebar auto reveal 设置项已移除；pin 状态决定 sidebar 常驻展开或收起为 rail，收起时 hover 临时展开。
- Space 和 Agent 在展开态共享左侧内容列，Agent 不再额外右缩进。
- Space item 左侧图标已移除，仅保留标题与右侧箭头。
- Space group 竖线提升到 group 容器层，从 Space 前方开始向下连接 Agent。
- 未标色 Space 在展开 sidebar 与 rail 中使用主题默认 accent 底色；标色 Space 始终保持对应 label color，不再只在点击/active 后显示；分组竖线也使用同一 Space 颜色。
- Project/Space/Agent 图标在展开态、收起态使用一致尺寸。
- 展开态 active Space 与收起态 rail active Space 使用一致的实色底。
- Project/Space 的折叠状态在展开态和 rail 态之间共享；rail 中其它 Project 也按自身状态保留列表。
- Agent 默认态透明；hover 或显式 label color 时才出现底色。
- Agent 状态从圆点/statusline 改为 provider icon 外圈 ring；展开态与收起态使用一致状态表达。
- 展开态与收起态 Project/Space/Agent item 高度、active Project group 总高度已通过 E2E 实测对齐。
- active Project group 增加轻量 outline/底色，用于区分不同 Project 的子树归属；Project item 和 rail folder 自身不再绘制内层 active 框。
- Project/Space 右侧展开控制改为 10px 实心三角，toggle 命中区保持 24px，视觉更接近浏览器垂直标签页密度。
- 收起态 rail 统一 Project/Space/Agent 28px item 节奏，Space 仅显示箭头，保留 Space 到 Agent 的竖线归属关系；分组线到 item 的距离与展开态一致，Space/Agent rail item 回到 rail 中心。
- hover 自动展开增加 width/content 过渡，并提高 sidebar 层级，避免被画布顶部 chips 遮挡。
- Space/Agent 右键菜单加入 label color 修改；右键菜单在点击画布等外部区域时关闭，并覆盖画布阻止事件冒泡的情况。
- Sidebar Space 右键菜单改为 Edge 分组菜单式顶部编辑区：名称输入框、横向颜色点、分隔线、Space 路径操作。
- Space `...` 菜单的颜色点移动到分隔线以上，直接展示更紧凑的横向色点行；sidebar Space 菜单和 `...` 菜单的宽度已进一步收紧以减少右侧空白，色点按钮为 20px 正方形、横向 gap 为 2px，并在行内垂直居中；selected check 在 sidebar 菜单和 `...` 菜单内统一显示于色点中心。
- 展开态 sidebar list 禁止横向 overflow，避免左右滑动。
- Sidebar Space 右键菜单未直接复制 canvas Space `...` 的归档/worktree/二级菜单；这些行为当前由 canvas hooks 拥有，需要 Large 方案先收口 action owner。

## 视觉证据

- Reference / before：用户在会话中提供的展开态、收起态截图。
- Target after rail：`test-results/app-header.primary-sidebar-e1d8d--the-unpinned-rail-on-hover-electron/primary-sidebar-rail.png`
- Target after peek：`test-results/app-header.primary-sidebar-e1d8d--the-unpinned-rail-on-hover-electron/primary-sidebar-peek.png`

## 验证

- `pnpm test -- --run src/app/renderer/shell/components/Sidebar.spec.tsx src/app/renderer/shell/components/ProjectContextMenu.spec.tsx tests/unit/contexts/workspaceSpaceActionMenu.spec.tsx`
- `pnpm check`
- `pnpm build`
- `pnpm exec playwright test tests/e2e/app-header.primary-sidebar-toggle.spec.ts:97 --project electron --reporter=line`（测量展开/收起 item 高度、active project group 总高度、rail item 居中、展开态 list overflow-x、默认/标色 Space 底色、Space 分组竖线颜色与距离、sidebar 菜单宽度、色点按钮尺寸/垂直居中、Agent 状态 ring）
- `pnpm exec playwright test tests/e2e/workspace-canvas.label-colors.spec.ts --project electron --reporter=line -g "sets space label color"`（测量 Space `...` 菜单宽度、色点按钮尺寸/垂直居中）
- `pnpm pre-commit`（上一轮完整回归：236 passed, 47 skipped, 11.6m；本轮密度与关闭逻辑增量后未重新跑完整套件）

## 检查清单

- 每个 in-scope UI 状态有参考截图或说明：已满足，参考来自用户截图。
- 每个 in-scope UI 状态有 target-after 截图：已满足，rail/peek E2E 截图已生成。
- 关键交互有自动化验证：已满足，unit + E2E 覆盖 header add、rail/peek、右键菜单、项目创建入口。
- 剩余差异：未保留 target-before 工具截图，原因是本轮 before 状态由用户截图直接给出；不影响本轮验收判断。
