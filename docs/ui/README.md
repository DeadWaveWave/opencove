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
> - Spatial Pixel：`docs/ui/SPATIAL_PIXEL_THEME.md`
> - Canvas Signals：`docs/ui/CANVAS_SIGNALS.md`

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
  - `<html data-cove-theme-id="<UiTheme>">` —— 当前选中的命名主题 id。命名主题通过 `:root[data-cove-theme-id='<id>']` 选择器覆盖 `--cove-*` token，与基础配色解耦。内置主题只有 Cove 的三个外观：`dark`、`light`、`system`，由生成器产出，默认 `dark`。像素风格是 Cove 本身的主调（像素墙、窗口外框、像素图标），不再是单独的主题；插件可以通过声明式 `contributes.themes` 接入颜色、材质、尺寸、字体、动效与受作用域约束的组件样式；详见 [插件主题契约](../plugins/THEMES.md)。
  - `<html data-cove-family="cove">` —— 生效的主题族，目前总是 `cove`，插件主题也一样（它们只能 `extends` Cove 的 `dark` 或 `light`）。生成的主题族 token（2.4）只在 `data-cove-family` 匹配时生效。
- 添加一个新内置主题的步骤：① 在 `UI_THEMES` 中登记 id；② 在 `UI_THEME_DESCRIPTORS` 声明 `baseScheme`、`terminalScheme` 与 `i18nKey`；③ 它的配色由 `src/shared/design` 生成（2.4），不手写主题样式表。
- 退役的内置主题在读取设置时迁移（`RETIRED_UI_THEMES`）：`ember`、`pixel` → `dark`，`ember-light`、`pixel-light` → `light`；插件 `extends` 的同名旧值按同样规则解析。没有有效主题的设置使用当前默认值：Cove 深色，像素效果全部开启。保存过 Pixel 的设置迁移时保留像素效果全部开启（`pixelEffectSettings.ts` 读迁移前的原值判断）。
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
- 同一命令也统计被共享组件取代的原生标记（`scripts/ui-markup-ratchet.json`，同样只减不增）：
  原生元素上的 `title` 属性改用 `Tooltip`（`iframe` 的 `title` 是可访问名称，不计入）；
  共享组件目录之外的原生 `<button>` 改用 `Button`、`IconButton` 或 `MenuItem`；
  原生 checkbox 改用 `Toggle`、`Checkbox` 或 `Chip`。
  每条规则随它的替代组件一起加入。

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
  设置 `data-cove-family`（见 2.1）。
- `base.css` 的 `:root` 与浅色块里写着字面颜色的 token，主题族必须全部替换（`themeHostTokens.ts`），
  否则标准主题的旧色会透出来；单测逐个检查。给 `base.css` 新增字面颜色 token 时，同步在生成器里映射。
  只有主题预览色块（`--cove-theme-preview-*`）与遮罩色（`--cove-mask-opaque`）不随主题族变化。
- 深色终端窗口会重新声明一组 token（`terminal-node.theme-opencode.css`）。主题族为它生成一份已解析的
  深色调色板（`terminalScopeTokens`），浅色外壳里被强制为深色的终端也使用它；单测检查这组 token 全部被覆盖。
- 生成器只把依赖运行时 token 的混色（如玻璃透明度）写成 `color-mix()`，常量混色直接输出计算结果。
- 插件主题可以只声明生成器输入（主题 API v2 的 `palette`，见 [插件主题契约](../plugins/THEMES.md)）：
  `useApplyUiTheme` 在运行时用同一条管线（`renderPaletteStylesheet`）生成样式，作用域是
  `:root[data-cove-family='cove'][data-cove-theme-id="<id>"]`，放在 `opencove` 层里，所以比主题族更具体，
  又仍然低于作者样式表和 manifest token。`tests/unit/shared/design/themePalette.spec.ts` 在 manifest
  允许的输入范围内逐一断言对比度规则。

---

## 3) 组件与层级（统一规则）

### 3.1 Surface / Border / Shadow

- Surface 必须有“可解释层级”：背景（app） < 面板/窗口（surface） < 强化面板（surface-strong）
- Border 默认使用 `--cove-border-subtle`，hover/active 才提高对比。
- Shadow 必须服务于层级，不得用极黑/极硬的阴影压住内容。
- 材质只走 `Surface`（`components/ui/Surface.tsx`）或 `surfaceProps()`：实色（对话框与长时间阅读）、
  玻璃（画布上的窗口，预合成、不模糊）、亚克力（菜单、浮层等短暂出现的表面：着色、真模糊、颗粒）。
  使用方只管边框、圆角和阴影，背景与 `backdrop-filter` 归材质。不要再手写 `backdrop-filter`。
