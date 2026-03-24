# 提案：新增 Cursor Agent CLI 作为 Agent Provider

## 1. 概述

为 OpenCove 新增 `cursor-agent` provider，通过 Cursor 官方 CLI（`agent` 命令）及其 ACP（Agent Client Protocol）协议，将 Cursor Agent 作为一种结构化的 agent 运行时集成到无限画布工作台中。

## 2. 背景与动机

### 2.1 现状

OpenCove 当前支持 4 种 agent provider：

| Provider | CLI 命令 | runtimeObservation | 状态观测方式 |
|---|---|---|---|
| `claude-code` | `claude` | `jsonl` | 读取 `~/.claude/projects/` 下的 JSONL 会话文件 |
| `codex` | `codex` | `jsonl` | 读取 `~/.codex/sessions/` 下的 JSONL rollout 文件 |
| `opencode` | `opencode` | `provider-api` | 轮询本地 HTTP API 获取会话状态 |
| `gemini` | `gemini` | `none` | 无结构化观测，仅依赖 PTY 输出 |

各 provider 遵循统一的抽象层：`AgentProviderId` → `AgentCommandFactory` → `AgentCliAvailability` → `AgentModelService` → `SessionFileResolver` / `SessionTurnStateDetector` → `AgentSessionLocator`。

### 2.2 为什么支持 Cursor Agent CLI

1. **用户价值**：Cursor 是目前最流行的 AI-native IDE 之一，其用户群体庞大。Cursor Agent CLI 提供了脱离 IDE 的独立 agent 能力，集成它可以让 OpenCove 用户在画布工作台中直接调度 Cursor Agent 完成编码任务。
2. **协议优势**：Cursor 提供了 ACP（Agent Client Protocol），这是一个基于 `stdio + JSON-RPC 2.0` 的结构化集成协议，比 JSONL 文件监听或 TUI 文本抓取更稳定、延迟更低。
3. **模型生态**：Cursor Agent 背后聚合了多家模型供应商，用户可以通过 `agent models` 获取可用模型列表，且模型选择通过 Cursor 账户体系统一管理。
4. **架构对齐**：ACP 的 `session/update` 事件流天然对应 OpenCove 的 `TerminalSessionState`（`working` / `standby`），且 `session/load` 直接支持会话恢复，与现有架构高度对齐。

## 3. 外部参考

### 3.1 Cursor CLI 能力概述

```
安装：curl https://cursor.com/install -fsSL | bash
交互模式：agent "prompt"
模式切换：--mode=agent|plan|ask
模型选择：--model <model>
列出模型：agent models  |  --list-models
恢复会话：--resume [chatId]  |  agent resume  |  --continue
非交互模式：-p --output-format json|stream-json|text
全权限：--force  |  --yolo
ACP 接入：agent acp
```

### 3.2 ACP（Agent Client Protocol）概要

ACP 通过 `agent acp` 启动，走 `stdio` 通道，消息格式为 JSON-RPC 2.0。

**会话生命周期**：

```
Client                              Agent (agent acp)
  │                                      │
  │── initialize ────────────────────────>│
  │<──────────────────── initializeResult │
  │                                      │
  │── authenticate ──────────────────────>│
  │<──────────────────── authenticateResult│
  │                                      │
  │── session/new ───────────────────────>│
  │<─────────────────── session/newResult │
  │                                      │
  │── session/prompt ────────────────────>│
  │<──── session/update (notification) ──│  (streaming, 多次)
  │<──── session/update (notification) ──│
  │<─────────────────── session/promptResult│
  │                                      │
  │── session/load ──────────────────────>│  (恢复已有会话)
  │<──────────────────── session/loadResult│
```

**关键方法**：

