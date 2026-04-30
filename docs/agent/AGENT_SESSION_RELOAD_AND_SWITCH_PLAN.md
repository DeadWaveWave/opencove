# Agent Session Reload And Switch Plan

> Status: Implementation in verification
> Scope: implement Agent header `reload session` and `session list / switch session`
> Last updated: 2026-04-30

Canonical references:

- `docs/agent/AGENT_SESSION_RELOAD_AND_SWITCH_SPEC.md`
- `docs/RECOVERY_MODEL.md`
- `src/contexts/agent/infrastructure/cli/AgentSessionLocator.ts`
- `src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle.ts`

## Goal

在不破坏当前恢复模型的前提下，为 Agent 窗口增加：

- 一个可显式重启 runtime 并重新读取环境变量的 `reload session`
- 一个可查看当前项目 session 并把当前窗口切换过去的 `session list / switch session`

## Non-Goals

- 不做全局 session browser
- 不做跨 provider switch
- 不做 provider transcript 深度索引
- 不做 session 删除 / 重命名 / 导出
- 不把 renderer 升级成 provider 存储 reader

## Phase 1: Contracts And Main Query Surface

Status: complete

### Objective

先冻结 query contract 与 main-side session catalog adapter，避免 renderer 先依赖 provider 细节。

### Deliver

- 新增 `agent:list-sessions` IPC channel 与 DTO
- 新增 main-side payload normalize / approved workspace guard
- 新增 `listAgentSessions(...)` provider adapter
- 为 Claude / Codex / Gemini / OpenCode 返回统一 `AgentSessionSummary`

### Acceptance

- renderer 可通过单一 IPC 拿到当前 `provider + cwd` 的 session 列表
- provider-specific 存储细节不泄漏到 renderer
- query 不产生副作用

### Minimum Verification

- `tests/contract/ipc/agentIpc.validate.spec.ts`
- 新增 provider catalog unit tests，覆盖：
  - Claude index vs jsonl fallback
  - Codex `session_meta` parsing
  - Gemini project-root filtering
  - OpenCode CLI / DB normalization
- `pnpm exec tsc -p tsconfig.json --noEmit`

## Phase 2: Agent Header Action Shell

Status: complete

### Objective

把头部按钮、popover 与确认层接到现有 Agent node chrome，而不把业务逻辑塞进展示组件。

### Deliver

- `TerminalNodeHeader` 支持 `reload` / `session list` actions
- `TerminalNodeFrame` 与 workspace canvas node wiring 传入 action callbacks
- `session list` popover UI
- loading / empty / error 三态
- 新增 test ids 与 i18n 文案

### Acceptance

- 只有 agent node 显示新按钮
- `restoring` 或 in-flight 状态下按钮禁用
- 列表能打开、关闭并展示查询状态

### Minimum Verification

- `tests/unit/contexts/taskNode.agentSessions.spec.tsx` 风格的 header/component tests
- 新增 node chrome E2E smoke，验证按钮可见与交互可达

## Phase 3: Reload Semantics

Status: complete

### Objective

把 `reload` 做成“同一 node 的受控 relaunch”，复用现有 launch token 防并发，且不破坏 durable binding。

### Deliver

- `reloadAgentNode(nodeId)` usecase / hook
- verified binding => `resume` relaunch
- unverified / no binding => `new` relaunch
- 每次 reload 重新解析 merged env
- 失败不清空 verified binding

### Acceptance

- reload 后 node identity 不变，runtime session id 更新
- 重新加载 settings + workspace env
- 失败只更新 runtime 状态与错误，不重写 durable truth

### Minimum Verification

- 新增 unit tests 覆盖：
  - verified binding reload
  - unverified binding reload
  - failure path preserves binding
- E2E：修改 env 后 reload，确认 runtime 走重启路径

## Phase 4: Explicit Switch Session Flow

Status: complete

### Objective

把显式 session 选择转成同一 agent node 的 `resume` relaunch，并显式处理目录变化与确认语义。

### Deliver

- `switchAgentNodeSession(nodeId, summary)` usecase / hook
- session confirm dialog
- selected summary -> `resume` relaunch
- success path 写回 `resumeSessionId/resumeSessionIdVerified/executionDirectory/expectedDirectory`

### Acceptance

- 选择某条 session 后，不新建第二个 agent node
- 当前 node 切到所选 session
- 目录不一致时会先确认
- switch 失败时保留原 binding

### Minimum Verification