- 窗口内容放在阅读底板上（`window-plate.css`）：`window` 里的 `window-body` 左右和底部内缩 6px、紧贴标题栏。
  生成的主题族里底板（`--cove-reading-plate`）是实色，墙面不会透进正在阅读的内容，对比度矩阵检查的就是
  这些颜色。它不是纯黑也不是纯白，而是带一点色相的淡色（类似 Material 3 的着色表面），并且按窗口类别着色：
  每个类别一块（`KIND_PLATE`，类别色相、固定的明度和彩度，令牌 `--cove-kind-<类别>-plate`），窗口把类别传给
  `WindowPlate`；中性窗口和关闭「窗口类别颜色」时用主题自己的底板（`PLATE`，强调色色相，`roles.plate`，
  即 `--cove-kind-neutral-plate`）。浅色下贴近白色时 sRGB 色域放不下多少彩度，各色相取它能放下的。
  终端的颜色就是它类别的底板（`terminal-node.css`：终端用 shell，Agent 窗口用 AI），声明在窗口上，xterm 通过
  复制窗口 class 的取色探针读到同一个颜色，所以 Agent 窗口带 `terminal-node--agent`；切换类别颜色时终端
  重新取色，不必等主题变化。手写主题回退到自己的窗口底色和细边框。内容自身不要再铺一层不透明底色，终端
  除外（透明终端在第 2.3 步）。
- 实色底板、透明外框、四边无缝（生成的主题族）：底板是窗口下面的一整层（`WindowPlate`，放在 `window-body`
  前面），不是 body 的背景，body 本身透明。它用一张遮罩融进玻璃外框：横向和纵向各一条 smoothstep，从窗口
  边缘的全透明到向内 `--cove-reading-plate-feather`（16px，越过 6px 边距一直到内容自己的内边距）处的实色，
  两条相乘，所以拐角也连续；顶部从标题栏上方 1/5 处开始淡入，到 body 顶边为实色。内容自己铺满不透明底色的
  窗口（不透明终端、降低透明度、网页）只在 6px 边距内过渡。不要把底板拆成几块背景拼起来：拼块在画布的
  非整数缩放下会出现接缝。类别色调在标题栏底边之前淡出。标题栏下面的一切都在底板上，比如任务窗口的
  优先级行、Agent 会话和底部状态栏。
  `workspace-canvas.window-seam.spec.ts` 逐行比较标题栏底边上下的像素；`workspace-canvas.window-plate.spec.ts`
  把墙面换成两种颜色，确认底板颜色不变，扫描各边确认过渡没有硬边且足够宽，并在 0.3 到 2 倍的缩放下检查
  过渡区里没有接缝。`workspace-canvas.window-plate-kinds.spec.ts` 确认终端、Agent、任务和便签各自读在
  自己类别的底板上，关闭类别颜色后都回到主题底板。
- 亚克力的底色由生成器给出（`--cove-acrylic-surface`），对比度矩阵检查它压在纯黑、纯白和像素墙上的
  最坏情况；手写主题沿用自己的 `--cove-menu-surface`。
- 玻璃受光（生成的主题族，照原型）：
  - 光泽：白色从顶边向下渐隐（`--cove-glass-sheen`），窗口外框在 30% 处消失，顶栏和侧栏在 60% 处消失。
  - 颗粒：180px 的均匀灰度噪点，同一 alpha（`--cove-glass-grain`，暗色 11/255，亮色 7/255）。启动时由
    `bootstrap/installGlassGrain.ts` 用固定种子画一次，每次启动都一样；亚克力也用这张。每张颗粒按自身尺寸
    平铺（默认 SVG 160px，玻璃颗粒 180px）。
  - 高光边：左上亮（`rim-hi`）、其余暗（`rim-lo`）的 1px 环（`--cove-node-rim`，`node-chrome.css`）。
    外框在内边距盒处裁切，所以环在边框内侧，而不是像原型那样压在边框上；它盖在窗口内容上，在标签小旗和
    拖拽面之下。只有生成的主题族画它：像素族没有玻璃，空的遮罩层也要为每个窗口付一个合成层。
  - 对比度矩阵在满强度光泽下检查受光的玻璃，颗粒按平均灰计入；远景格子对未受光的外框色检查。亮色颗粒
    比原型（8）低一档：插件调色板里对比最低的绿到青底色在 k=0 时次要文字仍有 4.5:1。
