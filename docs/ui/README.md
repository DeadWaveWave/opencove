# UI Standard

本规范定义 OpenCove 的 **统一 UI 语言** 与 **实现约束**，用于保证：

- Light / Dark / System 三种主题下都可读、克制、层级清晰；
- 组件风格一致（像同一个“系统”）；
- 开发和改动可持续（可复用、可测试、可演进）。

命名约定：
- 产品/对外接口统一使用 `OpenCove` / `opencove`。
- UI 设计系统与样式命名空间保留 `cove` 前缀（例如 `--cove-*`、`data-cove-*`、`.cove-window`），作为稳定的内部约定，不随产品命名调整而变更。

> 关联专项规范：
> - Window：`docs/ui/WINDOW_UI_STANDARD.md`
> - Task：`docs/ui/TASK_UI_STANDARD.md`
> - Viewport：`docs/ui/VIEWPORT_NAVIGATION_STANDARD.md`
- Spatial Pixel：`docs/ui/SPATIAL_PIXEL_THEME.md`

---

## 1) 设计原则（Apple-level 基线）

1. **层级优先**：标题/主信息/次信息/辅助信息必须一眼可分（字体、颜色、间距共同实现）。
2. **克制的对比**：Light 模式避免“白底+纯黑+强边框”；Dark 模式避免“大面积纯黑+纯白字”导致刺眼。
3. **少即是多**：阴影、描边、渐变只在“解释结构/层级”时使用；不是装饰。
4. **一致的交互反馈**：hover/focus/active/disabled 的反馈强度在全局一致，且必须可预测。
5. **可访问性**：
   - 文字与背景保持足够对比；
   - `:focus-visible` 必须清晰（键盘可用）；
   - 不用颜色作为唯一信息通道（错误/警告配合图标/文案/布局）。

---

## 2) 主题系统（必须遵循）

### 2.1 单一真相

- 持久化设置：`settings.uiTheme: UiTheme`，取值见 `src/contexts/settings/domain/uiSettings.ts`（内置主题及 `plugin:<plugin-id>:<theme-id>` 扩展标识）。
- Renderer 主题入口（**两个互补的 hook**，共同构成命名主题扩展点）：
  - `<html data-cove-theme="light|dark">` —— 解析后的基础配色，所有 `--cove-*` token 默认基于此切换；`system` 会跟随 `prefers-color-scheme` 计算出 light/dark。
  - `<html data-cove-theme-id="<UiTheme>">` —— 当前选中的命名主题 id。命名主题通过 `:root[data-cove-theme-id='<id>']` 选择器覆盖 `--cove-*` token，与基础配色解耦。内置主题分为两个主题族：Cove（`dark`、`light`、`system`，由生成器产出，默认 `dark`）与 Pixel（`pixel`、`pixel-light`，手写）；插件可以通过声明式 `contributes.themes` 接入颜色、材质、尺寸、字体、动效与受作用域约束的组件样式；详见 [插件主题契约](../plugins/THEMES.md)。
  - `<html data-cove-family="cove|pixel">` —— 生效的基础主题所属的主题族。插件主题取 `extends` 所属的主题族，未声明时为同明暗的 Cove。生成的主题族 token（2.4）只在 `data-cove-family` 匹配时生效。