| 方法 | 方向 | 说明 |
|---|---|---|
| `initialize` | Client → Agent | 握手，交换能力声明 |
| `authenticate` | Client → Agent | 认证（Cursor 账户） |
| `session/new` | Client → Agent | 创建新会话 |
| `session/load` | Client → Agent | 加载/恢复已有会话 |
| `session/prompt` | Client → Agent | 发送 prompt |
| `session/update` | Agent → Client | 实时状态更新（notification） |
| `session/request_permission` | Agent → Client | 权限审批请求 |

**Cursor 扩展方法**：
- `cursor/ask_question`：向用户提问
- `cursor/create_plan`：创建执行计划
- `cursor/update_todos`：更新任务列表
- `cursor/task`：执行子任务

## 4. 可行性分析

### 4.1 架构兼容性

| 维度 | 评估 | 说明 |
|---|---|---|
| Provider 注册 | ✅ 完全兼容 | 在 `AGENT_PROVIDERS` 数组中新增 `'cursor-agent'` 即可 |
| CLI 探测 | ✅ 兼容（需增强） | `which agent` 可探测，但命令名太通用需二次校验 |
| 模型列表 | ✅ 兼容 | `agent models` 或 `--list-models` 输出可解析 |
| 命令拼装 | ✅ 兼容 | `AgentCommandFactory` 按 provider 分支拼装 |
| 状态观测 | ⚠️ 需新增机制 | 不走 JSONL 也不走 HTTP API，走 ACP stdio JSON-RPC |
| 会话恢复 | ✅ 兼容 | `--resume [chatId]` 或 `session/load` |
| 权限模型 | ⚠️ 初版简化 | `--yolo` 全权限；完整权限审批需处理 `session/request_permission` |

### 4.2 核心挑战

1. **`runtimeObservation` 类型扩展**：现有类型为 `'jsonl' | 'provider-api' | 'none'`，ACP 不属于任何一类。建议复用 `'provider-api'` 语义（本地进程级 API 通信），实际实现走 ACP 适配器。
2. **`agent` 命令名冲突**：`agent` 是一个极为通用的命令名，`which agent` 可能误命中其他工具。需要二次校验（如 `agent status` 或 `agent --version` 检查输出特征）。
3. **ACP 进程管理**：ACP 运行在独立的 `agent acp` 子进程中，需要管理其生命周期、重连、和错误恢复。
4. **双进程模型**：初版需要同时维护 PTY 进程（用户可见的终端输出）和 ACP 进程（结构化状态观测），二者需要关联到同一个 session。

## 5. 方案设计

### 5.1 Provider 命名与元数据

**Provider ID**：`cursor-agent`

命名理由：`cursor` 在 OpenCove 代码库中已被用于 IDE/path opener 语义（如 `ListWorkspacePathOpenersResult` 中的 Cursor IDE），使用 `cursor-agent` 明确指向 Cursor Agent CLI，避免语义混淆。

**元数据注册**：

```typescript
// agentSettings.providerMeta.ts
export const AGENT_PROVIDER_LABEL: Record<AgentProvider, string> = {
  // ...existing providers
  'cursor-agent': 'Cursor Agent',
}

export const AGENT_PROVIDER_CAPABILITIES: Record<AgentProvider, AgentProviderCapabilities> = {
  // ...existing providers
  'cursor-agent': {
    taskTitle: false,          // Phase 1 不支持
    worktreeNameSuggestion: false,  // Phase 1 不支持
    runtimeObservation: 'provider-api',  // 复用语义，实际走 ACP
    experimental: true,        // 初版标记为实验性
  },
}
```

**类型扩展**：

```typescript
// agent.ts
export type AgentProviderId = 'claude-code' | 'codex' | 'opencode' | 'gemini' | 'cursor-agent'
export type AgentModelCatalogSource = 'claude-static' | 'codex-cli' | 'opencode-cli' | 'gemini-cli' | 'cursor-agent-cli'
```

### 5.2 安装探测策略

由于 `agent` 命令名过于通用，单纯 `which agent` 不可靠。探测策略分两步：