- 窗口材质：设置 → 外观 → 窗口 →「窗口材质」或控制中心选「实色」，或系统开启降低透明度时（实时跟随，不用重启），
  `useApplyWindowAppearance` 在根节点写 `data-cove-transparency="reduced"`；样式只读这个属性，不再各自
  读媒体查询。此时生成的玻璃参数（`--cove-glass-*`）都变成 100%，受光（光泽、高光边、颗粒）去掉，
  窗口外框、底板、标题栏和面板变成不透明的同色，Surface 的玻璃和亚克力改为 `--cove-window-surface`，所有元素去掉 `backdrop-filter`
  （`themes/reduced-transparency.css`），透明终端露出终端底色。系统开启时「实色」被选中，「玻璃」不可选。
  验证：`tests/unit/app/uiSurfaceStylesheet.spec.ts`、`glassMaterialStylesheet.spec.ts`；
  `ui-gallery.probes.spec.ts` 和 `workspace-canvas.window-material.spec.ts` 用 CDP 模拟系统设置。

### 3.2 文本系统

- 主文字：`--cove-text`
- 次文字：`--cove-text-muted`
- 辅助/弱化：`--cove-text-faint`
- 禁止在 Light 模式出现“白字”（除非在深色 surface 上，且由 token 驱动）。

### 3.3 交互状态

- `hover`：轻量，优先用 `--cove-surface-hover`
- `focus-visible`：必须可见且不刺眼（建议 1px ring + 轻外发光）
- `disabled`：降低对比/透明度，但仍可读、可理解

### 3.4 共享组件图库与可访问性探针

- 共享组件（`src/app/renderer/components/ui/`）的每种状态都放进测试专用的组件图库
  `src/app/renderer/gallery/UiGallery.tsx`。图库只在 `NODE_ENV=test` 且
  `OPENCOVE_TEST_UI_GALLERY=1` 时代替应用外壳渲染，并按需加载，不进入正常启动路径。
- `tests/e2e/ui-gallery.probes.spec.ts` 在 Cove 的深色与浅色下扫描图库、
  对话框和浮层：文字对比度不低于 4.5:1（大字 3:1，禁用控件除外），点击区不小于 24×24
  CSS px（WCAG 2.5.8）。探针在 `tests/e2e/ui-accessibility.probe.ts`，测量前等待有限动画结束。
- 新增或修改共享组件时，先把它的各个状态加进图库；探针不通过不能合并。
- 对话框正文放在 `.cove-window` 表面上；共享 `Dialog` 只负责层级、焦点与关闭，不自带表面。
- 悬停提示用 `Tooltip`（`components/ui/Tooltip.tsx`），不用原生 `title`：悬停 500ms 后出现，
  刚关闭一个提示后 300ms 内移到相邻控件立即出现；键盘聚焦时也显示；Esc、按下、滚轮或窗口失焦时关闭；
  同一时刻只有一个；减少动态效果时没有淡入。提示与触发元素的可访问名称相同时不设
  `aria-describedby`（例如 `IconButton` 的 `label`）。层级是 `--cove-z-tooltip`，在对话框浮层之上、通知之下。
- 状态色只出现在 `StatusPill`，并且永远带文字：工作中用强调色（附三个像素点，减少动态效果时静止），
  等待你用黄色，失败用红色，其余状态（待命、已退出、已停止、恢复中、观察中）一律中性。
  状态到色调的映射是 `getStatusPillTone`；胶囊底色是预合成到窗口框上的不透明色，玻璃背后的光不会降低对比度。
  生成的主题族由生成器给出胶囊颜色（对比度矩阵检查 4.5:1），手写主题从自身的强调色、标记色与危险色推导。
- 窗口类别的图标放在 `KindTile` 上（AI、终端、计划、知识、媒体、中性）。类别色由生成器成套给出；
  没有类别色的主题显示中性图块。类别色只画图块，不画外框。
