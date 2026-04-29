# RECOVERY MODEL

Related terminal architecture:

- `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md`

本文档是本轮完全重构的 `Phase 0` 产物。

它只回答四件事：
- 恢复相关状态分别是什么。
- 每类状态的 owner 是谁。
- 哪些状态是 durable fact，哪些只是 runtime observation 或 UI projection。
- 启动、关闭、恢复时什么可以写，什么不可以写。

补充边界：

- 本文档主要定义 durable recovery owner 与业务恢复语义。
- terminal presentation、multi-client attach、renderer resync、canonical geometry 由 `docs/terminal/MULTI_CLIENT_ARCHITECTURE.md` 统一定义。

Current main note (`2026-04-23`):

- latest `origin/main` still restores and relaunches part of the agent/session flow from renderer hydration code such as `src/app/renderer/shell/hooks/useHydrateAppState.helpers.ts` and `src/contexts/agent/presentation/renderer/hydrateAgentNode.ts`.
- treat those paths as migration debt, not as the desired long-term owner model.

Migration update (`2026-04-24`):

- active workspace cold-start hydration now prefers the worker `session.prepareOrRevive` contract before runtime nodes mount.
- renderer-local `hydrateRuntimeNode` remains only as fallback when the worker contract is unavailable; it is no longer the preferred production recovery path.
- Desktop startup no longer falls back to a main-owned standalone PTY/runtime host; recovery assumes a worker endpoint is available.

Migration update (`2026-04-25`):

- active workspace first paint no longer waits for worker prepare to finish.
- restored runtime nodes still come only from worker `session.prepareOrRevive`; Electron does not fall back to renderer-local spawn/launch when the worker prepare path fails.

## 1. 问题背景

当前恢复链路的核心风险，不是某个 if 写错，而是**真相分散**：

- `agent window` 存在于画布 node。
- `resumeSessionId` 既可能存在于 node.agent，也可能隐含在 task 的 session history。
- watcher 会基于外部会话文件推断运行状态。
- hydration 会同时做恢复判定、运行时补建、fallback 降级与 UI 映射。

结果是：
- 窗口能恢复，但 session 绑定错。
- 首次打开 agent 窗口但未发送消息时，没有 durable session intent，重启后无法恢复。
- watcher / fallback / 关闭流程容易把运行时观测错误地写成恢复真相。

## 2. 四类状态

### 用户意图

用户明确要求系统做什么。

示例：
- 新开一个 agent 窗口
- 恢复某个 agent 会话
- 关闭某个 agent 窗口
- 为某个 task 绑定 agent

### Durable Fact

跨进程、跨重启仍成立，并且恢复逻辑必须依赖它的事实。

示例：
- 哪个 task 持有哪个 agent window 记录
- 某个 agent window 当前期望恢复到哪个 resume session
- 某个 workspace 下有哪些 node / space / viewport 布局
- 用户 settings

### Runtime Observation

运行期外部系统当前反馈了什么；它本身不天然等于 durable truth。

示例：
- watcher 看到某个 session 文件新增一行
- PTY exit / state / metadata 事件
- CLI 当前返回了哪个 effective model
- 某个 resume session 在磁盘中当前能否定位到

### UI Projection

仅为展示服务，可由 durable fact 与 runtime observation 推导。

示例：
- 当前节点显示 running / standby / failed 的哪种样式
- 侧边栏里显示哪个 agent 正在关联哪个 task
- 某个关闭确认窗口是否打开

## 3. 恢复主不变量

1. **恢复判定只依赖 durable fact，不依赖 watcher 偶然看到什么。**
2. **Task / Agent Window / Resume Session 三者关系必须可脱离 UI 单独重建。**
3. **首次打开但未发首条消息，也必须留下 durable launch intent。**
4. **watcher 只能上报 observation，不能直接降级或清空 resumable truth。**
5. **关闭窗口、fallback terminal、late async completion 都不能重写别的 owner 的 durable fact。**

## 4. 恢复状态所有权表

| State | Class | Future Owner | Allowed Write Entry | Restart Source of Truth |
| --- | --- | --- | --- | --- |
| workspace list / active workspace | Durable Fact | `workspace` context | workspace usecase | DB persisted workspace state |
| viewport / spaces / node layout | Durable Fact | `workspace` context | workspace usecase | DB persisted workspace state |
| task fields | Durable Fact | `task` context | task usecase | task repository |
| task -> agent window reference | Durable Fact | `task` context | task-agent binding usecase | task repository |
| agent window record | Durable Fact | `agent` context | launch / close / restore usecases | agent repository |
| launch intent before first message | Durable Fact | `agent` context | launch usecase at window creation time | agent repository |
| resume session binding | Durable Fact | `agent` context | bind / verify resume usecases | agent repository |
| resume session verified flag | Durable Fact | `agent` context | verify resume binding usecase | agent repository |
| provider / model selection on a window | Durable Fact | `agent` context | launch / update usecases | agent repository |
| terminal session record | Durable Fact | `terminal` context | terminal lifecycle usecase | terminal repository |
| node scrollback | Durable Fact | `terminal` context | mounted renderer publish or app-shell inactive PTY stream sync | terminal scrollback repository |
| PTY alive / exited / resized | Runtime Observation | `terminal` context reducer | PTY adapter callbacks | none |
| watcher turn state | Runtime Observation | `agent` context reducer | watcher adapter callbacks | none |
| effective model returned by CLI | Runtime Observation -> promoted field | `agent` context | launch / resume usecase | agent repository after explicit write |
| node running / standby / failed badge | UI Projection | presentation layer | derived only | derived |
| settings panel open state | UI Projection | renderer shell | renderer only | none |