- 添加一个新内置主题的步骤：① 在 `UI_THEMES` 中登记 id；② 在 `UI_THEME_DESCRIPTORS` 声明 `family`、`baseScheme`、`terminalScheme` 与 `i18nKey`；③ 生成的主题族由 `src/shared/design` 产出（2.4）；手写主题提供 `styles/themes/<id>.css`，以 `:root[data-cove-theme-base='<id>']` 选择器覆盖需要的 `--cove-*` token。
- 退役的内置主题在读取设置时迁移（`RETIRED_UI_THEMES`）：`ember` → `dark`，`ember-light` → `light`；插件 `extends` 的同名旧值按同样规则解析。没有有效主题的设置使用当前默认值：Cove 深色，像素效果全部开启。已保存的 Pixel 选择保持不变。
- `baseScheme` 与 `terminalScheme` 是两个独立语义：前者决定应用 shell 的 light/dark token，后者决定 xterm 与内嵌 TUI 的配色协议。内置主题的 `terminalScheme` 目前都与 `baseScheme` 一致；终端设置可以在浅色 shell 下把终端固定为深色。
- 每个 xterm 实例必须通过一个 revisioned `TerminalAppearanceSnapshot` 应用主题。快速连续切换采用 final-wins：每帧至多应用/刷新一次最新 snapshot；xterm theme、OpenCode OSC/CSI 与 Find decoration 必须消费同一份 **applied** snapshot，不能各自读取时序不同的 desired theme。
- 同一 xterm 在 placeholder handoff/DOM remount 后必须从 live `containerRef` 定位主题 scope，不能
  继续写 detached DOM；一次瞬态 render mutation 失败只能 bounded retry，且成功 refresh 前不得
  发布新的 applied revision。
- 必须设置 `color-scheme`，让原生控件在主题下正确渲染。

### 2.2 Token 优先（禁止硬编码颜色）

- 全局 Token 定义在：`src/app/renderer/styles/base.css`
  - `:root` 作为默认（暗色基线）
  - `:root[data-cove-theme='light']` 覆盖浅色
- 组件样式必须使用 `var(--cove-*)` Token：
  - ✅ `color: var(--cove-text-muted)`
  - ✅ `border-color: var(--cove-border-subtle)`
  - ❌ `color: #fff`
  - ❌ `background: rgba(255,255,255,0.08)`

> 例外：极少数与业务语义绑定、且跨主题一致的品牌色/状态色允许硬编码，但必须在规范评审中说明原因；优先新增 token。

- 尺度同样走 token：字号与行高 `--cove-font-size-*` / `--cove-line-height-*`（display 24/32、
  title 18/26、emphasis 15/22、body 13/20、secondary 12/16、caption 11/16，随用户字号缩放），
  字重 400/500/600，间距 `--cove-spacing-*`（4px 网格），圆角 `--cove-radius-*`，页面级层级 `--cove-z-*`。
- `pnpm ui:style-check` 按文件统计写死的字号、圆角、间距（≥ 4px）和页面级 z-index（≥ 10），
  计数只能下降，基线是 `scripts/ui-style-ratchet.json`。新增写死的值会失败；减少后运行
  `pnpm ui:style-ratchet` 锁定新基线。基线由该命令生成，不手改。

### 2.3 CSS 写法约定

- Token/主题差异 **集中在 `base.css`**，组件 CSS 不写分支主题选择器，除非确有必要。
- 避免在 React 里用 inline `style` 写颜色；布局/定位可以，但能 class 化就 class 化。

### 2.4 生成的主题族

- 生成器在 `src/shared/design/`：明暗、底色色相与彩度、强调色、对比度四个输入生成 12 阶色阶、
  窗口类别色族、标记与状态色、终端 ANSI 调色板和玻璃参数。正文与次要文字不低于 4.5:1、
  图形不低于 3:1（含玻璃叠在像素背景上的最坏情况），由 `tests/unit/shared/design/` 断言。
- `styles/themes/generated/<family>.css` 由 `pnpm design:tokens` 生成，禁止手改；单测比对生成结果，
  文件过期时 CI 失败。改生成器后重新运行该命令并提交生成文件。
- 生成的 token 作用在 `:root[data-cove-family='<id>'][data-cove-theme='dark|light']` 上，并完整映射
  插件契约的全部 v1 公共 token（`PLUGIN_THEME_TOKENS`），已安装的插件主题继续可用。主题 owner
  按生效基础主题所属的主题族设置 `data-cove-family`（见 2.1）；Pixel 是手写主题族，没有生成样式表。
- `base.css` 的 `:root` 与浅色块里写着字面颜色的 token，主题族必须全部替换（`themeHostTokens.ts`），
  否则标准主题的旧色会透出来；单测逐个检查。给 `base.css` 新增字面颜色 token 时，同步在生成器里映射。
  只有主题预览色块（`--cove-theme-preview-*`）与遮罩色（`--cove-mask-opaque`）不随主题族变化。