- Agent 提供方标记（`AgentProviderIcon`）在 Dock、菜单、设置和任务会话里不加底片、不用厂商色，
  用身边图标的墨色（静止为次要文字色，悬停随所在行变亮），厂商位图也描成单色路径；只有窗口标题栏、
  侧栏和远景方块用 AI 类别色画同一个标记（`NodeKindIcon`）。`workspace-canvas.provider-marks` 在
  深浅两套主题下检查 Dock 与「运行 Agent」子菜单。
- 菜单行用 `components/ui/Menu.tsx`：`MenuItem`、`MenuCheckboxItem`、`MenuSeparator`，图标、文字、
  快捷键三列，末尾是子菜单箭头或勾。行高跟随主题的 `menuRowHeight`，触屏与窄屏不低于 44px。
  快捷键用 `describeKeyChord` 从生效的按键设置生成，显示格式与全应用一致（⌘T、Ctrl T），
  对读屏通过 `aria-keyshortcuts` 提供，不计入名称；未分配快捷键的命令不显示。
- 立即生效的开关用 `Toggle`（`role="switch"`，例如设置项）；要和其他选项一起确认的选择用
  `Checkbox`（例如归档前勾选「删除 worktree」）；标签和筛选用 `Chip`。`Checkbox` 的名称只取标签，
  补充说明放在 `description`，通过 `aria-describedby` 提供；方框对齐标签第一行，行高不同时设置
  `--cove-checkbox-line`。可选的 `Chip` 是切换按钮（`aria-pressed`），选中时同时显示勾，不只靠颜色。
- 几个互斥选项并排时用 `SegmentedControl`（单选组：原生 radio 共用一个唯一的 `name`，方向键切换、
  只占一个 Tab 停留点）。组名用 `label`，或用 `labelledBy` 指向可见的标题。选中段是中性的浅底，
  不用强调色；只有图标的段设 `iconOnly`，名称同时作为提示文字。切换内容面板时再用 Tabs。
- 带标签的文本输入用 `TextField` / `TextAreaField`：标签通过 `htmlFor` 命名输入框，补充说明放在
  `description`，校验错误放在 `error`（同时设置 `aria-invalid`、`aria-errormessage` 并加入描述）。
  标签行右侧的操作（例如提示词模板按钮）放在 `labelAccessory`。输入框本身仍是 `.cove-field`。
- 设置页的每一行用 `SettingRow`：一个表单控件放在 `control`，行标签就是它的 `<label>`，说明通过
  `aria-describedby` 提供；只读的值或一组操作按钮放在 `value`，整行成为以标签命名的 `group`。
  行里的控件只用 `Toggle`、`SegmentedControl`、`CoveSelect`、`NumberInput`（带单位的数字框，
  单位也加入描述）。`CoveSelect` 在行里的名称是「行标签 + 当前值」（例如「显示语言 English」）。
  设置页里 `SettingRow` 与旧的 `.settings-panel__row` 版式一致，迁移不改变像素。
- 窗口标题栏用 `WindowHeader`（`workspace/.../components/shared/`），顺序固定：标记圆点、类别图块、
  标题（13px / 500）、状态、本类操作、折叠、关闭。各窗口只填这些位置，不自己排版。
  类别图块随主题的图标尺寸缩放（默认 20px 图块、12px 图标）。
  整条标题栏就是拖动面，不留单独的拖动空白，标题一直占到右侧控件前。可改名的标题
  （`InlineNodeTitleEditor`：任务、便签、终端、Agent）单击改名，按住 400ms 或移动超过 4px 就是抓起窗口，
  松开不改名；只读标题（文档、文件夹、网页、角色、插件窗口）单击选中窗口。类别图块是唯一只拖不改名的位置，
  测试用的 `dragSurfaceTestId` 也挂在它上面。窗口自己的点击处理要放过标题的点击（`isWindowTitleGesture`）。
  右端的操作、折叠、关闭之间统一用 `--cove-control-gap`（插件主题的 `controlGap`）。
- 类别色与标记色是两个通道（`window-kind-identity.css`）。类别（这个窗口是什么，由 `resolveWindowKindFamily`
  推导：Agent 与角色 AI、终端、任务计划、笔记与文档知识、网页与图片媒体）只画标题栏的 `KindTile` 和 9% 的
  标题栏色调（照原型从左向右在 72% 处淡出，并在标题栏下半部向下淡出）；标记（你怎么归类它）只画窗口外框和标题栏左上角的短旗标。类别色从不画外框，标记色从不画图块。
  未标记的窗口外框是中性色，没有旗标。
  设置 → 外观 →「窗口类别色」关闭后，图块、标题栏色调和侧栏 Space 小地图都变成中性，标记色不受影响。