```
Step 1: which agent → 失败则判定未安装
Step 2: agent --version 2>&1 → 检查输出是否包含 "cursor" 或 "Cursor" 特征字串
```

实现位置：`AgentCliAvailability.ts`

```typescript
async function isCursorAgentAvailable(): Promise<boolean> {
  const commandExists = await isCommandAvailable('agent')
  if (!commandExists) return false

  try {
    const { stdout, stderr } = await execFileAsync('agent', ['--version'], {
      timeout: 3000,
      windowsHide: true,
    })
    const output = `${stdout}${stderr}`.toLowerCase()
    return output.includes('cursor')
  } catch {
    return false
  }
}
```

### 5.3 模型列表获取

通过 `agent models` 命令获取可用模型列表。

```typescript
// AgentModelService.ts 新增分支
async function listCursorAgentModelsFromCli(): Promise<AgentModelOption[]> {
  const stdout = await executeCliText('agent', ['models'])
  // 解析 agent models 输出，提取模型 ID 和显示名
  return parseCursorAgentModelList(stdout)
}
```

`AgentModelCatalogSource` 使用 `'cursor-agent-cli'`。缓存策略参照 codex，TTL 30 秒。

### 5.4 会话启动与命令拼装

**PTY 模式（用户可见终端）**：

```typescript
// AgentCommandFactory.ts 新增分支
if (input.provider === 'cursor-agent') {
  const args: string[] = []

  if (agentFullAccess) {
    args.push('--yolo')
  }

  if (effectiveModel) {
    args.push('--model', effectiveModel)
  }

  if (input.mode === 'resume') {
    if (resumeSessionId) {
      args.push('--resume', resumeSessionId)
    } else {
      args.push('--continue')
    }
    return { command: 'agent', args, launchMode: 'resume', effectiveModel, resumeSessionId }
  }

  const prompt = normalizePrompt(input.prompt)
  if (prompt.length > 0) {
    maybeTerminateOptionParsing(args, prompt)
    args.push(prompt)
  }

  return { command: 'agent', args, launchMode: 'new', effectiveModel, resumeSessionId: null }
}
```

**resolveAgentCliCommand 扩展**：

```typescript
if (provider === 'cursor-agent') {
  return 'agent'
}
```

### 5.5 运行态观测（ACP Bridge）

这是本提案最核心的设计点。

#### 5.5.1 Bridge 架构

```
┌─────────────────────────────────────────────────────────┐
│                     OpenCove Main Process                │
│                                                          │
│  ┌──────────┐    PTY spawn      ┌──────────────────┐    │
│  │ Terminal  │◄─────────────────►│ agent "prompt"   │    │
│  │ Session   │    (user-visible) │ (interactive TUI)│    │
│  └──────────┘                   └──────────────────┘    │
│       │                                                  │
│       │ sessionId                                        │
│       ▼                                                  │
│  ┌──────────────────┐           ┌──────────────────┐    │
│  │ AcpBridge        │◄─────────►│ agent acp        │    │
│  │ (JSON-RPC client)│   stdio   │ (structured API) │    │
│  └──────────────────┘           └──────────────────┘    │
│       │                                                  │
│       │ session/update events                            │
│       ▼                                                  │
│  ┌──────────────────┐                                    │
│  │ SessionState      │──► IPC push ──► Renderer          │
│  │ Watcher           │    (ptyState)                     │
│  └──────────────────┘                                    │
└─────────────────────────────────────────────────────────┘
```

#### 5.5.2 AcpBridge 职责

1. **启动**：在 PTY session 创建后，同步启动 `agent acp` 子进程。
2. **握手**：发送 `initialize` → `authenticate` → `session/new` 或 `session/load`。
3. **状态映射**：监听 `session/update` notification，将 ACP 状态映射为 `TerminalSessionState`：

   | ACP 事件 | OpenCove 状态 |
   |---|---|
   | `session/update` with tool_call / thinking | `working` |
   | `session/update` with text completion | `standby` |
   | `session/request_permission` | `working`（等待审批） |
   | ACP 进程退出 | 不变更（由 PTY exit 决定） |