- 深色终端窗口会重新声明一组 token（`terminal-node.theme-opencode.css`）。主题族为它生成一份已解析的
  深色调色板（`terminalScopeTokens`），浅色外壳里被强制为深色的终端也使用它；单测检查这组 token 全部被覆盖。
- 生成器只把依赖运行时 token 的混色（如玻璃透明度）写成 `color-mix()`，常量混色直接输出计算结果。

---

## 3) 组件与层级（统一规则）

### 3.1 Surface / Border / Shadow

- Surface 必须有“可解释层级”：背景（app） < 面板/窗口（surface） < 强化面板（surface-strong）
- Border 默认使用 `--cove-border-subtle`，hover/active 才提高对比。
- Shadow 必须服务于层级，不得用极黑/极硬的阴影压住内容。

### 3.2 文本系统

- 主文字：`--cove-text`
- 次文字：`--cove-text-muted`
- 辅助/弱化：`--cove-text-faint`
- 禁止在 Light 模式出现“白字”（除非在深色 surface 上，且由 token 驱动）。

### 3.3 交互状态

- `hover`：轻量，优先用 `--cove-surface-hover`
- `focus-visible`：必须可见且不刺眼（建议 1px ring + 轻外发光）
- `disabled`：降低对比/透明度，但仍可读、可理解

---

## 4) Canvas 特化约束

### 4.1 MiniMap（可读 + 不抢戏）

- 默认态（idle）必须 **半透明**：使用 `--cove-canvas-minimap-opacity-idle`
- hover / focus-within 时提高可读性：使用 `--cove-canvas-minimap-opacity-hover`
- 节点颜色、mask、描边必须 token 化，避免 Light 模式“看不清/刺眼”。

实现锚点：
- 样式：`src/app/renderer/styles/workspace-canvas.css`
- Token：`src/app/renderer/styles/base.css`

### 4.2 Terminal Node

- Terminal body 是 PTY rows/cols 的唯一测量区域。Header、error 与 node frame 可以影响可用
  区域，但局部浮层不得偷偷成为 geometry writer。
- Find 必须 absolute overlay 在 `.terminal-node__body` 内；打开、关闭、查询与主题刷新均不得
  改变 xterm container 高度或触发 PTY resize。
- Renderer 只提交 side-effect-free 测量结果；Worker runtime ACK 后还必须复核 presentation
  identity 与 authority，Renderer 才应用返回的 canonical geometry。Attach/detach/control/write/
  resize 在 Worker 侧共享同一 session FIFO，Find 不参与该队列且不是 geometry writer。
- Transport 断线后必须把缓存 authority epoch 清为 unknown；新 `attached`/`control_changed`
  到达前不得把旧连接 epoch 带入 resize。
- 主题刷新应保留 terminal DOM、selection、viewport 与 Find state；禁止用 remount 或虚假
  resize/SIGWINCH 修复调色板残影。
- Terminal appearance 只有一个 final-wins apply owner；新 revision 仅在实际 apply/refresh 完成后
  成为 applied state。任何真实 presentation change 都必须标记 durable dirty；退出前需 drain
  完整 session FIFO 后再做最终 recovery flush。

---

## 5) Settings（可读性硬约束）

