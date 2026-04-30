# Agent Session Reload And Switch Spec

状态：Spec。本文定义 Agent 窗口右上角的 `reload session` 与 `session list / switch session` 功能目标、owner、语义边界与验收标准。

Last updated: `2026-04-30`

Canonical local references:

- `docs/RECOVERY_MODEL.md`
- `src/contexts/agent/infrastructure/cli/AgentSessionLocator.ts`
- `src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader.tsx`
- `src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle.ts`
- `src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.closeNode.ts`

External references:

- Claude Code sessions API: <https://code.claude.com/docs/en/agent-sdk/sessions>
- Claude session browser cookbook: <https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser>
- Codex app-server threads: <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- Gemini CLI reference: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md>
- OpenCode CLI docs: <https://dev.opencode.ai/docs/cli/>
- OpenCode server docs: <https://dev.opencode.ai/docs/server/>

## 1. 问题类型

这是成熟的多 provider 会话恢复与显式切换问题：

- 用户需要显式 reload 当前 Agent，以重新加载新的环境变量。
- 用户需要显式查看当前项目范围内的历史 session，并把当前窗口切到其中某一个。
- 该能力不能把 runtime observation、watcher 噪声或“最近一次启发式猜测”升级成 durable truth。

行业共识：

- `resume/list` 默认按当前项目或 `cwd` 作用域工作。
- 显式 session switch 由用户选择驱动，不应靠“最近一个会话”自动猜。
- 有官方结构化接口时优先使用结构化接口；没有时才读取 provider 自己的 durable 存储。

可迁移原则：

- 显式 switch 与自动发现必须分离。
- session list 是 query，不是 state owner。
- `resumeSessionId` 必须继续作为 durable binding，而不是 UI 层的临时选择结果。
- 只有高置信度路径才允许启发式推断；显式 switch 不允许启发式 tie-break。

OpenCove 本地约束：

- `resumeSessionId` 的 durable truth 属于 agent window，不属于 task history、watcher 或 renderer 临时状态。
- renderer 不能直接读 `~/.claude`、`~/.codex`、`~/.gemini`、`~/.local/share/opencode`。
- provider session catalog 必须统一经由 main-side adapter / IPC 暴露。

## 2. 目标

- 在 Agent 窗口右上角新增 `reload session` 按钮。
- 在 Agent 窗口右上角新增 `session list / switch session` 入口。
- `reload` 重新启动当前 Agent runtime，并重新读取最新环境变量。
- `switch session` 在不创建新 Agent 窗口的前提下，把当前 Agent 窗口切到指定 session。
- provider session discovery 统一为 main-side 归一化查询能力。
- task-linked agent 在 switch 前后保留可恢复历史，不串 session。

## 3. 非目标

- 不做全局 session browser。
- 不做 provider 间切换。
- 不做 session 删除、重命名、导出、搜索全文。
- 不把 session list 的结果持久化到 workspace state。
- 不让 renderer 直接碰 provider 本地文件或数据库。
- 不在本阶段重构 task session record schema 去保存完整 provider 原始摘要。

## 4. 用户体验

### 4.1 Agent Header

仅 `kind === 'agent'` 的节点显示新增按钮：

- `Reload session`
- `Session list`
- 保留现有 `Copy last message`
- 保留关闭按钮

按钮状态：

- `status === 'restoring'` 时，`reload` 与 `session list` 禁用。
- 正在执行 `reload` 或 `switch` 时，按钮进入 loading / disabled 状态，防止并发 relaunch。

### 4.2 Reload

点击 `reload` 后：

1. 终止当前 PTY/runtime session。
2. 重新解析当前 workspace + provider 生效的环境变量。
3. 用当前 agent node 的 durable binding 重启。
4. 成功后当前窗口仍是同一个 node，只是 runtime session 被替换。

用户心智：

- 这是“重载当前 Agent 会话运行环境”，不是“重新选择一个会话”。

### 4.3 Session List

点击 `session list` 后打开 header popover：

- 默认只列出当前 `provider + cwd/worktree/project` 范围内的可恢复 session。
- 每条至少显示：
  - `sessionId`
  - 最后更新时间
  - 目录
  - 标题或 fallback label
