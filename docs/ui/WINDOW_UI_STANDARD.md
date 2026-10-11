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
- 由右键菜单、工具栏按钮触发的上下文操作浮层

### 1.1 先选择正确的容器

- **上下文操作浮层（Popover）**：重命名、创建 Worktree、归档、挂载选择、删除确认等短流程，应锚定触发项附近；提交前点击外部或按 Esc 关闭，不遮挡整个应用。
- **局部异步状态**：提交后立即收起浮层；由操作所属的 Space 投射轻量磨砂忙碌状态，只锁定目标 Space，其余 Space 和应用区域保持可操作。
- Space 背景、窗口节点和操作遮罩必须分别排序：背景在节点下方，目标遮罩在节点上方。禁止因某个 Space 忙碌而提升共享 ViewportPortal 的层级；验收须检查其他 Space 窗口的实际绘制效果，仅检查遮罩数量或点击能力不足以发现背景染色。
- **模态窗口（Modal）**：仅用于必须打断全局流程的决策，或无法在小浮层中清晰完成的复杂管理任务。

状态所有权不得放在会因点击外部而卸载的 Popover 内。异步操作必须由更长生命周期的 owner 持有，并保证：同一操作只能完成一次、错误可以重新进入上下文修复、卸载后不提交过期 UI 状态。

Popover 内的 Select、日期选择等 Portal 子层必须登记为同一 transient layer owner：点击子层不得关闭父层，Esc 只关闭最上层。两个完整 surface 之间应使用状态接力，禁止在同一锚点重叠显示。

## 2) 统一视觉 Token

### 2.1 Backdrop
- 深色遮罩 + 轻微模糊
- 推荐：`background: var(--cove-backdrop)` + `backdrop-filter: blur(4px)`

### 2.2 Surface
- 8px 圆角
- 边框/底色/阴影必须跟随主题 token（例如 `--cove-window-surface`、`--cove-surface*`、`--cove-border*`、`--cove-shadow-color-*`）
- 上下文操作浮层使用更紧凑的圆角、内边距与菜单同源的材质，避免呈现为缩小版模态框。

### 2.3 Input
- 6px 圆角
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
- 模态窗口复用 `Dialog`，外观通过 `cove-window-*` 与 `WindowHeading` 统一；不用手写 backdrop
  重新实现焦点、Escape 或遮罩关闭。危险确认初始聚焦取消。
- Settings 使用同一视觉 token（内容面、分隔线、输入焦点），作为主区域页面而非模态窗口；
  页面导航、画布保留与焦点契约见 `docs/ui/README.md`。

### 4.3 菜单与文件窗口

- 菜单统一使用 `ViewportMenuSurface` 与 `--cove-menu-*`，8px 外框、4px 行圆角、30px
  桌面行高；触屏操作至少 44px。图标、文字、快捷键或子菜单箭头固定分列。
- Space 使用四角 `Scan` 图标；具体 Agent 使用提供方品牌图标。颜色选择使用色板，已有
  选择用勾选和 `aria-pressed` 表达；危险操作独立分组。
- 窄屏菜单在底部显示，实际子菜单通过 `isSubmenu` 表达父子关系，`onBack` 只表达返回动作。
  内联编辑可以返回，但仍拥有根菜单的画布输入锁。移动菜单焦点由 `Dialog` 管理，桌面菜单
  复用 `useMenuFocus`；自动定位不能重抓原触发焦点。方向键只滚动菜单内部。
- 多个模态窗口使用同一个 inert lease owner；最后一个持有者释放后才恢复原始输入状态。
- Explorer 保留画布窗口身份与拖动/缩放/预览语义，使用 8px 边框、轻量标题与独立工具栏。
  文件选择使用主题 accent，文件树与搜索在窄宽度换行、滚动，不能挤出窗口。

参考：W3C APG [Menu](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/) 与
[Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)。
菜单导航和模态焦点采用其规则；包含表单或色板的操作面不伪装成纯 ARIA menu。

## 5) 画布窗口与 Space 折叠

- 折叠展示由 Renderer 的 view store 持有，按 workspace 缓存；折叠 ID 通过既有 app-state
  持久化 owner 写入 workspace 数据，并在启动读取时恢复到 view store。它不是 PTY 或 Agent
  的运行状态。Sidebar 隐藏、Sidebar 分组展开和画布折叠各自独立。
- 所有节点通过同一个 presentation wrapper 显示桌面图标与标题，单击或 Enter/Space 展开，
  拖动和 Shift 选择不能误触展开。所有图标统一使用 112×96 的展示与碰撞尺寸，Agent
  不显示最新消息预览，也不为折叠状态读取或轮询消息；运行状态保留点阵及无障碍提示，
  复制最新消息等显式操作继续使用原有独立接口。
- Runtime subtree 必须保持挂载并保留完整 width/height。收起只把它设为 inert 与
  visibility:hidden、脱离可见布局；禁止 React Flow hidden、条件卸载或 display:none
  导致 PTY 测量归零。WebContentsView 只隐藏 host bounds，不能销毁 session 或改变 viewport。
- React Flow 的 compact frame、像素流光和命中区域使用展示尺寸；持久化 node data 中的
  width/height 始终是展开尺寸。Space 本身没有折叠状态；旧版 Space 折叠记录在打开项目时
  转为后代节点的 compact 偏好并清除，保留布局与运行时。