- 所有文本/边框/输入框必须基于 token；尤其避免 `#fff` / `#ccc` 这类暗色假设。
- provider/card 标题与错误信息必须可读（Light/Dark 都可读）。
- 页面 registry 是 Settings 信息架构的单一来源：规范页面 id、别名、导航分组、标题/说明键和滚动目标；侧栏、动态页头、搜索结果与窄窗选择器必须共同消费它，禁止各自维护映射。
- 桌面主导航按通用、外观、画布、Agent、终端、快捷操作、连接组织，高级固定在底部。范围选择器区分应用与项目；项目范围只展示项目拥有的字段，不暗示全局偏好支持项目覆盖。旧页面 id 保留为规范页面与锚点别名。
- 页头必须随当前页面显示对应标题和简短说明，标题与说明来自 registry，不使用泛化的固定标题替代页面上下文。
- Settings 内容层级固定为 `Page H2 → Group H3 →（必要时）Module H4 → Row`；Group 标题与说明必须位于内容面之外，不能用 `<strong>` 冒充结构标题。
- 普通 Group 和 Module 使用透明内容面、留白与细分隔线，避免嵌套卡片。设置行左侧是名称与必要说明，右侧控件按内容宽度排列；窄内容区换行，开关仍与标签同排。Agent 提供方使用列表进入详情，返回恢复列表焦点和滚动；安装状态与错误保持可见。
- Agent 列表使用紧凑内容行和独立拖动手柄，鼠标与键盘排序共用同一提交入口。首个可选 Agent 即默认 Agent，顺序与默认值必须原子更新；旧设置以已有默认值对齐顺序，隐藏提供方保留兼容数据。纵向摘要不得继承横向布局的 `flex-basis`，行高由文字内容决定。
- 连接设置按本机运行、浏览器访问、远程连接组织。密码与局域网访问属于浏览器访问；远程机器属于远程连接。去除实验性入口门禁不等于启用网络监听，打开设置不得改变 Worker 模式、启动进程或修改 Web 访问权限。
- 远程机器列表只保留一个添加入口，空列表不重复渲染操作卡片；打开 Web UI 的行只在运行时确认可访问时出现，刷新与错误反馈始终可达。终端字体预览使用独立的静态窗口与终端主题 token，字号只影响内容，不创建 PTY。
- 单项页面不为了形式统一强加空洞层级；条件内容不得产生空 Group；重排时必须保留搜索/深链依赖的 `settings-section-*` anchor。
- 窄窗口使用顶部范围与页面选择器、单列内容；应用页面选择器不混入项目。搜索在页头，所有导航入口（含外部 props）共用清理路径，避免旧 provider 搜索请求在重挂后重放。搜索先挂载详情、展开原生 details，再定位并聚焦目标。
- Settings 是主内容区的命名页面，铺满画布所在区域，保留应用 Header 与 Sidebar 导航。
  不使用 Dialog、遮罩、aria-modal 或焦点陷阱；顶部画布入口与设置关闭按钮可返回工作区。
  点击 Sidebar 项目、Space、Agent 或命令中心中的画布目的地也应退出设置，再执行导航。
- 设置开关仍由 shell 的单一状态持有，配置持久化与页面内导航分别沿用原 owner。
  画布保持挂载和原尺寸；覆盖期间通过共享 inert lease 禁止输入并从辅助技术隐藏，
  不得使用 display:none、重新创建 PTY 或更改 viewport。缩放预览期间只恢复画布可见性。
- 桌面打开设置聚焦搜索，移动端聚焦关闭按钮以避免唤起软键盘；显式关闭返回导航入口，
  Sidebar 导航保留目标焦点。弹层交接取消旧 Dialog 的延迟焦点恢复，嵌套菜单/弹窗先处理 Escape。
  所有交互保留清晰的 :focus-visible，响应式布局根据设置内容区域宽度切换。
- 搜索支持方向键选择结果、`Enter` 跳转和 `Escape` 退出；查询非空时首次 `Escape` 先清空查询，再次 `Escape` 关闭面板。关闭按钮必须有可访问名称。

- 外观点阵预览必须消费现有画布绘制、mask、assembly、burst 与调度器。它使用独立 DOM 类和局部时钟，不创建真实 React Flow 节点、不启动 PTY、不发运行时创建/关闭事件；离屏、减少动态效果与关闭开关均需停止不必要的循环。

- 默认主题为 Pixel；显式保存的其他主题与各项像素开关不因升级或切换主题被覆盖。
  Agent 两侧流光只消费 `resolveAgentPresentation` 的 Working 状态（含终端中的 Agent）；
  PTY 输出不能作为 Working 的判据，恢复中或降级观测不显示流光。流光复用画布级调度器、
  主题色与可见窗口投影，不改变节点布局、焦点或运行状态。独立开关关闭、非 Working、
  离屏及减少动态效果时停止；无动态内容时不维持动画循环。