4. **生命周期**：ACP 进程的生命周期绑定到对应的 PTY session，PTY session 销毁时同步终止 ACP 进程。

#### 5.5.3 初版简化

Phase 1 不启动独立 ACP bridge 进程，而是将 `runtimeObservation` 设为 `'none'`，仅依赖 PTY 输出。理由：
- ACP bridge 涉及 JSON-RPC 客户端、进程管理、错误恢复等较大工作量
- PTY 模式已可满足基本使用需求
- 先验证 Cursor Agent 在 OpenCove 中的端到端可用性

Phase 2 再实现完整的 ACP bridge，升级 `runtimeObservation` 为 `'provider-api'`。

### 5.6 会话恢复

Cursor Agent CLI 支持两种恢复方式：

1. `--resume <chatId>`：恢复指定会话
2. `--continue`：恢复最近会话

**Phase 1 实现**：
- 新启动使用 `agent "prompt"` 启动交互模式
- 恢复使用 `--resume <chatId>` 或 `--continue`
- `AgentSessionLocator` 中对 `cursor-agent` 直接返回 `null`（不做主动会话定位），因为 Cursor 的会话存储位置和格式未公开文档化
- 会话恢复依赖用户手动选择或 `--continue` 恢复最近会话

**Phase 2 增强**：
- 通过 ACP `session/load` 实现程序化会话恢复
- 探索 Cursor 本地会话存储路径以实现 `AgentSessionLocator` 支持

### 5.7 权限模型

| 模式 | 实现 | 阶段 |
|---|---|---|
| 全权限 | `--yolo` 或 `--force` | Phase 1 |
| 受控权限（无 flag） | agent 自行在 TUI 中请求确认 | Phase 1（PTY 交互） |
| 受控权限 + UI 审批 | 处理 ACP `session/request_permission`，在 OpenCove UI 中展示审批对话框 | Phase 2 |

Phase 1 中 `agentFullAccess=true` 时传 `--yolo`；`agentFullAccess=false` 时不传，Cursor Agent 会在 PTY 中交互式请求权限确认。

### 5.8 UI 运行时形态

#### 5.8.1 Phase 1：PTY-only 方案

与 `gemini` provider 相同，agent 运行在 PTY 终端中，用户通过终端直接交互。无结构化状态观测。

优点：实现简单，快速验证可用性。
缺点：无法在画布 UI 中展示 working/standby 状态指示器。

#### 5.8.2 Phase 2：PTY + ACP Bridge 方案

PTY 终端提供用户可见的交互界面，ACP bridge 进程提供结构化状态观测。二者共享同一个 Cursor Agent 账户上下文。

需要解决的问题：
- PTY 和 ACP 是否可以同时连接到同一个 Cursor Agent 会话？如果不可以，则需要只走 ACP，不走 PTY 交互模式。
- 如果只走 ACP，需要在 OpenCove UI 中自行实现消息展示和交互，不再依赖终端。

#### 5.8.3 长期：Structured Agent Runtime

抽象出通用的 `StructuredAgentRuntime` 接口，所有走结构化协议（ACP、HTTP API 等）的 provider 统一接入，彻底解耦 PTY 和状态观测。

```typescript
interface StructuredAgentRuntime {
  start(config: AgentRuntimeConfig): Promise<AgentSession>
  sendPrompt(sessionId: string, prompt: string): Promise<void>
  onStateChange(listener: (state: TerminalSessionState) => void): Unsubscribe
  onMessage(listener: (message: AgentMessage) => void): Unsubscribe
  loadSession(sessionId: string): Promise<void>
  dispose(): void
}
```

## 6. 状态 Owner 表