- 当前已绑定的 session 高亮显示。
- 提供 `loading / empty / error` 三态。

### 4.4 Switch Session

用户选择某一条 session 后弹出确认：

- 明确提示“会重启当前 Agent 窗口”
- 展示目标 session 目录和当前目录
- 若目录不一致，给出 warning，但允许继续

确认后：

- 当前 agent node 切到 `resume` 模式并恢复到所选 session。
- 不新建第二个 agent node。
- 成功后 header、runtime、binding 与目录一起更新。
- 新 binding 需要在 success path 中尽快 durable writeback，不能只依赖后续节流持久化偶然落盘。

## 5. 状态所有权

| State | Class | Owner | Allowed Write Entry | Restart Source |
| --- | --- | --- | --- | --- |
| 当前 agent window 的 `resumeSessionId` | Durable Fact | `agent` node | launch / reload / switch 成功写回 | persisted workspace state |
| 当前 agent window 的 `resumeSessionIdVerified` | Durable Fact | `agent` node | verify / reload / switch 成功写回 | persisted workspace state |
| 当前 agent window 的 provider / model / executionDirectory | Durable Fact | `agent` node | launch / reload / switch 成功写回 | persisted workspace state |
| task `agentSessions` 历史记录 | Durable Fact | `task` node | close / explicit archive usecase | persisted workspace state |
| provider session catalog | Runtime Query Result | main-side adapter | `agent:list-sessions` query only | none |
| PTY running / standby / exit | Runtime Observation | terminal / PTY runtime | runtime callbacks | none |
| header popover open/loading state | UI Projection | renderer | renderer only | none |

## 6. 恢复主不变量

1. verified `resumeSessionId` 不能因为 `reload` 或 `switch` 失败被清空。
2. 显式 `switch session` 只由用户选中的 session 驱动，不走“最近 session”启发式。
3. session list 是 query，不成为新的 durable source of truth。
4. renderer 不直接读取 provider 本地存储。
5. task-linked agent 在切走当前 verified session 前，必须先保留可恢复历史记录。
6. explicit switch 成功后，新的 verified binding 必须和 task archive 一样进入同一轮可靠持久化链路。

## 7. Provider Session Discovery Strategy

统一对 renderer 暴露归一化 session summary：

```ts
interface AgentSessionSummary {
  sessionId: string
  provider: AgentProviderId
  cwd: string
  title: string | null
  startedAt: string | null
  updatedAt: string | null
  source:
    | 'claude-index'
    | 'claude-jsonl'
    | 'codex-file'
    | 'gemini-file'
    | 'opencode-cli'
    | 'opencode-db'
    | 'control-surface'
}
```

当前阶段按 provider 使用以下优先级：

| Provider | Preferred Source | Fallback | Notes |
| --- | --- | --- | --- |
| `claude-code` | `sessions-index.json` | `~/.claude/projects/<encoded cwd>/*.jsonl` | index 只作为优化层，不能假定每个项目都存在 |
| `codex` | 当前阶段使用 `~/.codex/sessions/**/rollout-*.jsonl` 首行 `session_meta` | 无 | 后续若嵌入 app-server thread API，再升级为结构化线程接口 |
| `gemini` | `~/.gemini/tmp/<project>/.project_root + chats/session-*.json` | 无 | 当前 CLI `--list-sessions` 机器可读 contract 不够稳定，不能作为唯一后端 |
| `opencode` | 结构化接口优先：`opencode session list --format json` | SQLite `opencode.db` | 禁止解析 `snapshot/` 目录假装 session catalog |

补充：

- remote / browser adapter 现在通过 worker `control-surface` 的 `agent.listSessions` query 复用同一份 provider session catalog 归一化逻辑。
- 因此桌面 worker 路径与 browser 路径会返回底层 provider source（例如 `codex-file`、`claude-index`），而不再只暴露 live runtime session。

过滤原则：

- 默认只返回与当前绝对 `cwd` / project root 匹配的 session。
- 默认按 `updatedAt` 倒序。
- 目录或 project root 无法可靠匹配时，不自动猜测归属。