- 折叠和关闭由 `WindowHeader` 渲染（`WindowCollapseButton`、`WindowCloseButton`），都是 24px 的
  `IconButton`，名称即提示文字。关闭按钮按实际效果命名（关闭、删除便签、删除任务），关闭前的确认仍由
  各窗口自己的 `onClose` 负责；两个按钮都在按下时阻止冒泡，不会开始拖动窗口。
- 菜单项只在声明了 `role="menu"` 的菜单表面（`ViewportMenuSurface`，窄屏的底部面板同样适用）里
  取得 `menuitem` / `menuitemcheckbox` 角色，其他地方仍是普通按钮。所以一个菜单的所有行都换成
  菜单项之后，才给它加 `role="menu"` 与名称。键盘方向键跳过禁用项。

### 3.5 像素图标

- 应用里的图标都是像素画（Tide：像素是主调），不再使用 lucide。界面图标用
  `components/ui/pixelIcons.ts` 的具名组件（`CloseIcon`、`FolderOpenIcon` 等），按含义命名，不按外形。
  画稿在 `components/ui/pixelIconArt/`：每个 12×12 格，`#` 画一格，`.` 留空；多数由 pixelarticons
  （MIT，许可随画稿保留）的 24 格画稿对折而来，其余按同一网格手画。新增图标先补画稿，再导出组件。
- 尺寸只用 12、18、24（`--cove-icon-size-sm/md/lg`），单独的插图（例如无法打开的文件）用 36，
  在 2× 屏上每格都落在整设备像素上。组件的 `size` 只接受这几档；CSS 在上下文里改尺寸时用这些 token，
  不写 14、16、20 这类让格子跨像素的值。
- 图标用 `currentColor` 填色、`crispEdges` 绘制；默认是装饰（`aria-hidden`），名称由所在的按钮或
  菜单行提供，传了 `aria-label` 才成为 `img`。
- 像素图标不做任意角度的旋转（箭头转 90° 或 180° 仍在格子上）。忙碌状态用 `PixelSpinner`：环上八个
  2×2 块依次点亮；减少动态效果时放慢到三分之一，不静止。
- 窗口类别仍用 9 格的 `PixelGlyph`（`NodeKindIcon`、`KindTile`）。Dock 的新建按钮用同一套类别字形
  （18px），和新建出来的窗口一致；Agent 按钮用提供方标记，插件按钮用插件声明的图标。
- `tests/e2e/app-shell.pixel-icons.spec.ts` 在工作区、画布菜单和设置各页检查：没有 lucide 图标，
  每个可见的像素图标都是正方形且尺寸在上述几档。`PixelIcon.spec.tsx` 检查画稿、路径和每个导出组件。
- 像素基础件在 `styles/ui-pixel.css`：2px 台阶圆角（`--cove-pixel-corners`，`clip-path` 用）、
  填充代替描边（`--cove-pixel-fill` / `-hover`）、上亮下暗的可按质感（`--cove-pixel-raised` /
  `-pressed`）和按 `steps(1, end)` 跳变的闪烁（`cove-pixel-blink`，减少动态效果时停用）。
  首个使用者是任务卡（`docs/ui/TASK_UI_STANDARD.md` 2.2）。

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
- 终端背景（设置「终端背景」：自动 / 透明 / 不透明）决定 xterm 是否以 `allowTransparency` 打开，
  背景为底板等效色的零透明度（OSC 11 报告的就是文字所在的颜色）。这个值只取决于设置和平台
  （自动 = 仅 macOS 透明），改变时重建 xterm 实例、保留 PTY 与屏幕。文字背后显示什么由 CSS 决定：
  生成的主题用 `--cove-terminal-plate-backdrop: transparent` 露出阅读底板，手写主题和降低透明度
  （`data-cove-transparency="reduced"`）保留终端底色，二者都不重建 xterm。回放历史输出前去掉其中的终端查询，避免新实例
  把旧问题的回答写进 shell。
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
- Group 标题不重复页面标题（快捷操作页的第一组按内容出现的位置叫“右键菜单”）。设置页是一列偏好，不是只有一个决定性动作的表单：添加、保存单个字段、打开、校准都用默认的 secondary `Button`（添加带加号），accent 实心按钮只留给对话框的确认和等待安装的更新（Apple HIG：一个视图至多一个显著按钮）。`settings.page-hierarchy` E2E 逐页检查。
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
- 设置页的每一行都能被搜索到：搜索行的名称时，结果里有一条标题就是这个名称。新加的行要在
  `settingsSearchIndex.*` 里加条目（同一组的行用 `rowsIn` 指向组的锚点；快捷键行由命令列表生成），
  `settings.search-coverage` E2E 会在中英文下逐页逐行检查。