| 状态 | Owner | 存储 | 备注 |
|---|---|---|---|
| Provider 是否已安装 | `AgentCliAvailability` (main) | 运行时探测，不持久化 | 含二次校验逻辑 |
| 可用模型列表 | `AgentModelService` (main) | 内存缓存，TTL 30s | `agent models` CLI 输出解析 |
| 用户选择的模型 | `AgentSettings` (renderer → persist) | JSON 持久化 | `customModelByProvider['cursor-agent']` |
| PTY session 进程 | `PtyRuntime` (main) | 内存（进程句柄） | 随 session 创建/销毁 |
| ACP bridge 进程 | `AcpBridge` (main) | 内存（进程句柄） | Phase 2，绑定到 PTY session 生命周期 |
| 运行态（working/standby） | `SessionStateWatcher` (main) | 内存 → IPC push | Phase 1 为 none；Phase 2 由 ACP event 驱动 |
| 会话 ID（chatId） | Cursor Agent 进程 | Cursor 本地存储 | OpenCove 不拥有，按需传递 |
| 恢复会话 ID | `AgentSessionLocator` (main) | 运行时查找 | Phase 1 返回 null，依赖 `--continue` |
| agentFullAccess 设置 | `AgentSettings` (renderer → persist) | JSON 持久化 | 控制是否传 `--yolo` |

## 7. 关键不变量（Invariants）

1. **单一命令源**：所有 Cursor Agent CLI 命令拼装必须且只能通过 `AgentCommandFactory.buildAgentLaunchCommand` 产出，禁止在其他位置硬编码命令参数。

2. **探测可靠性**：`cursor-agent` 的安装探测必须通过 `which agent` + 二次校验（`agent --version` 检查 `cursor` 关键词）两步完成。单步 `which agent` 通过不代表 Cursor Agent 已安装。

3. **PTY 生命周期主权**：ACP bridge 进程（Phase 2）的生命周期严格从属于其关联的 PTY session。PTY session 销毁时，ACP bridge 必须同步终止。禁止出现 ACP bridge 存活但 PTY session 已销毁的状态。

4. **状态推送一致性**：`TerminalSessionState` 的推送路径（IPC channel `ptyState`）对所有 provider 一致。`cursor-agent` 的状态变更必须通过同一路径推送，不得引入专属 channel。

5. **设置类型完整性**：`AgentSettings` 中所有按 provider 索引的字段（`customModelEnabledByProvider`、`customModelByProvider`、`customModelOptionsByProvider`）的默认值必须包含 `cursor-agent` 键。`normalizeAgentSettings` 必须正确处理 `cursor-agent` 的归一化。

## 8. 分阶段执行计划

### Phase 1：基础集成（PTY-only）

**目标**：在 OpenCove 中可以选择 Cursor Agent 作为 provider，启动交互式终端会话，选择模型。

**范围**：
- [ ] 扩展 `AgentProviderId` 类型，新增 `'cursor-agent'`
- [ ] 扩展 `AgentModelCatalogSource` 类型，新增 `'cursor-agent-cli'`
- [ ] 注册 provider 元数据（label、capabilities），`runtimeObservation: 'none'`，`experimental: true`
- [ ] 在 `AGENT_PROVIDERS` 数组中新增 `'cursor-agent'`
- [ ] 在 `AgentSettings` 所有按 provider 索引的字段中新增 `'cursor-agent'` 默认值
- [ ] 实现安装探测（`which agent` + `agent --version` 二次校验）
- [ ] 实现模型列表获取（`agent models` 解析）
- [ ] 实现命令拼装（`agent "prompt"` / `--model` / `--yolo` / `--resume` / `--continue`）
- [ ] `AgentSessionLocator` 对 `cursor-agent` 返回 `null`
- [ ] `SessionFileResolver` 对 `cursor-agent` 返回 `null`
- [ ] `SessionTurnStateDetector` 对 `cursor-agent` 返回 `null`
- [ ] `SessionLastAssistantMessage.extractors` 对 `cursor-agent` 返回 `null`
- [ ] 端到端验证：选择 Cursor Agent → 输入 prompt → PTY 启动 → 交互完成 → session 退出

