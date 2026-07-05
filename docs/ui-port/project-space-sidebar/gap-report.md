# Project Space Sidebar UI 对标差距报告

## 范围

本次对齐左侧 Project / Space / Agent 导航，使其更接近 Edge 垂直标签与 compact navigation pane：展开态强调层级和左对齐，收起态强调一致图标尺寸、稳定分组线和顺滑 hover reveal。

参考来源：用户提供的展开态与收起态截图、Edge 垂直标签/标签组行为、WAI-ARIA 菜单外部点击关闭约定。

## 验收标准

- 展开态去掉 `项目` 标题，sidebar 顶部提供 pin 和 add icon button，header 不再承担 sidebar/add 控件。
- Space 与 Agent 的内容左对齐，Agent 不再比 Space 多缩进。
- Space 分组竖线从 Space 行前方开始，并向下连接 Agent；有 Space 颜色时竖线使用同一颜色。
- 未标色 Agent 默认透明；hover 或显式 label color 才出现底色。
- 收起态 Project / Space / Agent 图标尺寸一致，Space 只显示展开箭头，按钮尺寸节奏一致。
- 收起态顶部不显示 add 按钮，仅保留 pin 控制。
- 折叠 hover 自动展开/收回有宽度与内容过渡动画，行为由 sidebar pin 状态决定，不再提供单独设置项。
- Project/Space/Agent 右键菜单保留重命名；Space/Agent 右键菜单复用 label color 体系；点击画布等外部区域自动关闭菜单。
- 标色 Space 在 sidebar 中始终保持对应颜色底色，而不是只有 active/点击后才显示。
- Agent 状态改为 provider icon 外圈状态 ring，展开态和收起态都用同一视觉语义，不再显示额外 statusline。
- 默认未标色 Space 也使用主题 accent 作为默认底色；用户设置 label color 时覆盖为对应颜色。
- Space 右键菜单按 Edge 分组菜单结构展示：顶部 Space 名称输入框、横向颜色点、分隔线，再显示 Space 路径操作。
- Space `...` 菜单的颜色点移动到分隔线以上，直接横向展示，不再藏在子菜单中。
- 展开态和收起态 active Project group 使用轻量外框/底色做项目分区，且 group 总高度通过 E2E 测量保持一致。
- Project/Space 右侧展开控制使用实心三角，toggle 命中区扩大到 28px。

## 差距

| 项 | 当前表现 | 目标表现 | 严重度 |
| --- | --- | --- | --- |
| 展开态缩进 | Agent 比 Space 右移 | Space 与 Agent item 内容左对齐 | 高 |
| 分组竖线 | 竖线只从 Agent 区域开始 | 竖线从 Space 前方开始覆盖分组 | 高 |
| Agent 默认底色 | 未标色 Agent 仍有底色 | 默认透明，hover/标色才有底色 | 中 |
| 收起态 rail | 图标尺寸和按钮节奏不一致 | Project/Space/Agent 统一 icon-only 导航节奏，Space 用箭头表示分组 | 高 |
| hover reveal | rail/peek 状态切换突兀 | 宽度、阴影、内容淡入淡出有过渡，pin 决定是否常驻展开 | 中 |
| 添加入口 | 展开态 sidebar 内文字按钮 | Sidebar 顶部 icon button | 中 |
| 右键菜单 | 只能重命名/管理项目 | Space/Agent 可改 label color，外部点击关闭 | 中 |
| Agent 状态 | 右侧圆点/statusline 在 rail 与展开态不一致 | provider icon 外圈状态 ring 在两态一致显示 | 中 |
| Space 底色 | 只有 active Space 或标色 Space 有明显底色 | 未标色 Space 使用主题默认色，标色 Space 使用 label color | 中 |
| Space 竖线 | 分组线颜色不稳定 | Space 分组竖线与默认/标色 Space 颜色一致 | 中 |
| Space 菜单 | sidebar 右键和 Space `...` 菜单的颜色入口位置不一致 | 颜色点位于顶部横线以上，sidebar 右键展示名称输入和 Space 路径操作 | 中 |
| Project 分区 | 不同 Project 之间只靠普通列表间距区分 | active Project 使用轻量 group outline，容纳其 Space/Agent 子树 | 中 |
| 展开控制 | chevron 视觉偏细且命中区小 | 实心三角，Project/Space 右侧按钮命中区扩大 | 中 |
| 菜单复用 | Sidebar Space 右键菜单与 canvas Space `...` 菜单分属不同 owner | 先保持 shell/canvas 分层；完整归档/worktree/二级菜单复用需 Large 方案收口 action owner | 高 |

## 目标文件

- `src/app/renderer/shell/components/Sidebar.tsx`
- `src/app/renderer/shell/components/SidebarToolbar.tsx`
- `src/app/renderer/shell/components/SidebarRail.tsx`
- `src/app/renderer/shell/components/SidebarDisclosureIcon.tsx`
- `src/app/renderer/shell/components/AppHeader.tsx`
- `src/app/renderer/shell/components/ProjectContextMenu.tsx`
- `src/app/renderer/shell/AppShell.tsx`
- `src/app/renderer/styles/workspace-sidebar.css`
- `src/app/renderer/styles/workspace-sidebar.rail.css`
- `src/app/renderer/styles/workspace-agent-item.css`
- `src/app/renderer/styles/base.css`
- `src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceActionMenu.tsx`
- `src/app/renderer/styles/workspace-overlays.spaces.css`

## 验证计划

- Unit/RTL：Sidebar 层级、context target、rail 渲染、右键菜单颜色写入和外部点击关闭。
- E2E：primary sidebar pin/auto reveal、展开/收起 item 与 active project group 高度测量、默认 Space 色与竖线测量、Space label color 设置路径。
- Full gate：`pnpm line-check:staged`、`pnpm pre-commit`。