- 外观点阵预览必须消费现有画布绘制、mask、assembly、burst 与调度器。它使用独立 DOM 类和局部时钟，不创建真实 React Flow 节点、不启动 PTY、不发运行时创建/关闭事件；离屏、减少动态效果与关闭开关均需停止不必要的循环。

- 新安装默认 Cove 深色；显式保存的主题与各项像素开关不因升级或切换主题被覆盖。
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
- 项目栏宽 72px：顶部是 OpenCove 标志，中间是项目列表，底部依次是固定 / 关闭、添加项目与设置，
  它们不随项目列表滚动；展开、收起与移动抽屉共用同一入口。
  移动抽屉交接到设置后关闭，设置退出返回导航按钮，不恢复已卸载的抽屉按钮焦点。
- 每个项目是一个带项目颜色的瓦片，下面是项目名（过长省略，完整名称在提示里）。颜色由项目 ID
  推导，只用标签色里的蓝、紫、绿、橙（黄、红留给等待与失败，灰是中性），重排不改变颜色，不另存。
  瓦片右上角是等待你的 Agent 数，底部三个像素点表示有 Agent 在工作；屏幕阅读器从项目名称里
  读到这两个数。当前项目用项目栏边缘的竖条标出，悬停预览显示短竖条。
- 导航面板顶部是跨所有项目的「需要你」收件箱：每个等你的 Agent 一行（含结束一轮、卡片还没回应的，
  见 [Agent Island](./AGENT_ISLAND.md)），显示项目瓦片、标题、「项目 · Space」与等了多久；一次点击切到
  那个项目并聚焦该 Agent（移动端只定位）。没有等你的 Agent 时整块不显示；隐藏的 Agent 也会出现。
  项目角标数的就是收件箱里该项目的行，与顶栏摘要来自同一份 Agent 数据，同一次渲染更新。
- 「等了多久」只来自本窗口亲眼看到的状态变化：Agent 先被看到在做别的、之后进入等待才开始计时；
  启动时恢复出来、或第一次出现就在等待的 Agent 只显示「等待你」，不编造时长。计时是不保存的界面状态，
  由外壳常驻记录，侧栏收起时也继续。没回应的 Agent 从卡片出现时算起。
- 悬停项目只产生临时导航预览，不写 active workspace、active Space、viewport 或执行目录。
  预览跟随指针移动：指针不动时收到的进入事件（例如拖动浮层从指针下消失）不切换预览。
  点击项目沿用该项目保存的画布视野；点击 Space / Agent 才发送定位意图。
- 固定偏好、分组折叠、条目隐藏与筛选由设置 owner 保存；悬停、拖动锁定与移动抽屉属于
  renderer 临时状态。Sidebar 的可见性独立于画布中 Space / 窗口的收起状态。
  收起或打开覆盖式导航不能写入 viewport，也不能重建终端实例。
- 窄屏隐藏整个项目栏，导航按钮打开覆盖式抽屉，右侧至少保留 48px 画布关闭区域。
  抽屉拦截画布输入、锁定焦点，Escape / 遮罩关闭后恢复触发按钮焦点。项目切换保留抽屉；
  Space / Agent 导航关闭抽屉。移动 Agent 导航只定位，不请求输入焦点；桌面导航可聚焦输入。
- Remote 标记只来自项目唯一 Mount 的远端 endpoint，不来自浏览器运行模式。多目录或混合
  Mount 不显示整项目 remote；位置详情在标记或项目目录管理中查看，不常驻项目路径。