实现锚点：
- 面板样式：`src/app/renderer/styles/settings-panel.css`
- 分组原语：`src/contexts/settings/presentation/renderer/settingsPanel/SettingsGroup.tsx`
- 主题选择：`src/contexts/settings/presentation/renderer/settingsPanel/AppearanceSection.tsx`

参考原则：[VS Code Settings editor](https://code.visualstudio.com/docs/configure/settings)
（主区域设置页、搜索与作用域）、[React 状态保留](https://react.dev/learn/preserving-and-resetting-state)
（保持工作画布树位置）、[HTML inert](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert)
（不可见画布的交互隔离）。分组沿用 Apple HIG Settings、Windows App Settings 与 GNOME HIG Boxed Lists。

---

## 6) 测试与验收（UI 变更必须做）

### Sidebar 导航契约

- 桌面 Sidebar 由固定宽度项目栏与单个项目导航组成。收起仅保留项目图标，不把 Space / Agent
  压缩成图标树；展开导航显示 Space 与各自的 Agent，不增加独立的“项目画布”条目。
- 设置入口固定在项目栏底部，不随项目列表滚动；展开、收起与移动抽屉共用同一入口。
  移动抽屉交接到设置后关闭，设置退出返回导航按钮，不恢复已卸载的抽屉按钮焦点。
- 悬停项目只产生临时导航预览，不写 active workspace、active Space、viewport 或执行目录。
  点击项目沿用该项目保存的画布视野；点击 Space / Agent 才发送定位意图。
- 固定偏好、分组折叠、条目隐藏与筛选由设置 owner 保存；悬停、拖动锁定与移动抽屉属于
  renderer 临时状态。Sidebar 的可见性独立于画布中 Space / 窗口的收起状态。
  收起或打开覆盖式导航不能写入 viewport，也不能重建终端实例。
- 窄屏隐藏整个项目栏，导航按钮打开覆盖式抽屉，右侧至少保留 48px 画布关闭区域。
  抽屉拦截画布输入、锁定焦点，Escape / 遮罩关闭后恢复触发按钮焦点。项目切换保留抽屉；
  Space / Agent 导航关闭抽屉。移动 Agent 导航只定位，不请求输入焦点；桌面导航可聚焦输入。
- Remote 标记只来自项目唯一 Mount 的远端 endpoint，不来自浏览器运行模式。多目录或混合
  Mount 不显示整项目 remote；位置详情在标记或项目目录管理中查看，不常驻项目路径。
- Space 使用四角框图标，折叠控制置于行右侧。标记通过淡标题底色与贯穿分组的侧线展示，
  Agent 自有标记通过短侧线与淡底色展示。Agent 不继承 Space 标记，品牌图标保持原样；
  Space / Agent 导航不显示选中描边或定位箭头；导航意图、运行状态符号及
  标签色是三个独立语义。项目角标仅汇总待用户处理的 Agent 数量。
- 项目、Space、同组 Agent 的手动排序保留，不因输出活动自动重排。触控行与操作至少 44px。
- 项目标题处的按钮循环切换「专注 / 正常 / 全部」；默认正常，仅显示未隐藏条目。专注
  显示置顶 Space 及其未隐藏 Agent；只置顶 Agent 时保留其所属 Space，不显示同组其他
  未置顶 Agent。全部包含隐藏条目。切换不修改运行状态、排序或分组折叠偏好；待处理状态
  只更新指示，不自动取消隐藏或展开条目。
- 普通 Space / Agent 的更多操作仅在悬停、键盘焦点或触屏模式显示。被筛选显示的隐藏条目
  使用弱化文字与常驻隐藏图标，图标直接恢复。已置顶条目在悬停时显示实心置顶按钮，
  点击直接取消置顶。
  隐藏 Space 对子 Agent 有继承效力：先恢复父 Space，不能通过子项绕过；恢复父 Space
  保留每个 Agent 自己的隐藏偏好。偏好以项目与条目 ID 作用域保存，不由节点输出重写。

参考原则：VS Code Sidebar 的稳定项目导航与分组动作，GNOME Sidebar 的清晰导航层级。
此处沿用应用已有单目录执行模型，不引入多 repo 的隐式目录选择。

### 搜索与快捷控制契约

- 命令中心负责命令、项目和 Space 导航；项目搜索负责当前项目的 Space、任务与笔记。
  入口与显示方式可变化，筛选、定位和设置写入仍由原有 owner 负责。
- 命令中心与项目搜索共用 Sidebar 的项目图标、Space 四角框和标签侧线语义。
  项目目录保留为搜索关键字，不作为常驻副标题；remote 只表示唯一 Mount 的远端 endpoint。
- 桌面项目搜索是可调整宽度的非模态侧栏，控制中心是锚定按钮的非模态 Popover；
  窄屏分别使用近全屏搜索 Dialog 与底部控制 Dialog，触控目标至少 44px。
- 命令中心遵循 editable combobox 模式：输入框保留 DOM focus，方向键通过
  `aria-activedescendant` 选择结果，Enter 执行；IME 合成过程不执行导航或命令。
  键盘滚动只作用于结果列表，不得移动外层画布。
- 模态界面复用共享 Dialog 的 inert、Tab 约束与焦点恢复。手机打开搜索先聚焦关闭控件，
  避免自动唤起软键盘；定位后关闭搜索，返回导航控件，不聚焦终端输入。
  弹层交接后旧界面不得通过延迟恢复抢走新界面的焦点。
- 控制中心开关保留标签与真实 checked 状态，不重复显示开/关状态文字；
  所有主题来自既有主题 registry，选项使用轻量预览与单选语义。控制中心与设置页共用插件主题可用性规则，
  展示已启用且就绪的主题名称与来源；禁用或卸载时隐藏选项，但不改写用户保存的主题选择。

参考：WAI-ARIA APG Dialog (Modal) 与 Combobox 的焦点约束、返回目标与输入焦点模型。

### 6.1 最低验收

- Light / Dark 下主要页面可读（至少：Sidebar / Canvas / Settings / Node chrome）
- MiniMap idle/hover 层级正确（默认不抢眼，hover 可读）
- 命名主题分别验收 app shell 与 `terminalScheme`；浅色 shell 下把终端固定为深色时，终端必须使用深色语义与该主题族的深色调色板。
- Terminal Find 打开前后 terminal body 尺寸、rows/cols 与 PTY geometry 保持不变。
- Terminal node 扩张与收缩后，Renderer accepted rows/cols、Worker presentation snapshot 与
  POSIX PTY `stty size` 必须三方一致，且收缩后的 rows 严格下降。

### 6.2 E2E 要求（有 UI 回归风险时必须）

- Playwright 用例必须：
  - 对关键样式做 **可解释** 的断言（例如 opacity / color-scheme / dataset）；
  - 附带截图（`testInfo.attach`）。

### 6.3 提交前门禁（与 CI 对齐）

- `git add -A`
- `pnpm line-check:staged`
- `pnpm pre-commit`

---

## 7) 参考实现（可复用入口）

- Theme 应用：`src/app/renderer/shell/hooks/useApplyUiTheme.ts`
- Theme Token：`src/app/renderer/styles/base.css`
- Terminal 主题映射：`src/contexts/workspace/presentation/renderer/components/terminalNode/theme.ts`
- Terminal geometry 权威 E2E：`tests/e2e/workspace-canvas.terminal-resize-shrink.spec.ts`
- Terminal theme/Find E2E：`tests/e2e/workspace-canvas.terminal-theme.spec.ts`
- Multi-client authority/FIFO：`tests/unit/app/ptyStreamHub.attach.authority.spec.ts`、
  `tests/unit/app/ptyStreamHub.resize.authority.spec.ts`、`tests/unit/app/BrowserPtyClient.spec.ts`