## 5. 当前问题的根因映射

### 问题 A：关闭 app 后重新打开，agent 窗口不自动恢复

根因类：
- 恢复条件同时依赖 node 上的运行时字段与 resume binding 是否“已验证”。
- 首次 launch 后，若外部 session 文件尚未产生记录，则 durable recovery intent 为空。
- hydration 中恢复失败后直接 fallback 到普通 terminal，导致业务语义被 UI runtime 替换。

### 问题 B：task 恢复时串错 session

根因类：
- `task` 与 `agent` 的 durable relation 没有独立聚合建模。
- 绑定关系部分存在 node data，部分存在 task session history，部分依赖 runtime metadata 回填。
- 恢复时实际上在“猜测”哪个 session 属于哪个窗口。

### 问题 C：只有第一次打开且未发送消息时不能恢复

根因类：
- 当前模型把“有可恢复 session”与“外部会话文件已经落盘”混成一件事。
- 但业务上真正需要恢复的是 `launch intent + pending binding`，而不是“外部 CLI 已经产生第一条 durable conversation event”。

## 6. 未来模型

### `task`

只拥有：
- task 自身字段
- task 对 agent window 的引用
- task 的历史会话展示记录

不拥有：
- resume session 真相
- watcher 当前观测状态
- terminal runtime 真相

### `agent`

只拥有：
- agent window record
- durable launch intent
- pending / verified resume binding
- provider/model/effectiveModel 的业务字段
- close / restore / rebind 规则

不拥有：
- viewport / node layout
- task 业务字段
- PTY 低层驱动状态

### `terminal`

只拥有：
- terminal session lifecycle
- attach / detach / snapshot / scrollback
- PTY runtime events reduction

不拥有：
- agent 恢复规则
- task 绑定规则

## 7. 核心聚合草图

### AgentWindow

```text
AgentWindow {
  agentWindowId
  taskId
  workspaceId
  provider
  requestedModel
  effectiveModel
  launchIntent
  binding {
    mode: new | resume
    resumeSessionId: string | null
    state: pending | verified | unavailable
  }
  runtime {
    terminalSessionId: string | null
    lastObservedTurnState: working | standby | null
    lifecycle: launching | active | closed | failed
  }
}
```

关键规则：
- `binding` 是 durable fact。
- `runtime` 不是 durable recovery truth。
- 首次 launch 时，即使 `resumeSessionId` 仍为空，也要持久化 `binding.state = pending`。

### TaskAgentLink

```text
TaskAgentLink {
  taskId
  agentWindowId
  relation: active | historical
  lastRunAt
}
```

关键规则：
- active link 只允许 0..1 指向当前激活 agent window。
- 历史展示记录是 task 视角的 projection，不是 agent resume truth owner。

## 8. 各关键边界允许做什么

### Launch

允许：
- 创建 `AgentWindow`
- 持久化 launch intent
- 分配 `pending` binding
- 创建 terminal runtime session

不允许：
- 因为还没探测到 `resumeSessionId` 就不写 durable record

### Watcher / Metadata

允许：
- 上报 turn state
- 上报定位到的 `resumeSessionId`
- 触发 agent context 的 verify usecase

不允许：
- 直接删除 binding
- 直接把 active window 改成不可恢复
- 直接改 task 与 window 的归属关系

### Hydration / Reopen

允许：
- 读取 durable agent/task/workspace state
- 重建 UI projection
- 为可恢复窗口尝试 restore runtime

不允许：
- 用恢复时是否成功 attach watcher 反向改写 durable binding
- 用 fallback terminal 结果覆盖业务 owner

### Close

允许：
- 改变 active runtime 状态
- 写入 close timestamp / last known runtime result
- task 侧把 active link 迁移为 historical projection

不允许：
- 清空 resume binding，除非用户显式执行 forget/archive 语义

## 9. 必须落地的回归集

### Unit

- `agent`：pending binding 不因缺少首条消息而消失
- `agent`：watcher observation 不覆盖 verified binding
- `task`：task-agent active / historical link 转换
- `workspace`：node layout 不承载 agent durable truth

### Integration

- 首次打开 agent 窗口但未发消息，关闭 app，重启后仍能恢复同一 agent window
- 多 task、多 agent window 场景下恢复不串 session
- watcher 晚到或重复事件不清空 binding
- app close during await 不产生半持久化错误状态

### E2E

- reopen app restores correct task-agent-session relation
- blank first launch restores pending binding window
- close/reopen does not downgrade agent window into plain terminal semantics

## 10. 本轮重构的设计戒律

1. 不再把 `node.data.agent` 当作最终 durable owner；它只能是 renderer projection 或 DTO。
2. 不再让 watcher / metadata 直接写 renderer store 里的业务结论。
3. 不再让 hydration 同时承担“恢复判定 + 运行时探测失败后的业务降级决定”。
4. 不再用 task session history 反推当前 active agent window 的真实 binding。
5. 不再把“session 文件已出现”当作“launch intent 已存在”的前提。