- 每个 Space 是一张卡片：左边是实时像素小地图，窗口按类别色画在 Space 自己的框里（Agent 工作时闪烁，
  等你变黄、失败变红，卡片未回应的 Agent 也算等你），点方块飞到那个窗口，点空白处飞到 Space；小地图只服务指针，键盘与屏幕阅读器
  走 Space 名称和 Agent 行。右边是名称与「分支 · N 个工作中 · N 个等你 · N 个窗口」；更多操作在悬停或
  键盘焦点时出现，折叠控制常驻右侧。Space 标记是卡片左缘的短色条。
- 分支只在 Space 的目录属于它自己的 worktree 时出现（游离 HEAD 显示短提交）；在项目自身检出里的 Space
  与项目同一分支，不重复显示。worktree 列表只有一个 owner（`worktreeInfoStore`）：画布的 Space 框、
  Space 菜单与侧栏卡片按「仓库路径 + Mount 集合」共享同一份列表，有人订阅时每 10 秒列一次、窗口隐藏
  时跳过，列表失败保留上一份，最后一个订阅者离开就停止。
- Agent 自有标记通过短侧线与淡底色展示。Agent 不继承 Space 标记，图标是提供方品牌标记、用 AI 类别色绘制；
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

### 画布信号

涟漪、工作灯、等待与完成/失败信号、跳转高亮、边缘信标、像素墙光照、工作中巡航和创建/关闭粒子的
契约见 [Canvas Signals](./CANVAS_SIGNALS.md)。

### 远景（Tide 第 4 期）

- 画布有两层细节：缩小到 25% 以下进入远景，放大到 28% 以上回到近景（`canvasLod.ts` 的带迟滞纯函数）。
  `useSpaceVisualScale` 是唯一写入点，只在层级切换时给画布根节点写 `data-cove-lod="far|near"`；
  组件用 `useCanvasLod` 读它，只在切换时重渲染，缩放过程中不重渲染。网页原生视图用同一组阈值冻结，
  所以「远」只有一种语义。
- 远景下，展开的窗口仍然挂载、保持原尺寸，`.cove-node-presentation__runtime` 用
  `content-visibility: hidden` 跳过绘制（终端、编辑器和网页照常运行，rows/cols 与 PTY 尺寸不变）；
  `WorkspaceFarView` 在视口门户里按 Tide 原型画出全部窗口：居中的像素图标（类别字形色）、800 字重标题
  （Agent 和窗口标题栏一样，不带「codex ·」之类的前缀，提供方由图标表示）、右上角一个状态像素（工作中闪烁，等待黄、失败红，减少动态效果时不闪）
  和标记色外圈（3px，向外偏 3px）；背景是类别色从左上 `--cove-glass-far-tint` 渐变到 40% 叠在窗口
  玻璃上（对比度矩阵检查的正是这个组合），标题用 `--cove-kind-<族>-far`。方块不接收指针事件，拖拽、框选和右键照旧落在下面的窗口上。已折叠的窗口保持桌面图标。
- 方块本身是窗口玻璃，用画布坐标：圆角就是 `--cove-node-radius`，和墙在它下面画的磨砂同一个角，
  任何缩放下都重合。方块里的「面」按屏幕像素排版（宽高乘以门户层上的 `--cove-canvas-zoom`，再缩放
  回去），尺寸照抄原型 `.n-far`：方块放得下时图标屏幕 26px、标题 15px（乘界面字号缩放）、图标下间距
  8px、状态像素 7px；放不下时随方块缩小（图标和间距为面内容高度的 26% / 6%，标题取宽度 12% 与高度 22%
  中较小者，最多两行，状态像素为高度 7%），内边距是面宽度的 7%。任何内容都不会被丢掉，缩得再小也是窗口的
  一张完整「海报」。窗口类别色关闭时方块只保留中性玻璃。
- 远景下每个 Space 的名字在屏幕上一样大（只按缩放计算，不再按 Space 宽度封顶）；窄 Space 的名字可以
  超出 Space，屏幕上约 300px 后才截断，边框缺口只在 Space 自己的宽度内。
- 交互：远景下窗口内容不接收指针事件（交叉淡化期间也一样），点击落在窗口本身。单击方块飞到它并回到近景
  （至少 60% 缩放）；按住修饰键单击只做选择；整块方块都可以拖动窗口（拖拽把手选择器在远景下包含
  `.cove-node-presentation__runtime`）；右键打开窗口菜单。框选照旧。
- 切换时 140ms 交叉淡化：进入远景时方块淡入，窗口在淡入结束后才停止绘制（`content-visibility` 的
  `allow-discrete` 过渡）；回到近景时方块再保留一次淡出。减少动态效果时直接切换。