**验收标准**：
- 设置面板可见 Cursor Agent 选项（标记为 Experimental）
- 安装探测正确区分 Cursor Agent 和其他名为 `agent` 的命令
- 模型列表正确展示
- 可启动新会话并在终端中交互
- `--yolo` 开关生效
- 模型选择生效
- `--resume` / `--continue` 可恢复会话

### Phase 2：结构化观测与增强

**目标**：通过 ACP 实现实时状态观测、权限审批 UI、taskTitle 和 worktreeNameSuggestion。

**范围**：
- [ ] 实现 `AcpBridge`：JSON-RPC 2.0 客户端，管理 `agent acp` 子进程
- [ ] 实现 ACP 会话生命周期：`initialize` → `authenticate` → `session/new` / `session/load`
- [ ] 实现 `session/update` → `TerminalSessionState` 映射
- [ ] 将 `runtimeObservation` 升级为 `'provider-api'`
- [ ] 实现 `session/request_permission` → OpenCove UI 权限审批对话框
- [ ] 探索 Cursor 本地会话存储路径，实现 `AgentSessionLocator` 支持
- [ ] 实现 `taskTitle` 能力（通过 ACP 或 one-shot print mode）
- [ ] 实现 `worktreeNameSuggestion` 能力
- [ ] 将 `experimental` 标记移除
- [ ] 评估 PTY + ACP 双进程 vs ACP-only 的取舍

## 9. 需要改动的文件清单

### Phase 1

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/shared/contracts/dto/agent.ts` | 修改 | 扩展 `AgentProviderId`、`AgentModelCatalogSource` 联合类型 |
| `src/contexts/settings/domain/agentSettings.ts` | 修改 | `AGENT_PROVIDERS` 数组新增，`DEFAULT_AGENT_SETTINGS` 所有 provider-indexed 字段新增默认值 |
| `src/contexts/settings/domain/agentSettings.providerMeta.ts` | 修改 | 新增 label 和 capabilities |
| `src/contexts/agent/infrastructure/cli/AgentCommandFactory.ts` | 修改 | `resolveAgentCliCommand` 新增分支，`buildAgentLaunchCommand` 新增分支 |
| `src/contexts/agent/infrastructure/cli/AgentCliAvailability.ts` | 修改 | `AGENT_PROVIDERS` 新增，实现 `isCursorAgentAvailable` 二次校验逻辑 |
| `src/contexts/agent/infrastructure/cli/AgentModelService.ts` | 修改 | 新增 `listCursorAgentModelsFromCli`，`listAgentModels` 新增分支 |
| `src/contexts/agent/infrastructure/watchers/SessionFileResolver.ts` | 修改 | `tryResolveSessionFilePath` 新增 `cursor-agent` 分支（返回 null） |
| `src/contexts/agent/infrastructure/watchers/SessionTurnStateDetector.ts` | 修改 | `detectTurnStateFromSessionRecord` 新增 `cursor-agent` 分支（返回 null） |
| `src/contexts/agent/infrastructure/watchers/SessionLastAssistantMessage.extractors.ts` | 修改 | `extractLastAssistantMessageFromSessionData` 新增 `cursor-agent` 分支（返回 null） |
| `src/contexts/agent/infrastructure/cli/AgentSessionLocator.ts` | 修改 | `tryFindResumeSessionId` 新增 `cursor-agent` 分支（返回 null） |
| 对应的单元测试文件（每个上述文件） | 新增/修改 | 新增 `cursor-agent` 相关测试用例 |

### Phase 2（额外）

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/contexts/agent/infrastructure/acp/AcpBridge.ts` | 新增 | ACP JSON-RPC 客户端实现 |
| `src/contexts/agent/infrastructure/acp/AcpSessionStateMapper.ts` | 新增 | ACP event → TerminalSessionState 映射 |
| `src/contexts/agent/infrastructure/acp/AcpProcessManager.ts` | 新增 | `agent acp` 子进程生命周期管理 |
| `src/contexts/agent/presentation/main-ipc/register.ts` | 修改 | ACP bridge 启动与绑定逻辑 |
| `src/contexts/settings/domain/agentSettings.providerMeta.ts` | 修改 | 更新 capabilities |

