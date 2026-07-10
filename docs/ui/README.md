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

- 持久化设置：`settings.uiTheme: UiTheme`，取值见 `src/contexts/settings/domain/uiSettings.ts`（当前为 `'system' | 'light' | 'dark' | 'ember'`）。
- Renderer 主题入口（**两个互补的 hook**，共同构成命名主题扩展点）：
  - `<html data-cove-theme="light|dark">` —— 解析后的基础配色，所有 `--cove-*` token 默认基于此切换；`system` 会跟随 `prefers-color-scheme` 计算出 light/dark。
  - `<html data-cove-theme-id="<UiTheme>">` —— 当前选中的命名主题 id。命名主题通过 `:root[data-cove-theme-id='<id>']` 选择器覆盖 `--cove-*` token，与基础配色解耦。当前内置主题包含 `ember`；用户提供主题包的 loader、安全沙箱和 UI 入口不在当前公开能力内。
- 添加一个新内置主题的步骤：① 在 `UI_THEMES` 中登记 id；② 在 `UI_THEME_DESCRIPTORS` 声明 `baseScheme`（决定该主题坐落于 light 还是 dark base）与 `i18nKey`；③ 提供 `styles/themes/<id>.css`，以 `:root[data-cove-theme-id='<id>']` 选择器覆盖需要的 `--cove-*` token。
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

### 2.3 CSS 写法约定

- Token/主题差异 **集中在 `base.css`**，组件 CSS 不写分支主题选择器，除非确有必要。
- 避免在 React 里用 inline `style` 写颜色；布局/定位可以，但能 class 化就 class 化。

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

---

## 5) Settings（可读性硬约束）

- 所有文本/边框/输入框必须基于 token；尤其避免 `#fff` / `#ccc` 这类暗色假设。
- provider/card 标题与错误信息必须可读（Light/Dark 都可读）。
- 页面 registry 是 Settings 信息架构的单一来源：规范页面 id、别名、导航分组、标题/说明键和滚动目标；侧栏、动态页头、搜索结果与窄窗选择器必须共同消费它，禁止各自维护映射。
- 桌面侧栏按“应用 / 工作区 / 连接 / 高级”分组；项目使用独立、可折叠分组。二级入口可供搜索或深链定位，但不重复占用主导航。
- 页头必须随当前页面显示对应标题和简短说明，标题与说明来自 registry，不使用泛化的固定标题替代页面上下文。
- Settings 内容层级固定为 `Page H2 → Group H3 →（必要时）Module H4 → Row`；Group 标题与说明必须位于内容面之外，不能用 `<strong>` 冒充结构标题。
- 每个 Group 最多一个共享的轻量内容面，内部继续使用扁平设置行和细分隔线；Module 只用标题、说明、留白与 hairline 区分，不得再拥有独立背景、圆角或 header surface。Agent、Endpoint 等具备独立身份与状态的重复实体可保留 Entity Card，但不能再套 Group Body Card。
- 单项页面不为了形式统一强加空洞层级；条件内容不得产生空 Group；重排时必须保留搜索/深链依赖的 `settings-section-*` anchor。
- 窄窗口使用顶部 page selector 和单列内容，不能把桌面侧栏压缩成不可读的窄栏；页面切换后仍需保持标题、说明和目标内容可达。
- Settings 容器必须具备 `dialog` 语义、可访问名称和 `aria-modal`。打开后把焦点移入面板，关闭后恢复到触发控件；所有交互必须有清晰的 `:focus-visible`。
- 搜索支持方向键选择结果、`Enter` 跳转和 `Escape` 退出；查询非空时首次 `Escape` 先清空查询，再次 `Escape` 关闭面板。关闭按钮必须有可访问名称。

实现锚点：
- 面板样式：`src/app/renderer/styles/settings-panel.css`
- 分组原语：`src/contexts/settings/presentation/renderer/settingsPanel/SettingsGroup.tsx`
- 主题选择：`src/contexts/settings/presentation/renderer/settingsPanel/GeneralSection.tsx`

参考原则：Apple HIG Settings（稳定 pane 与相关设置分组）、Windows App Settings（单列、受约束宽度与 section header）、GNOME HIG Boxed Lists（短静态偏好使用共享列表面，标题位于列表之外）。

---

## 6) 测试与验收（UI 变更必须做）

### 6.1 最低验收

- Light / Dark 下主要页面可读（至少：Sidebar / Canvas / Settings / Node chrome）
- MiniMap idle/hover 层级正确（默认不抢眼，hover 可读）

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