- React Flow 的 width/height 与 initialWidth/initialHeight 同属展示投影；旧 measured
  与展示尺寸不符时必须丢弃，避免受控拖动重建节点时选中框闪回展开尺寸。
- 操作选区由画布本地 UI 状态持有，React Flow 的 select/remove 变更在同一批次同步
  选中 ID 与节点投影。禁止再从 onSelectionChange 的延后通知回写受控节点选区，
  否则拖动切换选中窗口时，旧通知可能使选区来回振荡并触发 React 循环更新。
- 「画布 → 窗口布局 → 窗口展开方式」默认原地展开并沿用 resize 推开布局；也可
  选择按创建寻位流程移到空位展开。直接点击和导航均经同一展开 owner，
  用可见几何规划碰撞，再只提交位置与 Space 边框，不改变运行时尺寸或重启会话。
  寻位优先保留所在 Space，拥挤时扩展其边界。
- Space 标题、分支和操作位于边框线上，标题与操作通过统一测量生成边框断线。
  保留实色加粗四角，不增加内置标题栏的高度补偿，展示与拖动使用同一边框矩形。
- 折叠图标统一使用无连续描边的柔和底座与四角渐隐像素。四角沿用节点主题渐变或标记色，
  品牌图标和文字保持清晰；等待/错误/终端连接只改变少量提示像素，不覆盖身份色。
  工作状态驱动四角点阵流动；终端仅在收到真实 PTY 输出时短暂流动，
  空闲时保留静态连接提示，不将输出当作命令忙碌状态。动效跟随现有工作点阵开关与
  reduced-motion，折叠图标不再叠加完整窗口的两侧流光。
- Space 只提供 FoldVertical「收起并整理窗口」动作：成员变成真实 compact 节点，整理后
  收紧 Space 右侧与底边，左上标题锚点保持稳定。Space 仍可正常拖动和调整大小。
- 手动调整 Space 大小时，实时预览与最终提交均按节点的可见尺寸计算包围边界；
  compact 节点不占用其展开尺寸，也不要求默认终端的最小空间。混合布局仍完整包住
  展开的节点与子 Space。最小宽度和自动整理共用单图标的空间预算；窄框标题截断、
  文件按钮改为纯图标，保留更多、分支和收起操作，不能用固定标题宽度撑大紧凑 Space。
- “收起并整理”沿用显式共享布局写入；其他客户端接收位置变化，但保留自己的折叠偏好。
  更多菜单中的「恢复收起前布局」是会话内撤销：只在成员、归属、折叠偏好及几何未被
  后续独立修改时可用。整组平移可恢复相对布局；重复无变化的整理不覆盖首次快照。
- 收起/展开采用 Web Animations 展示过渡：正文以原尺寸淡出并裁切，图标与标题移动到
  compact 位置，不拉伸文字。单窗口收起约 280ms，展开约 360ms；整理从约 210ms 开始
  衔接移位，Space 边框从 350ms 跟随，总计约 620ms，无反弹。
- 图标测量真实 glyph，标题测量对应的可见文字；动画中的标题使用固定坐标空间，保持
  占位与省略规则，并插值字体、行高和颜色。最后一帧须与静态两端的文字/图标几何一致，
  不能因 Flex 居中、外层标题容器或取消临时样式产生跳变。没有对应标题的窗口只淡入/淡出。
- 真实 header 图标与标题在过渡期间只用临时 CSS 标记隐藏，移动由 compact 代理承担；
  不给真实文字添加恒定透明度的 Web Animation，避免与 runtime 的继承可见性切换冲突。
  完成、反转和拖动中断都须同步移除标记，展开后标题的 visibility 与 opacity 必须恢复。
- 动画只有临时 DOM 展示写权；不得把中间帧提交给 React Flow、PTY 或共享布局。中断从
  当前帧接续，拖动、卸载、切换项目与 reduced-motion 清理动画；最终状态由布局 owner
  持有。浏览器原生 host 按动画边界裁切，其 viewport 保持完整尺寸。
- Disclosure 使用带 aria-expanded 的按钮。隐藏 runtime 不可 Tab 进入；减少动态效果
  关闭收起动效。关闭仍走原窗口的 owner，文档未保存确认不得被紧凑外壳绕过。
- 折叠节点的右键与键盘上下文菜单复用展开节点的画布菜单，打开菜单不展开节点。
  底部「关闭」调用该节点仍挂载的 runtime 关闭入口，保留未保存文档等既有保护。

参考：[React Flow Node](https://reactflow.dev/api-reference/types/node)、
[WAI-ARIA Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)、
[HTML inert](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert)。
动效参考 [Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)
与 [Animation.cancel](https://developer.mozilla.org/en-US/docs/Web/API/Animation/cancel)：取消时
处理 finished promise 的拒绝，不使用 commitStyles 将临时帧变成运行时尺寸。

## 6) 新窗口开发 Checklist

- 是否使用统一 backdrop / surface token
- 是否使用统一按钮语义（ghost/secondary/primary/danger）
- 是否提供稳定 `data-testid`
- 是否保证键盘与关闭行为一致（Esc / blur / confirm）
- 是否根据任务范围正确选择 Popover、局部忙碌状态或 Modal
- 是否让异步 owner 独立于浮层生命周期，并将忙碌状态限制在目标 Space
- 是否验证亮色、暗色与减少动态效果模式