- 设置 → 外观 → 窗口 →「远景」可以关闭（`canvasFarViewEnabled`，默认开）；关闭后任何缩放下窗口都是自己。
- 画布 HUD（`WorkspaceCanvasHud`）：左上角「远景 / 近景」分段控件反映当前层级，选「远景」按 20% 以内
  适配全部窗口，选「近景」以视口中心回到 100%；层级要等缩放越过阈值才变，所以先显示所选项。右上角
  缩放百分比是单独的小组件，只有它随每一步缩放重渲染。远景关闭时只保留缩放百分比。
- 缩放不应提交任何窗口：每个窗口标题栏在测试构建里按类别计数自己的提交（`windowCommitProbe.ts`，
  测试 API `getWindowCommitCounts`）。性能脚本 `pnpm test:perf`（先 `pnpm build`；不进快速门禁和 CI）
  在 100 个窗口、20 个持续输出终端的场景里按显示帧率往返缩放 1 → 0.12 → 1 三次，远景开和关各一轮，
  报告帧率、p95/p99 帧间隔、长帧和窗口提交数，写到 `test-results/perf/canvas-zoom.json`。绝对数字随机器
  负载变化，只比较同一批次。

### 搜索与快捷控制契约

- 命令中心负责窗口、Space、项目和命令导航；项目搜索负责当前项目的 Space、任务与笔记。
  入口与显示方式可变化，筛选、定位和设置写入仍由原有 owner 负责。
- 命令中心的结果依次是：「需要你」（所有项目里等你的 Agent，带「项目 · Space」和等了多久，搜索时
  只要匹配就排在最前）、当前项目的窗口（带所在 Space）、Space、项目、命令（带当前快捷键，与菜单的快捷键列
  一致）和插件命令。没有输入时按这个顺序；输入后除「需要你」外按各组最佳匹配排序，输入 Space 名称
  时 Space 组在前。选中窗口和侧栏一样定位并聚焦它，所以只用键盘就能找到窗口并飞过去。
- 命令中心与项目搜索共用 Sidebar 的项目图标、Space 四角框和标签侧线语义。
- 顶栏中间的命令入口显示「项目 / 当前 Space」：当前 Space 是画布视口中心所在的最内层 Space
  （`viewportSpace.ts`，只在中心跨进另一个 Space 时更新），平移和导航都会改变它。右侧的 Agent 活动摘要
  和侧栏用同一份 Agent 模型：有 Agent 在等你时显示「N 个待确认」，点一下切到那个项目并聚焦第一个等你的
  Agent；只有工作中的 Agent 时只显示状态；都没有时不显示。顶栏按钮都是共享的 IconButton。
  项目目录保留为搜索关键字，不作为常驻副标题；remote 只表示唯一 Mount 的远端 endpoint。
- 桌面项目搜索是可调整宽度的非模态侧栏，控制中心是锚定按钮的非模态 Popover；
  窄屏分别使用近全屏搜索 Dialog 与底部控制 Dialog，触控目标至少 44px。
- 命令中心遵循 editable combobox 模式：输入框保留 DOM focus，方向键通过
  `aria-activedescendant` 选择结果，Enter 执行；IME 合成过程不执行导航或命令。
  键盘滚动只作用于结果列表，不得移动外层画布。
- 模态界面复用共享 Dialog 的 inert、Tab 约束与焦点恢复。手机打开搜索先聚焦关闭控件，
  避免自动唤起软键盘；定位后关闭搜索，返回导航控件，不聚焦终端输入。
  弹层交接后旧界面不得通过延迟恢复抢走新界面的焦点。
- 控制中心是一个像素游戏窗口（`.cove-pixel-window`），只放快捷设置：外观三张像素缩略图（与设置 → 外观共用
  `AppearancePicker`）、四个 `aria-pressed` 快捷开关（`ToggleTile`：小地图、应用内通知、系统通知、提示音），以及「通知设置」
  「全部设置」两行菜单（指针或焦点所在行前有闪烁的像素光标）。材质、像素背景、闪烁和动态效果只在设置 → 外观。当前是插件主题时，
  控制中心显示它的名字，三个外观都不选中；不可用或加载失败时给出提示，但不改写用户保存的主题选择。

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
- `pnpm line-check`
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
