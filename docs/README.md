# OpenCove Docs

`docs/` 只放公开、当前有效的工程文档。这里的文档描述已实现的架构、能力边界、调试方法和维护规则；执行安排、草案和内部风险跟踪不放在公开文档中。

## Architecture

- `architecture/CURRENT_ARCHITECTURE.md`：当前运行时、控制面、持久化、文件系统、终端与 CLI 的总览。
- `architecture/ARCHITECTURE.md`：DDD + Clean 的代码组织规则。
- `architecture/CONTROL_SURFACE.md`：Control Surface 的 command / query / event 边界。
- `architecture/PERSISTENCE.md`：SQLite、拓扑文件和迁移规则。
- `architecture/RECOVERY_MODEL.md`：恢复语义、状态所有权与不变量。
- `architecture/WORKSPACE_CAPABILITY_ARCHITECTURE.md`：当前 Project / Space / Endpoint / Mount / Session 能力链路。

## CLI

- `cli/README.md`：CLI 架构、安装拓扑和 Worker 生命周期。
- `cli/CANVAS_NODE_CONTROL.md`：当前 CLI 画布节点控制能力。
- `cli/AGENT_PLAYBOOK.md`：Agent 本地 CLI smoke / CRUD / focus 验证流程。
- `cli/AGENT_PROMPT.md`：可直接复制给 Agent 的 CLI 验证提示词。
- `cli/EXTERNAL_EXECUTABLE_RESOLUTION.md`：外部 CLI 发现、解析和 override 机制。

## Canvas

- `canvas/FILESYSTEM.md`：URI、mount-aware filesystem contracts 和 guardrails。
- `canvas/SPACE_EXPLORER.md`：Space 内文件浏览器。
- `canvas/DOCUMENT_NODE.md`：画布内文件编辑与媒体预览。
- `canvas/WEBSITE_WINDOW_NODE.md`：Website Node 运行时与窗口语义。

## Runtime

- `runtime/CLA_SETUP.md`：CLA bot 配置与维护说明。
- `runtime/RELEASING.md`：Release、nightly 与 standalone server 资产。
- `runtime/WEB_UI_TROUBLESHOOTING.md`：Worker/Web UI 调试入口。

## Terminal

- `terminal/README.md`：终端专题入口。
- `terminal/MULTI_CLIENT_ARCHITECTURE.md`：当前终端多客户端架构与限制。
- `terminal/TUI_RENDERING_BASELINE.md`：TUI 渲染稳定性基线。
- `terminal/ANSI_SCREEN_PERSISTENCE.md`：ANSI screen restore 案例记录。

## Agent

- `agent/README.md`：Agent runtime、session 恢复与外部 CLI 解析的当前公开入口。

## UI

- `ui/README.md`：全局 UI 和主题规范。
- `ui/WINDOW_UI_STANDARD.md`：窗口 UI 规范。
- `ui/TASK_UI_STANDARD.md`：任务 UI 规范。
- `ui/VIEWPORT_NAVIGATION_STANDARD.md`：视口导航规范。

## Development

- `development/DEBUGGING.md`：调试工作流。
- `development/REFERENCE_RESEARCH_METHOD.md`：外部参考调研方法。

## Cases

- `cases/README.md`：复盘案例索引。

新增公开文档前先判断它是否描述当前事实。若内容包含未实现方案、执行顺序、风险登记或内部决策记录，应放在内部文档区，而不是 `docs/`。
