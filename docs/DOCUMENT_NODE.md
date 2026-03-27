# Document Node（画布内文件编辑）

本文档定义 OpenCove 在 Canvas 内打开与编辑文件的节点形态（Document Node，简称 Doc Node）的语义与约束。

Doc Node 的定位是：把“读/写文件”从 terminal 的隐式副作用升级为一等能力，但仍保持 Canvas-first 的心智模型（节点可并列、可对照、可被 Space 约束）。

## 1. Doc Node 是什么

- **一种画布节点**：类似 terminal/task/note 节点，拥有统一的 node chrome（标题栏、关闭、拖拽、缩放）。
- **绑定一个文件 URI**：节点数据的 durable truth 是 `uri`（例如 `file:`），而不是一份内嵌文本副本。
- **文件内容的真相在 filesystem**：Doc Node 通过 filesystem contracts 读取/写入文件，不能把“文件内容”当作 workspace state 的长期存储。

## 2. Durable Truth vs UI State

必须区分：

- Durable truth（可持久化/可恢复）：
  - `uri`
  -（可选）`titlePinnedByUser`（若支持固定标题）
  -（可选）显示偏好（例如折叠状态、字号缩放）
- UI state（不应成为 durable truth）：
  - 当前 selection/cursor
  - hover/active/focus
  - 临时提示与错误 toast

关于“未保存草稿”的策略：

- MVP 可以只提供显式保存（Save），并在关闭/切换前给出提示。
- 若要支持 crash-safe draft（类似 VS Code Hot Exit），应落在独立的 drafts 存储中，而不是把大文件内容塞进 workspace state。

## 3. 读写语义（必须可解释）

- 打开文件：
  - 读取 `filesystem.readFileText(uri)` 得到内容并渲染
  - 不允许绕过 guardrails（approved roots / scope）
- 保存文件：
  - 写入 `filesystem.writeFileText(uri, content)`
  - 保存成功后清除 dirty 状态
- 错误处理：
  - 必须展示结构化错误语义（例如未批准路径、权限不足、文件不存在）
  - 禁止使用系统弹窗（见 `DEVELOPMENT.md` 约束），统一用应用内反馈组件

## 4. 与 Space Explorer 的关系

Space Explorer 是 Doc Node 的“入口与编排面”：

- 在 Space Explorer 的文件树中点击文件：创建/聚焦 Doc Node（绑定 `uri`）
- 在 multi-mount 场景中：Doc Node 的 `uri` 必须属于触发它的 mount column 的 target/scope

具体交互目标见 `.opencove/design/SPACE_EXPLORER_DESIGN.md`（私有设计稿）。

## 5. UI 约束（风格与交互）

- 必须使用现有 `--cove-*` token（暗/亮主题一致）。
- Doc Node 的编辑区域必须声明 `nodrag` / `nowheel`，避免干扰画布手势。
- 任何“打开外部编辑器/IDE”的行为是可选增强，不应成为 Doc Node 的主路径。

## 6. 最低回归（建议）

- E2E：
  - 从 Space Explorer 打开一个文件，修改并保存，校验磁盘内容变化
  - 未批准路径打开/保存被拒绝且 UI 可解释