## 8. 合约

新增 main IPC：

```ts
interface ListAgentSessionsInput {
  provider: AgentProviderId
  cwd: string
  limit?: number | null
}

interface ListAgentSessionsResult {
  provider: AgentProviderId
  cwd: string
  sessions: AgentSessionSummary[]
}
```

建议 channel：

```ts
IPC_CHANNELS.agentListSessions = 'agent:list-sessions'
```

语义要求：

- 这是 query；不得有副作用。
- 对 `cwd` 做 approved workspace 校验。
- renderer 只消费归一化结果，不接触 provider-specific 存储细节。

## 9. Reload 语义

`reload` 不改变 node identity，只重启 runtime。

规则：

- 若当前 node 存在 verified `resumeSessionId`，则按 `mode='resume'` 重启。
- 若当前 node 不存在 verified `resumeSessionId`，则按 `mode='new'` 用当前 `prompt/provider/model/executionDirectory` 重新启动。
- `reload` 期间 node 状态进入 `restoring`。
- 成功后更新 runtime `sessionId`、`effectiveModel`、`executionDirectory`。
- 失败后更新 `status/lastError`，但不清空已有 verified binding。

环境变量规则：

- 每次 `reload` 必须重新从 settings + workspace environment variables 生成 merged env。
- 不缓存上一次 launch 的 env 作为 durable truth。

## 10. Switch Session 语义

`switch session` 是显式用户动作，不是自动恢复的一部分。

规则：

1. 只能切换到同 provider session。
2. 只能从 session list query 的显式结果中选择。
3. 选择后必须二次确认。
4. 若当前 agent node 绑定了 task，且当前 binding verified，则在切换前把当前 binding 归档到 task history。
   - 该归档必须请求一次持久化 flush，避免 hydration 后首轮本地状态变化被跳过写盘时丢失历史记录。
5. 切换动作本质上是：
   - 更新 launch intent 为 `resume`
   - 用目标 `resumeSessionId` 和目标目录重启当前 node
6. 成功后：
   - `launchMode = 'resume'`
   - `resumeSessionId = selected.sessionId`
   - `resumeSessionIdVerified = true`
   - `executionDirectory = selected.cwd`
   - `expectedDirectory = selected.cwd`
7. 失败后：
   - 当前 node 保持原 durable binding
   - 不写空值，不降级成未验证

Trade-off：

- 本阶段不要求从 provider 历史重建“最初 prompt”并写回 node / task history。
- task 历史记录继续以可恢复 binding 为主，而不是完整 provider transcript 摘要。

## 11. 验收标准

- Agent 窗口右上角能看到 `reload` 与 `session list` 按钮。
- 修改 workspace env 后，点击 `reload` 会重启当前 agent，并使用最新 env。
- 当前 node 已有 verified `resumeSessionId` 时，`reload` 后继续恢复同一 session。
- session list 只显示当前 provider、当前项目范围内的 session。
- 选择某个 session 后，当前窗口切换到该 session，而不是新开窗口。
- task-linked agent 在 switch 后，原 session 仍可在 task 历史中恢复。
- 失败路径不会清空 verified `resumeSessionId`。

## 12. 验证

最低有效验证层：

- Unit：
  - provider session summary 解析、过滤、排序
  - `reload/switch` 状态迁移 helper / hook
- Contract：
  - `agent:list-sessions` payload 校验、approved workspace guard
- Integration：
  - task-linked agent switch 前归档历史
  - switch 失败不清空 verified binding
- E2E：
  - header 按钮显示
  - reload 重启
  - session list 打开
  - switch 后当前 node 绑定更新

## 13. 主要风险

- Claude 与 Gemini 的列表更依赖本地文件结构，稳定性弱于 OpenCode 结构化接口。
- Codex 当前阶段仍使用本地 session file，而非 app-server thread API。
- 目录不一致时若没有显式确认，容易造成“恢复到了别的工作目录”。
- 若 switch 前不先归档 task-linked 当前 binding，会丢历史恢复入口。