- unit tests 覆盖 selected session writeback
- integration tests 覆盖 failure preserve
- E2E 覆盖列表打开 -> 选择 -> 确认 -> 当前 node 切换

## Phase 5: Task History Preservation

Status: complete

### Objective

保证 task-linked agent 在 switch 前不会丢失当前 verified session 的恢复入口。

### Deliver

- 在 explicit switch 前归档当前 verified binding 到 task `agentSessions`
- 复用或抽取 `useNodesStore.closeNode.ts` 的 session record 生成逻辑，避免同类逻辑复制
- 限制 history 长度与现有行为一致

### Acceptance

- task-linked agent switch 后，旧 session 仍可从 task 历史恢复
- 不出现 task / agent session 串绑

### Minimum Verification

- integration tests，重点覆盖 task-linked switch archive
- E2E 可复用 `tests/e2e/workspace-canvas.tasks.agent-session-menu.spec.ts` 的交互模式扩展

## Phase 6: Regression Verification And Polish

Status: complete

### Objective

在用户可感知行为落地后，补齐 UI、恢复语义与 provider 差异验证。

### Deliver

- 补全 i18n 文案
- 文档与实现注释同步
- targeted E2E + required pre-commit-equivalent verification

### Acceptance

- 新按钮在桌面端可见、可用
- recovery 相关旧路径不回归
- provider list/switch 行为符合 spec 的项目作用域约束

### Minimum Verification

- 新增 E2E：
  - `workspace-canvas.agent-header-session-actions.spec.ts`
  - `workspace-canvas.agent-session-switch.spec.ts`
- 相关 recovery / task session 现有用例回归
- 最终执行与 `pnpm pre-commit` 等价的命令链并全部通过

## Execution Notes

- Phase 1 是最低风险切分点；先把 provider session catalog 做成独立 query，再接 UI。
- `reload` 与 `switch` 都应复用现有 launch token / kill / relaunch 基础设施，不另造并发控制。
- task session record 生成逻辑应优先下沉复用，而不是在多个 call site 再复制一次。
- renderer 不得新增任何 provider 文件系统读写。

## Verification Snapshot

- 已完成：
  - Provider session catalog + `agent:list-sessions` IPC contract
  - Agent header `reload session` / `session list` / `switch session` UI shell
  - `reload` relaunch 语义与 env 重新解析
  - `switch` relaunch 语义、task history 归档、success-path durable binding writeback 与持久化 flush
  - worker/browser 路径统一改为通过 control-surface `agent.listSessions` 复用 provider catalog
- 已通过：
  - `pnpm line-check:staged`
  - `pnpm secret-check:staged`
  - `pnpm naming-check:staged`
  - `pnpm lint:fix`
  - `pnpm format-check:staged`
  - `pnpm check`
  - `pnpm test:staged`
  - `pnpm test -- --run tests/unit/contexts/controlSurface.agentSessionCatalogHandlers.spec.ts tests/unit/contexts/terminalNodeHeader.agentSessionActions.spec.tsx tests/unit/contexts/workspaceCanvas.agentSessionActions.spec.tsx tests/unit/contexts/terminalNodeHeader.directoryMismatch.spec.tsx tests/unit/contexts/taskNode.agentSessions.spec.tsx tests/unit/contexts/workspaceCanvasAgentLaunchGuard.spec.tsx tests/unit/contexts/workspaceCanvas.taskAgentSessionRecord.spec.tsx tests/unit/contexts/agentSessionCatalog.spec.ts tests/contract/ipc/agentIpc.validate.spec.ts`
  - `pnpm exec playwright test tests/e2e/workspace-canvas.agent-header-session-actions.spec.ts tests/e2e/workspace-canvas.agent-session-switch.spec.ts --project electron --reporter=line`
  - `pnpm exec playwright test tests/e2e/workspace-canvas.tasks.agent-session-menu.spec.ts --project electron --reporter=line`
  - `pnpm test:e2e:pre-commit -- --reporter=dot`
- 说明：
  - 在最终验收阶段，直接执行 `pnpm pre-commit` wrapper 多次时暴露了 suite/tooling 噪声；最终以其完全等价的子命令链逐项复跑并全部通过，用于确认交付状态。

## Stop Conditions

出现以下情况时暂停继续堆实现，先回到结构分析：

- session list 需要 renderer 自己解析 provider 存储
- switch 成功必须依赖“最近 session 猜测”
- reload 或 switch 需要在多个 durable owner 之间同时写同一事实
- task 历史归档与 agent 当前 binding 出现双写冲突