## 10. 风险与 Trade-off

### 10.1 风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| `agent` 命令名冲突 | 误探测导致用户困惑 | 二次校验 `agent --version` 输出特征 |
| ACP 协议不稳定 | Phase 2 实现可能需要频繁适配 | Phase 1 先不依赖 ACP；Phase 2 实现时增加协议版本检查 |
| Cursor Agent CLI 非开源 | 无法控制 CLI 行为变更 | 集成层保持薄适配器模式，隔离变更影响面 |
| PTY + ACP 双进程资源开销 | 每个 session 多一个子进程 | Phase 2 评估 ACP-only 模式可行性 |
| `agent models` 输出格式未文档化 | 解析可能不稳定 | 实现宽松解析，增加 fallback 静态模型列表 |
| Cursor 认证依赖 | 用户未登录 Cursor 账户时 CLI 不可用 | 探测阶段检查认证状态，UI 上给出引导提示 |

### 10.2 Trade-off

| 决策 | 选择 | 理由 |
|---|---|---|
| Provider ID 命名 | `cursor-agent` 而非 `cursor` | 避免与现有 Cursor IDE opener 语义冲突 |
| Phase 1 runtimeObservation | `none` 而非 `provider-api` | 降低初版复杂度，快速验证端到端可用性 |
| ACP 集成时机 | Phase 2 而非 Phase 1 | ACP 涉及 JSON-RPC 客户端、进程管理等较大工作量，且 ACP 协议稳定性未经充分验证 |
| 会话恢复策略 | Phase 1 依赖 `--continue` / `--resume` CLI flag | Cursor 本地存储路径未公开文档化，不宜硬编码路径猜测 |
| experimental 标记 | Phase 1 为 true | 新 provider 初版需要用户 opt-in 验证，降低对不知情用户的影响 |

## 11. 验收标准

### Phase 1 验收标准

1. **安装探测**
   - 已安装 Cursor Agent CLI 时，设置面板 provider 列表中出现 "Cursor Agent (Experimental)"
   - 未安装时不出现
   - 系统中存在其他名为 `agent` 的命令时不误判

2. **模型选择**
   - 模型下拉列表正确展示 `agent models` 返回的模型
   - 选择自定义模型后启动命令包含 `--model <model>`
   - `agent models` 失败时展示错误提示，不阻塞其他功能

3. **会话启动**
   - 输入 prompt 后在画布中创建 task node，PTY 终端启动 `agent "prompt"`
   - `agentFullAccess=true` 时命令包含 `--yolo`
   - `agentFullAccess=false` 时命令不包含 `--yolo`

4. **会话恢复**
   - `--resume <chatId>` 和 `--continue` 命令正确拼装
   - PTY 终端中 Cursor Agent 正常恢复会话

5. **会话退出**
   - Cursor Agent 退出后 PTY session 正常标记为 exited
   - 不出现僵尸进程

6. **回归安全**
   - 现有 4 个 provider 的所有测试用例通过
   - `normalizeAgentSettings` 对包含/不包含 `cursor-agent` 的旧数据正确归一化

### Phase 2 验收标准

1. ACP bridge 正常启动，`session/update` 事件正确驱动画布上的 working/standby 状态指示器
2. PTY session 销毁时 ACP bridge 进程同步终止，无泄漏
3. `session/request_permission` 在 OpenCove UI 中展示权限审批对话框
4. `experimental` 标记移除后，Cursor Agent 作为正式 provider 可用
