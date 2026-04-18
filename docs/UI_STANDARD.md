# UI Standard

本规范定义 OpenCove 的 **统一 UI 语言** 与 **实现约束**，用于保证：

- Light / Dark / System 三种主题下都可读、克制、层级清晰；
- 组件风格一致（像同一个“系统”）；
- 后续开发/改动可持续（可复用、可测试、可演进）。

命名约定：
- 产品/对外接口统一使用 `OpenCove` / `opencove`。
- UI 设计系统与样式命名空间保留 `cove` 前缀（例如 `--cove-*`、`data-cove-*`、`.cove-window`），作为稳定的内部约定，不随产品命名调整而变更。

> 关联专项规范：
> - Window：`docs/WINDOW_UI_STANDARD.md`
> - Task：`docs/TASK_UI_STANDARD.md`
> - Viewport：`docs/VIEWPORT_NAVIGATION_STANDARD.md`

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
  - `<html data-cove-theme-id="<UiTheme>">` —— 当前选中的命名主题 id。这是为命名主题预留的扩展点：任何主题（当前内置 `ember`，未来可扩展到用户提供的主题包）都通过 `:root[data-cove-theme-id='<id>']` 选择器覆盖 `--cove-*` token，与基础配色解耦。当前 PR 只 ship 内置 Ember 作为示例；真正的"用户主题加载/注册"机制（loader、安全沙箱、UI 入口）属于后续工作。
- 添加一个新主题的步骤（内置或后续用户主题都遵循同一形态）：① 在 `UI_THEMES` 中登记 id；② 在 `UI_THEME_DESCRIPTORS` 声明 `baseScheme`（决定该主题坐落于 light 还是 dark base）与 `i18nKey`；③ 提供 `styles/themes/<id>.css`，以 `:root[data-cove-theme-id='<id>']` 选择器覆盖需要的 `--cove-*` token。
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

实现锚点：
- 面板样式：`src/app/renderer/styles/settings-panel.css`
- 主题选择：`src/contexts/settings/presentation/renderer/settingsPanel/GeneralSection.tsx`

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
